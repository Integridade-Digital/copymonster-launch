---
description: "通过 OAuth 连接 LeadLovers 账户，并以 mcp__leadlovers__* 形式提供其工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-leadlovers-mcp

[English](README.md) | 中文

## 概述

通过 OAuth 2.1（PKCE）连接 LeadLovers MCP 服务器。授权后，服务器工具以 `mcp__leadlovers__*` 注册，并由设置卡片提供授权、刷新、测试和清除操作。令牌保存在 `~/.dsh/dsh-leadlovers-mcp.json`，权限为 0600。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在提供 tools、systemPrompt 和 Web 服务器的 profile 中挂载此包。bundle patch 会插入 `leadlovers-mcp` 行；Web profile 还需把此包加入 `dsh.profile.bundles` 列表和依赖。

```yaml
- name: '@deepseek-ai/dsh-experimental-leadlovers-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` 可选。当反向代理呈现该来源时，OAuth 启动路由会注册 `https://<origin>/api/dsh-leadlovers-mcp/oauth/callback`；未设置时使用回环回调，并通过卡片中的手动代码粘贴完成。

打开设置，选择紧挨在 **SendPulse MCP** 下方的 **LeadLovers MCP**，然后点击 **授权**。LeadLovers 在 `https://mcp.leadlovers.com/.well-known/oauth-authorization-server` 发布授权服务器元数据（issuer 为 `https://mcp.leadlovers.com/`，动态客户端注册位于 `/register`，授权位于 `/authorize`，令牌位于 `/token`，撤销位于 `/revoke`，scope 为 `read` 和 `write`，PKCE S256），并在 `https://mcp.leadlovers.com/.well-known/oauth-protected-resource/mcp` 发布受保护资源元数据；MCP 端点的 `401` 响应通过 `WWW-Authenticate` 头指向该文档。

<a id="understand-the-implementation"></a>
## 了解实现

- `src/store.ts` 保存动态客户端注册、令牌和发现缓存。默认路径为 `~/.dsh/dsh-leadlovers-mcp.json`；`tenant` 会将其命名为 `dsh-leadlovers-mcp.<tenant>.json`，测试可用 `DSH_LEADLOVERS_MCP_CONFIG` 覆盖。
- `src/oauth.ts` 实现 MCP SDK 的 `OAuthClientProvider` 以及两阶段流程（授权 URL，然后代码交换）。
- `src/mcp.ts` 监督 Streamable HTTP 连接，以 `mcp__leadlovers__<rawName>` 注册工具，并在工具列表变化时重新同步。
- `src/routes.ts` 在回环和受信任主机围栏后提供 `/api/dsh-leadlovers-mcp/*`。
- `src/client/index.ts` 注册 `settings.section` 条目，`order: 324`，紧跟在 `order: 323` 的 WhatsApp Business MCP 条目之后。

<a id="model-experience"></a>
## 模型体验

### LeadLovers 工具目录

#### 模型看到的内容

授权后，服务器工具以 `mcp__leadlovers__*` 名称出现。工具描述和 JSON schema 来自 LeadLovers。插件还注册 `leadlovers_mcp_status`、`leadlovers_mcp_oauth_start`、`leadlovers_mcp_oauth_finish`、`leadlovers_mcp_test` 和 `leadlovers_mcp_clear` 用于连接管理。公告区段说明插件及其能力。

#### Token 影响

目录为每个 LeadLovers 工具添加一个工具定义，并添加五个管理工具。调用会把参数和文本结果追加到 Session 历史。

#### KV Cache 影响

未变化的目录会保留其工具定义前缀。结果会追加到历史；授权、断开连接或服务器目录变化可能降低前缀复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 凭据文件按操作系统用户隔离，而不是按已认证租户隔离。共享 Host 进程需要后端会话身份才能隔离租户；这不在本插件范围内。
- 回环回调要求浏览器能访问 Host 的回环地址。反向代理部署应设置 `publicOrigin` 或使用手动代码粘贴。
- LeadLovers 控制访问令牌和刷新令牌的有效期；刷新失败时，卡片会要求重新授权。
- 插件仅实现 OAuth 路径。LeadLovers 未为 MCP 客户端提供静态 API 密钥传输方式，因此无法完成 OAuth 的部署不能使用本插件。
- 插件信任其回环和已配置的公共来源围栏，不增加 Host 现有界面之外的身份验证。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

- 本插件与 `zernio-mcp`、`sendpulse-mcp` 结构相同：`src/` 下的 Host 入口、`src/client/` 下的 Client 设置卡片，以及 `cordis.patch.yml` 中的 bundle 行。
- 卡片顺序（324）使 MCP 设置卡片相邻：Zernio 321、SendPulse 322、WhatsApp Business 323、LeadLovers 324。
- 请求的 scope 为 `read write`，两者都在服务器的 `scopes_supported` 中；服务器仅声明 S256，因此没有 `plain` PKCE 回退。

</details>
