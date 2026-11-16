---
description: "通过 OAuth 连接 SendPulse 账户，并以 mcp__sendpulse__* 形式提供其工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-sendpulse-mcp

[English](README.md) | 中文

## Summary

通过 OAuth 2.1（PKCE）连接 SendPulse MCP 服务器。授权后，服务器工具以 `mcp__sendpulse__*` 注册，并由设置卡片提供授权、刷新、测试和清除操作。令牌保存在 `~/.dsh/dsh-sendpulse-mcp.json`，权限为 0600。

## Table of Contents

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在提供 tools、systemPrompt 和 Web 服务器的 profile 中挂载此包。bundle patch 会插入 `sendpulse-mcp` 行；Web profile 还需把此包加入 `dsh.profile.bundles` 列表和依赖。

```yaml
- name: '@deepseek-ai/dsh-experimental-sendpulse-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` 可选。当反向代理呈现该来源时，OAuth 启动路由会注册 `https://<origin>/api/dsh-sendpulse-mcp/oauth/callback`；未设置时使用回环回调，并通过卡片中的手动代码粘贴完成。

打开设置，选择紧挨在 **Zernio MCP** 下方的 **SendPulse MCP**，然后点击 **授权**。SendPulse 在 `https://mcp.sendpulse.com/.well-known/oauth-authorization-server` 发布授权服务器元数据（issuer 为 `https://mcp.sendpulse.com`，包含动态客户端注册、授权与令牌端点、scope `rest`、PKCE S256），并在 `https://mcp.sendpulse.com/.well-known/oauth-protected-resource` 发布受保护资源元数据。

<a id="understand-the-implementation"></a>
## 了解实现

- `src/store.ts` 保存动态客户端注册、令牌和发现缓存。默认路径为 `~/.dsh/dsh-sendpulse-mcp.json`；`tenant` 会将其命名为 `dsh-sendpulse-mcp.<tenant>.json`，测试可用 `DSH_SENDPULSE_MCP_CONFIG` 覆盖。
- `src/oauth.ts` 实现 MCP SDK 的 `OAuthClientProvider` 以及两阶段流程（授权 URL，然后代码交换）。
- `src/mcp.ts` 监督 Streamable HTTP 连接，以 `mcp__sendpulse__<rawName>` 注册工具，并在工具列表变化时重新同步。
- `src/routes.ts` 在回环和受信任主机围栏后提供 `/api/dsh-sendpulse-mcp/*`。
- `src/client/index.ts` 注册 `settings.section` 条目，`order: 322`，紧跟在 `order: 321` 的 Zernio MCP 条目之后。

<a id="model-experience"></a>
## 模型体验

### SendPulse 工具目录

#### 模型看到的内容

授权后，服务器工具以 `mcp__sendpulse__*` 名称出现。工具描述和 JSON schema 来自 SendPulse。插件还注册 `sendpulse_mcp_status`、`sendpulse_mcp_oauth_start`、`sendpulse_mcp_oauth_finish`、`sendpulse_mcp_test` 和 `sendpulse_mcp_clear` 用于连接管理。公告区段说明插件及其能力。

#### Token 影响

目录为每个 SendPulse 工具添加一个工具定义，并添加五个管理工具。调用会把参数和文本结果追加到 Session 历史。

#### KV Cache 影响

未变化的目录会保留其工具定义前缀。结果会追加到历史；授权、断开连接或服务器目录变化可能降低前缀复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 凭据文件按操作系统用户隔离，而不是按已认证租户隔离。共享 Host 进程需要后端会话身份才能隔离租户；这不在本插件范围内。
- 回环回调要求浏览器能访问 Host 的回环地址。反向代理部署应设置 `publicOrigin` 或使用手动代码粘贴。
- SendPulse 控制访问令牌和刷新令牌的有效期；刷新失败时，卡片会要求重新授权。
- 插件仅实现 OAuth 路径。SendPulse 还为不支持 OAuth 的客户端提供静态 `X-SP-ID` 和 `X-SP-SECRET` 请求头；本插件不支持配置这些请求头。
- 插件信任其回环和已配置的公共来源围栏，不增加 Host 现有界面之外的身份验证。
