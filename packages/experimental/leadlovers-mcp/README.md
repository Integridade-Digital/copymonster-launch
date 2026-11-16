---
description: "Connect a LeadLovers account through OAuth and expose its tools as mcp__leadlovers__*."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-leadlovers-mcp

English | [中文](README.zh.md)

## Summary

Connect the LeadLovers MCP server through OAuth 2.1 with PKCE. After authorization, the server's tools are registered as `mcp__leadlovers__*` and a card on the Plugins page drives authorize, refresh, test, and clear. The token lives in `~/.dsh/dsh-leadlovers-mcp.json` with mode 0600.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a profile that supplies tools, system prompts, and the Web server. The bundle patch inserts the `leadlovers-mcp` row; the Web profile also needs the package in its `dsh.profile.bundles` list and dependencies.

```yaml
- name: '@deepseek-ai/dsh-experimental-leadlovers-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
```

`publicOrigin` is optional. When the reverse proxy presents that origin, the OAuth start route registers `https://<origin>/api/dsh-leadlovers-mcp/oauth/callback`; without it, the flow uses the loopback callback and the card's manual code paste.

In the sidebar open **Plugins**, open the **LeadLovers MCP** row, and click **Authorize**. LeadLovers publishes its authorization server metadata at `https://mcp.leadlovers.com/.well-known/oauth-authorization-server` (issuer `https://mcp.leadlovers.com/`, dynamic client registration at `/register`, authorization at `/authorize`, token at `/token`, revocation at `/revoke`, scopes `read` and `write`, PKCE S256) and its protected-resource metadata at `https://mcp.leadlovers.com/.well-known/oauth-protected-resource/mcp`; the MCP endpoint's `401` response names that document in its `WWW-Authenticate` header.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `src/store.ts` persists the dynamic client registration, tokens, and discovery cache. The default path is `~/.dsh/dsh-leadlovers-mcp.json`; `tenant` namespaces it as `dsh-leadlovers-mcp.<tenant>.json`, and `DSH_LEADLOVERS_MCP_CONFIG` overrides it for tests.
- `src/oauth.ts` implements the MCP SDK's `OAuthClientProvider` and the two-phase flow (authorize URL, then code exchange).
- `src/mcp.ts` supervises the Streamable HTTP connection, registers tools as `mcp__leadlovers__<rawName>`, and re-syncs on tool-list changes.
- `src/routes.ts` serves `/api/dsh-leadlovers-mcp/*` behind a loopback and trusted-host fence.
- `src/client/index.ts` registers the `plugins.row.config` entry keyed `@deepseek-ai/dsh-experimental-leadlovers-mcp#leadlovers-mcp`, so the card renders on the Plugins page under this package's own row.

<a id="model-experience"></a>
## Model Experience

### LeadLovers tool catalog

#### What the model sees

After authorization, the server's tools appear under `mcp__leadlovers__*` names. Tool descriptions and JSON schemas come from LeadLovers. The plugin also registers `leadlovers_mcp_status`, `leadlovers_mcp_oauth_start`, `leadlovers_mcp_oauth_finish`, `leadlovers_mcp_test`, and `leadlovers_mcp_clear` for connection management. The announcement section names the plugin and its capabilities.

#### Token effect

The catalog adds one tool definition per LeadLovers tool plus the five management tools. Calls append their arguments and text results to Session history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Results append to history; authorization, disconnection, or a server catalog change can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The credential file is per OS user, not per authenticated tenant. A shared Host process needs backend session identity to isolate tenants; that is outside this plugin's scope.
- The loopback callback requires the browser to reach the Host's loopback address. Deployments behind a reverse proxy set `publicOrigin` or use the manual code paste.
- LeadLovers controls access-token and refresh-token lifetimes; when a refresh fails, the card requires a new authorization.
- The plugin implements only the OAuth path. LeadLovers documents no static API-key transport for MCP clients, so deployments that cannot complete OAuth cannot use this plugin.
- The plugin trusts its loopback and configured public origin fences. It does not add authentication beyond the Host's existing surfaces.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

- The plugin mirrors `zernio-mcp` and `sendpulse-mcp`: a Host entry under `src/`, a Client settings card under `src/client/`, and the `cordis.patch.yml` bundle row.
- Each card renders under its own package row on the Plugins page, so the MCP cards no longer depend on a shared Settings section order.
- The requested scopes are `read write`, both listed in the server's `scopes_supported`; the server advertises S256 only, so no `plain` PKCE fallback is available.

</details>
