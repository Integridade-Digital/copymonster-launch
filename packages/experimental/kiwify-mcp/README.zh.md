---
description: "通过 OAuth 2.1 PKCE 连接 Kiwify 账户，并以 mcp__kiwify__* 形式提供其工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-kiwify-mcp

[English](README.md) | 中文

## 概述

以公共客户端身份，通过 OAuth 2.1（PKCE S256）连接 Kiwify 的 MCP 服务器。授权后，服务器工具以 `mcp__kiwify__*` 注册，并由设置卡片提供授权、刷新、测试和清除操作。令牌保存在 `~/.dsh/dsh-kiwify-mcp.json`，权限为 0600。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在提供 tools、systemPrompt 和 Web 服务器的 profile 中挂载此包。bundle patch 会插入 `kiwify-mcp` 行；Web profile 还需把此包加入 `dsh.profile.bundles` 列表和依赖。

```yaml
- name: '@deepseek-ai/dsh-experimental-kiwify-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` 可选。当反向代理呈现该来源时，OAuth 启动路由会注册 `https://<origin>/api/dsh-kiwify-mcp/oauth/callback`；未设置时使用回环回调，并通过卡片中的手动代码粘贴完成。

打开设置，选择紧挨在 **LeadLovers MCP** 下方的 **Kiwify MCP**，然后点击 **授权**。插件读取 Kiwify 的 OAuth 元数据，而不是硬编码端点：

1. MCP 端点 `https://mcp.kiwify.com/mcp` 返回 `401`，并带有 `WWW-Authenticate: Bearer ..., resource_metadata="https://mcp.kiwify.com/.well-known/oauth-protected-resource/mcp"`。
2. 该受保护资源文档指明授权服务器为 `https://mcp.kiwify.com`。
3. `https://mcp.kiwify.com/.well-known/oauth-authorization-server` 发布授权端点（`/oauth/authorize`）、令牌端点（`/oauth/token`）、撤销端点（`/oauth/revoke`）、注册端点（`/oauth/register`）、`token_endpoint_auth_method_supported: ["none"]` 以及 PKCE S256。

MCP SDK 执行上述发现，在 `/oauth/register` 注册公共客户端，并把浏览器带到 Kiwify 控制台；账户持有人在那里批准所请求的 scope，然后回到插件回调。

<a id="understand-the-implementation"></a>
## 了解实现

- `src/store.ts` 保存动态客户端注册、令牌和发现缓存。默认路径为 `~/.dsh/dsh-kiwify-mcp.json`；`tenant` 会将其命名为 `dsh-kiwify-mcp.<tenant>.json`，测试可用 `DSH_KIWIFY_MCP_CONFIG` 覆盖。
- `src/oauth.ts` 实现 MCP SDK 的 `OAuthClientProvider`、两阶段流程（授权 URL，然后代码交换）以及请求的 scope 列表。
- `src/mcp.ts` 监督 Streamable HTTP 连接，以 `mcp__kiwify__<rawName>` 注册工具，并在工具列表变化时重新同步。
- `src/routes.ts` 在回环和受信任主机围栏后提供 `/api/dsh-kiwify-mcp/*`。
- `src/client/index.ts` 注册 `settings.section` 条目，`order: 323`，紧跟在 `order: 322` 的 LeadLovers MCP 条目之后。

<a id="model-experience"></a>
## 模型体验

### Kiwify 工具目录

#### 模型看到的内容

授权后，服务器工具以 `mcp__kiwify__*` 名称出现。工具描述和 JSON schema 来自 Kiwify。插件还注册 `kiwify_mcp_status`、`kiwify_mcp_oauth_start`、`kiwify_mcp_oauth_finish`、`kiwify_mcp_test` 和 `kiwify_mcp_clear` 用于连接管理。公告区段说明插件及其能力。

#### Token 影响

目录为每个 Kiwify 工具添加一个工具定义，并添加五个管理工具。调用会把参数和文本结果追加到 Session 历史。

#### KV Cache 影响

未变化的目录会保留其工具定义前缀。结果会追加到历史；授权、断开连接或服务器目录变化可能降低前缀复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 请求的 scope 覆盖店铺、产品、销售、退款、报表、财务、联盟、合作、会员区和 webhook 事件。破坏性 scope（`products:delete`、`students:delete`、`members_area:delete`、`subscriptions:delete`、`sales:refund`、`coproductions:delete`）刻意不请求，因此需要它们的工具会以授权错误失败。
- 访问令牌有效 1 小时，刷新令牌有效 30 天，且每次刷新都会轮换刷新令牌。卡片按需刷新；刷新令牌过期后需要重新授权账户。
- 凭据文件按操作系统用户隔离，而不是按已认证租户隔离。共享 Host 进程需要后端会话身份才能隔离租户；这不在本插件范围内。
- 回环回调要求浏览器能访问 Host 的回环地址。反向代理部署应设置 `publicOrigin` 或使用手动代码粘贴。
- 清除凭据时插件不会调用撤销端点，而是删除本地文件。在 Kiwify 一侧撤销仍是手动账户操作。
- 插件信任其回环和已配置的公共来源围栏，不增加 Host 现有界面之外的身份验证。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

- 本插件与 `zernio-mcp`、`sendpulse-mcp`、`leadlovers-mcp` 结构相同：`src/` 下的 Host 入口、`src/client/` 下的 Client 设置卡片，以及 `cordis.patch.yml` 中的 bundle 行。
- 卡片顺序（323）使 MCP 设置卡片相邻：Zernio 321、SendPulse 322、Kiwify 323、LeadLovers 324。
- 不硬编码任何 Kiwify 端点：客户端只发送服务器 URL，SDK 从 `401` 挑战中解析受保护资源与授权服务器文档。
- `auth()` 显式接收 `KIWIFY_SCOPE_STRING`。否则 SDK 会回退到全部 `scopes_supported`，从而授权卡片从未使用的删除与退款操作。
- 刷新授权可用，因为 Kiwify 的授权服务器发布了 `grant_types_supported: ["authorization_code", "refresh_token"]`。

</details>
