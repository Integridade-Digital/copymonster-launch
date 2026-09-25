---
description: "CopyMonster identity service: resolves a Supabase bearer token to a tenant-scoped user identity, with Typert Host and Client Context adapters for the `auth` Context kind."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-auth-context

English | [中文](README.zh.md)

## Summary

CopyMonster identity resolution for the `auth` Typert Context kind. The Host entry provides `ctx.auth`, which turns a Supabase bearer token into a `UserIdentity`, and `@deepseek-ai/dsh-api-auth-context/client` publishes the signed-in caller's access token as the wire identity for the same Context kind. The two halves are separate packages' worth of surface in one package: a Remote method declaring `context: 'auth'` needs both, and the Host half stays the only place a token becomes an identity.

## Table of Contents

- [Host service: `AuthService` (ctx key: `auth`)](#host-service-authservice-ctx-key-auth)
- [Client adapter: `auth-client`](#client-adapter-auth-client)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="host-service-authservice-ctx-key-auth"></a>
## Host service: `AuthService` (ctx key: `auth`)

`ctx.auth.resolveIdentity(token)` validates the token with `supabaseAdminClient.auth.getUser()`, reads the `tenant_id` and `user_role` claims that the Supabase Custom Access Token Hook writes into the JWT, and returns `{ userId, tenantId, role, email }` plus `fullName`, `whatsapp`, and `avatarUrl` when the profile row carries them. The service then confirms the claimed tenant still resolves to an `active` row and reads the profile from `users` by the validated user id, so the hook decides the membership and this service only refuses a tenant that is no longer usable. `role` narrows to `owner`, `admin`, or `member`; the `anonymous` membership and any value outside that vocabulary resolve to no identity rather than a downgraded one, because a caller holding only that role has no tenant to act within.

A failure is not an exception. An absent, rejected, or expired token, a payload that is not a JSON object, a missing or blank `tenant_id` or `user_role`, a tenant that is not `active`, and an unreadable or missing profile all resolve to `undefined`, so a Typert lookup answers the stable `context-not-found` fault instead of surfacing a Supabase error to the caller. The compact JWS payload is decoded without verifying its signature, because `getUser()` has already validated the token against Supabase before any claim is read.

`ctx.auth.resolveContext(token)` wraps that identity in a plain `ctx.extend({ authIdentity })` overlay, creating no fiber and holding no registrations. The constructor registers the Host Context adapter for the `auth` kind, bound to the `authToken` wire field and the `@copymonster/auth#AuthToken` type symbol, inside `ctx.inject(['typert'], ...)`; the registration therefore appears with the Typert registry and unwinds with this plugin. A Remote method marked `@RemoteScope` resolves its receiver through that adapter, so the scoped method body reads the identity from `ctx.authIdentity`.

<a id="client-adapter-auth-client"></a>
## Client adapter: `auth-client`

`@deepseek-ai/dsh-api-auth-context/client` is the browser half of the same Context kind. It exports `name`, `inject`, and `apply` — no default export, so the Loader keeps the plugin namespace — and registers a Client Context adapter for `auth` that answers `identity` with the access token the page currently publishes. A Remote method that declares `context: 'auth'` reaches the browser as a scoped projection, and the client Gateway refuses to invoke it without this adapter; `resolve` turns the token into a child Context carrying `authToken`.

The page publishes the session through a `__DSH_AUTH__` global, mirroring how `__DSH_TRANSPORT__` carries host-owned transport facts into the browser plugins, and `apps/web/src/main.tsx` writes it from `supabaseClient.auth.onAuthStateChange()`. The adapter holds no session of its own and re-reads that global per invocation, so a sign-out or a token refresh takes effect on the next call without a reload, and it answers `identity` only for Contexts under the same application root. A signed-out page publishes no token, and the adapter returns `undefined` rather than an empty string.

## Model Experience

### Caller identity resolution

#### What the model sees

Nothing. The package registers no prompt, tool, or session event, and a Remote method that scopes itself with this Context reads `ctx.authIdentity` in Host code before any request is assembled.

#### Token effect

This package produces no text that enters a request.

#### KV Cache effect

No request prefix this package contributes changes; the Remote methods a consumer scopes with this Context own any model-visible result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No Remote method declares `context: 'auth'` yet, so the Client adapter is wired and covered but not yet exercised by an application. The first consumer is expected to arrive with the multi-tenant API phase.
- Tenant and role come from the Custom Access Token Hook, not from a `user_tenant_roles` read. A token issued before the hook was deployed carries no claims, and a token whose claims predate a membership change keeps the role the hook wrote until it expires. Tenant status is re-checked on every resolution; the role is not.
- Only `status = 'active'` tenants resolve, so `suspended` and `deleted` both refuse rather than producing a distinct outcome.
- The adapter trusts the page global. Any script running on the page can replace `__DSH_AUTH__` before a call, and the Host re-validates the token it receives, so the exposure is limited to choosing which token this browser presents.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host and Client halves are separate compiler faces: `tsconfig.host.json` builds `src/index.ts` and `tsconfig.client.json` builds `src/client/index.ts`, and both read the `TypertContextMap` merge from `src/types.ts` so the browser program never pulls the Host service's Supabase and Node imports. `supabaseAdminClient` is a peer dependency because it is a shared singleton: the Host service and the HTTP auth routes must observe the same client instance.

</details>

**Runtime invariant:** No companion is published. Each resolution re-reads the Supabase-owned session, tenant, and profile rows and returns a value rather than retaining an observed relationship.
