---
description: "Connect a WhatsApp Business account through Meta OAuth and expose its tools as mcp__whatsapp__*."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-whatsapp-mcp

English | [中文](README.zh.md)

## Summary

Connect Meta's WhatsApp Business MCP server through OAuth 2.1 with PKCE. After authorization, the server's tools are registered as `mcp__whatsapp__*` and a Settings card drives authorize, refresh, test, and clear. The token lives in `~/.dsh/dsh-whatsapp-mcp.json` with mode 0600.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a profile that supplies tools, system prompts, and the Web server. The bundle patch inserts the `whatsapp-mcp` row; the Web profile also needs the package in its `dsh.profile.bundles` list and dependencies.

```yaml
- name: '@deepseek-ai/dsh-experimental-whatsapp-mcp'
  config:
    announceToAgent: true
    enabled: true
    publicOrigin: https://app.copymonster.co
    metaAppId: '1234567890123456'
```

`publicOrigin` is optional. When the reverse proxy presents that origin, the OAuth start route registers `https://<origin>/api/dsh-whatsapp-mcp/oauth/callback`; without it, the flow uses the loopback callback and the card's manual code paste.

`metaAppId` is the ID of a Meta app registered at https://developers.facebook.com with the WhatsApp Business products enabled. Meta's registration endpoint answers `400 invalid_client_metadata: Dynamic registration is not available for this client` for every client name outside Meta's own allowlist, so the plugin cannot register itself; with this field set, the plugin uses the app as its client and opens `https://www.facebook.com/v27.0/dialog/oauth` directly. Add the callback URL above to the app's *Valid OAuth Redirect URIs*. Without the field, Authorize reports Meta's registration rejection instead of opening a dialog.

Open Settings, select **WhatsApp Business MCP** directly below **SendPulse MCP**, and click **Authorize**. The plugin reads the server's OAuth metadata rather than hardcoding endpoints:

1. The MCP endpoint `https://mcp.facebook.com/whatsapp_business_tools` answers `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.facebook.com/.well-known/oauth-protected-resource/whatsapp_business_tools", scope="business_management whatsapp_business_management whatsapp_business_messaging"`.
2. That protected-resource document names the authorization server `https://www.facebook.com/whatsapp_business_tools`.
3. `https://www.facebook.com/.well-known/oauth-authorization-server/whatsapp_business_tools` publishes the authorization endpoint (`https://www.facebook.com/v27.0/dialog/oauth`), the token endpoint (`https://graph.facebook.com/v27.0/oauth/access_token`), the registration endpoint (`https://mcp.facebook.com/.well-known/register/whatsapp_business_tools`), `token_endpoint_auth_method: none`, and PKCE S256.

The MCP SDK performs that discovery, uses the configured app as the client, and exchanges the code.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `src/store.ts` persists the dynamic client registration, tokens, and discovery cache. The default path is `~/.dsh/dsh-whatsapp-mcp.json`; `tenant` namespaces it as `dsh-whatsapp-mcp.<tenant>.json`, and `DSH_WHATSAPP_MCP_CONFIG` overrides it for tests.
- `src/oauth.ts` implements the MCP SDK's `OAuthClientProvider` and the two-phase flow (authorize URL, then code exchange). When `metaAppId` is set, `begin()` records that app as the client so the SDK skips registration.
- `src/mcp.ts` supervises the Streamable HTTP connection, registers tools as `mcp__whatsapp__<rawName>`, and re-syncs on tool-list changes.
- `src/routes.ts` serves `/api/dsh-whatsapp-mcp/*` behind a loopback and trusted-host fence.
- `src/client/index.ts` registers the `settings.section` entry with `order: 323`, immediately after the SendPulse MCP entry at `order: 322`.

<a id="model-experience"></a>
## Model Experience

### WhatsApp Business tool catalog

#### What the model sees

After authorization, the server's tools appear under `mcp__whatsapp__*` names. Tool descriptions and JSON schemas come from Meta. The plugin also registers `whatsapp_mcp_status`, `whatsapp_mcp_oauth_start`, `whatsapp_mcp_oauth_finish`, `whatsapp_mcp_test`, and `whatsapp_mcp_clear` for connection management. The announcement section names the plugin and its capabilities.

#### Token effect

The catalog adds one tool definition per Meta tool plus the five management tools. Calls append their arguments and text results to Session history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Results append to history; authorization, disconnection, or a server catalog change can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Meta labels the WhatsApp Business MCP server **Beta**. Accounts without access fail at the authorize step or the first tool call, and Meta can change the endpoint, scopes, or tool set without notice.
- Meta's registration endpoint rejects every client outside its allowlist, so authorization requires an operator-supplied Meta app (`metaAppId`) whose *Valid OAuth Redirect URIs* already list the plugin callback. The plugin cannot complete a registration on its own.
- The credential file is per OS user, not per authenticated tenant. A shared Host process needs backend session identity to isolate tenants; that is outside this plugin's scope.
- The loopback callback requires the browser to reach the Host's loopback address. Deployments behind a reverse proxy set `publicOrigin` or use the manual code paste.
- The authorization server advertises `grant_types_supported: ["authorization_code"]` only, so there is no refresh grant. **Refresh token** reports the failure and the card requires a new authorization when the access token expires.
- Meta grants tools according to the permissions of the business account that approved the app; a missing tool means that account lacks the capability, not that the plugin dropped it.
- The plugin trusts its loopback and configured public origin fences. It does not add authentication beyond the Host's existing surfaces.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

- The plugin mirrors `zernio-mcp`, `sendpulse-mcp`, and `leadlovers-mcp`: a Host entry under `src/`, a Client settings card under `src/client/`, and the `cordis.patch.yml` bundle row.
- The card order (323) keeps the MCP settings cards adjacent: Zernio 321, SendPulse 322, WhatsApp Business 323, LeadLovers 324.
- No Meta endpoint is hardcoded for discovery: the client sends the server URL only, and the SDK resolves the protected-resource and authorization-server documents from the `401` challenge. Registration is the exception: Meta allowlists client names, so `metaAppId` supplies the client and the dialog URL comes from the discovered metadata.
- The requested scope string is the server's own `scopes_supported` list, joined with spaces.

</details>
