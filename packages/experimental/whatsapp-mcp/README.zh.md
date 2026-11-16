---
description: "通过 Meta OAuth 连接 WhatsApp Business 账户，并以 mcp__whatsapp__* 形式提供其工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-whatsapp-mcp

[English](README.md) | 中文

## 概述

通过 OAuth 2.1（PKCE）连接 Meta 的 WhatsApp Business MCP 服务器。授权后，服务器工具以 `mcp__whatsapp__*` 注册，并由设置卡片提供授权、刷新、测试和清除操作。令牌保存在 `~/.dsh/dsh-whatsapp-mcp.json`，权限为 0600。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在提供 tools、systemPrompt 和 Web 服务器的 profile 中挂载此包。bundle patch 会插入 `whatsapp-mcp` 行；Web profile 还需把此包加入 `dsh.profile.bundles` 列表和依赖。

```yaml
- name: '@deepseek-ai/dsh-experimental-whatsapp-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
    metaAppId: '1234567890123456'
```

`publicOrigin` 可选。当反向代理呈现该来源时，OAuth 启动路由会注册 `https://<origin>/api/dsh-whatsapp-mcp/oauth/callback`；未设置时使用回环回调，并通过卡片中的手动代码粘贴完成。

`metaAppId` 是在 https://developers.facebook.com 注册并启用 WhatsApp Business 产品的 Meta 应用 ID。对于 Meta 白名单之外的所有客户端名称，Meta 的注册端点都会返回 `400 invalid_client_metadata: Dynamic registration is not available for this client`，因此插件无法自行注册；设置该字段后，插件以该应用作为客户端，直接打开 `https://www.facebook.com/v27.0/dialog/oauth`。请把上面的回调 URL 加入该应用的 *Valid OAuth Redirect URIs*。未设置该字段时，授权会报告 Meta 的注册拒绝结果，而不会打开对话框。

打开设置，选择紧挨在 **SendPulse MCP** 下方的 **WhatsApp Business MCP**，然后点击 **授权**。插件读取服务器的 OAuth 元数据，而不是硬编码端点：

1. MCP 端点 `https://mcp.facebook.com/whatsapp_business_tools` 返回 `401`，并带有 `WWW-Authenticate: Bearer resource_metadata="https://mcp.facebook.com/.well-known/oauth-protected-resource/whatsapp_business_tools", scope="business_management whatsapp_business_management whatsapp_business_messaging"`。
2. 该受保护资源文档指明授权服务器为 `https://www.facebook.com/whatsapp_business_tools`。
3. `https://www.facebook.com/.well-known/oauth-authorization-server/whatsapp_business_tools` 发布授权端点（`https://www.facebook.com/v27.0/dialog/oauth`）、令牌端点（`https://graph.facebook.com/v27.0/oauth/access_token`）、注册端点（`https://mcp.facebook.com/.well-known/register/whatsapp_business_tools`）、`token_endpoint_auth_method: none` 以及 PKCE S256。

MCP SDK 执行上述发现，以配置的应用作为客户端，并交换代码。

<a id="understand-the-implementation"></a>
## 了解实现

- `src/store.ts` 保存动态客户端注册、令牌和发现缓存。默认路径为 `~/.dsh/dsh-whatsapp-mcp.json`；`tenant` 会将其命名为 `dsh-whatsapp-mcp.<tenant>.json`，测试可用 `DSH_WHATSAPP_MCP_CONFIG` 覆盖。
- `src/oauth.ts` 实现 MCP SDK 的 `OAuthClientProvider` 以及两阶段流程（授权 URL，然后代码交换）。设置 `metaAppId` 时，`begin()` 会把该应用记录为客户端，SDK 因而跳过注册。
- `src/mcp.ts` 监督 Streamable HTTP 连接，以 `mcp__whatsapp__<rawName>` 注册工具，并在工具列表变化时重新同步。
- `src/routes.ts` 在回环和受信任主机围栏后提供 `/api/dsh-whatsapp-mcp/*`。
- `src/client/index.ts` 注册 `settings.section` 条目，`order: 323`，紧跟在 `order: 322` 的 SendPulse MCP 条目之后。

<a id="model-experience"></a>
## 模型体验

### WhatsApp Business 工具目录

#### 模型看到的内容

授权后，服务器工具以 `mcp__whatsapp__*` 名称出现。工具描述和 JSON schema 来自 Meta。插件还注册 `whatsapp_mcp_status`、`whatsapp_mcp_oauth_start`、`whatsapp_mcp_oauth_finish`、`whatsapp_mcp_test` 和 `whatsapp_mcp_clear` 用于连接管理。公告区段说明插件及其能力。

#### Token 影响

目录为每个 Meta 工具添加一个工具定义，并添加五个管理工具。调用会把参数和文本结果追加到 Session 历史。

#### KV Cache 影响

未变化的目录会保留其工具定义前缀。结果会追加到历史；授权、断开连接或服务器目录变化可能降低前缀复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Meta 将 WhatsApp Business MCP 服务器标记为 **Beta**。没有访问权限的账户会在授权步骤或首次工具调用时失败，Meta 也可能随时更改端点、scope 或工具集。
- Meta 的注册端点会拒绝白名单之外的所有客户端，因此授权需要运维提供 Meta 应用（`metaAppId`），且其 *Valid OAuth Redirect URIs* 已列出插件回调。插件无法自行完成注册。
- 凭据文件按操作系统用户隔离，而不是按已认证租户隔离。共享 Host 进程需要后端会话身份才能隔离租户；这不在本插件范围内。
- 回环回调要求浏览器能访问 Host 的回环地址。反向代理部署应设置 `publicOrigin` 或使用手动代码粘贴。
- 授权服务器仅声明 `grant_types_supported: ["authorization_code"]`，没有刷新授权。**更新令牌** 会报告失败；访问令牌过期后需要重新授权。
- Meta 按批准该应用的商务账户权限授予工具；缺少某个工具意味着该账户没有相应能力，而不是插件丢弃了它。
- 插件信任其回环和已配置的公共来源围栏，不增加 Host 现有界面之外的身份验证。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

- 本插件与 `zernio-mcp`、`sendpulse-mcp`、`leadlovers-mcp` 结构相同：`src/` 下的 Host 入口、`src/client/` 下的 Client 设置卡片，以及 `cordis.patch.yml` 中的 bundle 行。
- 卡片顺序（323）使 MCP 设置卡片相邻：Zernio 321、SendPulse 322、WhatsApp Business 323、LeadLovers 324。
- 发现流程不硬编码任何 Meta 端点：客户端只发送服务器 URL，SDK 从 `401` 挑战中解析受保护资源与授权服务器文档。注册是例外：Meta 只允许白名单中的客户端名称，因此由 `metaAppId` 提供客户端，对话框 URL 来自发现的元数据。
- 请求的 scope 字符串即服务器自身的 `scopes_supported` 列表，以空格连接。

</details>
