---
description: "Connect a Kiwify account through OAuth 2.1 PKCE and expose its tools as mcp__kiwify__*."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-kiwify-mcp

English | [中文](README.zh.md)

## Summary

Connect Kiwify's MCP server through OAuth 2.1 with PKCE S256 as a public client. After authorization, the server's tools are registered as `mcp__kiwify__*` and a Settings card drives authorize, refresh, test, and clear. The token lives in `~/.dsh/dsh-kiwify-mcp.json` with mode 0600.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a profile that supplies tools, system prompts, and the Web server. The bundle patch inserts the `kiwify-mcp` row; the Web profile also needs the package in its `dsh.profile.bundles` list and dependencies.

```yaml
- name: '@deepseek-ai/dsh-experimental-kiwify-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` is optional. When the reverse proxy presents that origin, the OAuth start route registers `https://<origin>/api/dsh-kiwify-mcp/oauth/callback`; without it, the flow uses the loopback callback and the card's manual code paste.

Open Settings, select **Kiwify MCP** directly below **LeadLovers MCP**, and click **Authorize**. The plugin reads Kiwify's OAuth metadata rather than hardcoding endpoints:

1. The MCP endpoint `https://mcp.kiwify.com/mcp` answers `401` with `WWW-Authenticate: Bearer ..., resource_metadata="https://mcp.kiwify.com/.well-known/oauth-protected-resource/mcp"`.
2. That protected-resource document names the authorization server `https://mcp.kiwify.com`.
3. `https://mcp.kiwify.com/.well-known/oauth-authorization-server` publishes the authorization endpoint (`/oauth/authorize`), the token endpoint (`/oauth/token`), the revocation endpoint (`/oauth/revoke`), the registration endpoint (`/oauth/register`), `token_endpoint_auth_method_supported: ["none"]`, and PKCE S256.

The MCP SDK performs that discovery, registers a public client at `/oauth/register`, and sends the browser to Kiwify's dashboard, which asks the account holder to approve the requested scopes and then returns to the plugin callback.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `src/store.ts` persists the dynamic client registration, tokens, and discovery cache. The default path is `~/.dsh/dsh-kiwify-mcp.json`; `tenant` namespaces it as `dsh-kiwify-mcp.<tenant>.json`, and `DSH_KIWIFY_MCP_CONFIG` overrides it for tests.
- `src/oauth.ts` implements the MCP SDK's `OAuthClientProvider`, the two-phase flow (authorize URL, then code exchange), and the requested scope list.
- `src/mcp.ts` supervises the Streamable HTTP connection, registers tools as `mcp__kiwify__<rawName>`, and re-syncs on tool-list changes.
- `src/routes.ts` serves `/api/dsh-kiwify-mcp/*` behind a loopback and trusted-host fence.
- `src/client/index.ts` registers the `settings.section` entry with `order: 323`, immediately after the SendPulse MCP entry at `order: 322`.

<a id="model-experience"></a>
## Model Experience

### Kiwify tool catalog

#### What the model sees

After authorization, the server's tools appear under `mcp__kiwify__*` names. Tool descriptions and JSON schemas come from Kiwify. The plugin also registers `kiwify_mcp_status`, `kiwify_mcp_oauth_start`, `kiwify_mcp_oauth_finish`, `kiwify_mcp_test`, and `kiwify_mcp_clear` for connection management. The announcement section names the plugin and its capabilities.

#### Token effect

The catalog adds one tool definition per Kiwify tool plus the five management tools. Calls append their arguments and text results to Session history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Results append to history; authorization, disconnection, or a server catalog change can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The requested scopes cover the store, products, sales, refunds, reports, finance, affiliates, coproductions, members area, and webhook events. Destructive scopes (`products:delete`, `students:delete`, `members_area:delete`, `subscriptions:delete`, `sales:refund`, `coproductions:delete`) are deliberately not requested, so tools that need them fail with an authorization error.
- The access token lasts one hour and the refresh token thirty days, and each refresh rotates the refresh token. The card refreshes on demand; when the refresh token lapses the account must authorize again.
- The credential file is per OS user, not per authenticated tenant. A shared Host process needs backend session identity to isolate tenants; that is outside this plugin's scope.
- The loopback callback requires the browser to reach the Host's loopback address. Deployments behind a reverse proxy set `publicOrigin` or use the manual code paste.
- The plugin does not call the revocation endpoint when credentials are cleared; it deletes the local file. Revoking on the Kiwify side remains a manual account action.
- The plugin trusts its loopback and configured public origin fences. It does not add authentication beyond the Host's existing surfaces.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

- The plugin mirrors `zernio-mcp`, `sendpulse-mcp`, and `leadlovers-mcp`: a Host entry under `src/`, a Client settings card under `src/client/`, and the `cordis.patch.yml` bundle row.
- The card order (323) keeps the MCP settings cards adjacent: Zernio 321, SendPulse 322, Kiwify 323, LeadLovers 324.
- No Kiwify endpoint is hardcoded: the client sends the server URL only, and the SDK resolves the protected-resource and authorization-server documents from the `401` challenge.
- `auth()` receives `KIWIFY_SCOPE_STRING` explicitly. Without it the SDK falls back to every `scopes_supported` entry, which would authorize deletes and refunds the card never uses.
- The refresh grant works because Kiwify's authorization server publishes `grant_types_supported: ["authorization_code", "refresh_token"]`.

</details>
