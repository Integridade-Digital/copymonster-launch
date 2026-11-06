---
description: "Connect a Zernio account through OAuth and expose its tools as mcp__zernio__*."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-zernio-mcp

English | [中文](README.zh.md)

## Summary

Connect the Zernio MCP server through OAuth 2.1 with PKCE. After authorization, the server's tools are registered as `mcp__zernio__*` and a Settings card drives authorize, refresh, test, and clear. The token lives in `~/.dsh/dsh-zernio-mcp.json` with mode 0600.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a profile that supplies tools, system prompts, and the Web server. The bundle patch inserts the `zernio-mcp` row; the Web profile also needs the package in its `dsh.profile.bundles` list and dependencies.

```yaml
- name: '@deepseek-ai/dsh-experimental-zernio-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` is optional. When the reverse proxy presents that origin, the OAuth start route registers `https://<origin>/api/dsh-zernio-mcp/oauth/callback`; without it, the flow uses the loopback callback and the card's manual code paste.

Open Settings, select **Zernio MCP** directly below **Vercel MCP**, and click **Authorize**. Zernio's authorization server publishes dynamic client registration and PKCE S256 at `https://zernio.com/.well-known/oauth-authorization-server`; the MCP server publishes its protected-resource metadata at `https://mcp.zernio.com/.well-known/oauth-protected-resource`.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `src/store.ts` persists the dynamic client registration, tokens, and discovery cache. The default path is `~/.dsh/dsh-zernio-mcp.json`; `tenant` namespaces it as `dsh-zernio-mcp.<tenant>.json`, and `DSH_ZERNIO_MCP_CONFIG` overrides it for tests.
- `src/oauth.ts` implements the MCP SDK's `OAuthClientProvider` and the two-phase flow (authorize URL, then code exchange).
- `src/mcp.ts` supervises the Streamable HTTP connection, registers tools as `mcp__zernio__<rawName>`, and re-syncs on tool-list changes.
- `src/routes.ts` serves `/api/dsh-zernio-mcp/*` behind a loopback and trusted-host fence.
- `src/client/index.ts` registers the `settings.section` entry with `order: 321`, immediately after the Vercel MCP entry at `order: 320`.

<a id="model-experience"></a>
## Model Experience

### Zernio tool catalog

#### What the model sees

After authorization, the server's tools appear under `mcp__zernio__*` names. Tool descriptions and JSON schemas come from Zernio. The plugin also registers `zernio_mcp_status`, `zernio_mcp_oauth_start`, `zernio_mcp_oauth_finish`, `zernio_mcp_test`, and `zernio_mcp_clear` for connection management. The announcement section names the plugin and its capabilities.

#### Token effect

The catalog adds one tool definition per Zernio tool plus the five management tools. Calls append their arguments and text results to Session history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Results append to history; authorization, disconnection, or a server catalog change can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The credential file is per OS user, not per authenticated tenant. A shared Host process needs backend session identity to isolate tenants; that is outside this plugin's scope.
- The loopback callback requires the browser to reach the Host's loopback address. Deployments behind a reverse proxy set `publicOrigin` or use the manual code paste.
- Access tokens expire after one hour and refresh tokens after 30 days, as Zernio documents; an expired refresh token requires a new authorization.
- The plugin trusts its loopback and configured public origin fences. It does not add authentication beyond the Host's existing surfaces.
