# Authentication Subsystem

The `auth` subsystem provides bearer token authentication and identity resolution for the DeepSeek Harness.

## Services

### `auth` (Service)
**Defined in**: `packages/api/auth-context/src/index.ts`

The `AuthService` resolves bearer tokens to authenticated user identities. It validates JWT tokens and extracts tenant/user identity claims.

#### Methods
- `resolveIdentity(token: AuthToken): Promise<UserIdentity | undefined>` — Resolve a bearer token to a user identity, or return undefined for invalid/expired tokens.
- `resolveContext(token: AuthToken): Promise<Context | undefined>` — Resolve a token and extend the caller context with the authenticated identity.

#### Context Properties
- `ctx.authIdentity: UserIdentity` — The authenticated identity for the current call (only present in scoped Remote invocations).

## Client-Side

### `authToken` (Context Value)
**Defined in**: `packages/api/auth-context/src/client/index.ts`

The client publishes the current access token as `ctx.authToken`. This token is sourced from the Supabase session (`supabaseClient.auth.getSession()`).

### `auth` Client Context Adapter
The `auth` client context adapter provides the wire identity for scoped Remote invocations:
- `identity(ctx)` — Returns the published access token from `globalThis.__DSH_AUTH__.accessToken`
- `resolve(token)` — Returns an extended context with `authToken` if the token matches the published one

## Types

### `AuthToken`
**Defined in**: `packages/api/auth-context/src/types.ts`

```typescript
export type AuthToken = string
```

A bearer token string as issued by Supabase authentication.

### `UserIdentity`
**Defined in**: `packages/api/auth-context/src/types.ts`

```typescript
export interface UserIdentity {
  tenantId: string
  userId: string
  role: UserRole
  email: string
}
```

The resolved identity carrying tenant, user, role, and email claims.

## Wire Protocol

Scoped Remote invocations with `@RemoteScope('auth', ...)` carry the `AuthToken` as a wire argument. The gateway decodes the token and resolves it via `AuthService.resolveIdentity`, extending the receiver context with `authIdentity`.

## Integration

The `auth` service is used by:
- `workspaceController` — for per-user workspace sandbox isolation (`@RemoteScope('auth')`)
- `directoryPickerController` — for sandbox-confined directory operations
- `settingsController` — for tenant admin operations

## Configuration

The auth subsystem requires a Supabase project with JWT authentication configured. The `DEEPSEEK_API_KEY` environment variable must be set for the Supabase admin client.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauth--authservice"></a>

### `ctx.auth` — `AuthService`

`ctx.auth`: resolve bearer tokens to CopyMonster identities.

A resolution failure is not an exception for Typert lookups — the adapter returns `undefined` so Gateway answers the stable `context-not-found` fault. Direct callers (HTTP routes) get `undefined` too and decide their own status.

```ts cordis-catalog
/**
 * Resolve one bearer token to the caller identity.
 *
 * The active tenant and role come from the `tenant_id` and `user_role` claims
 * that the Supabase Custom Access Token Hook writes into the JWT, so the
 * Custom Access Token Hook decides the membership and this service only
 * confirms the tenant is still usable. A token that names no tenant, names no
 * role, names the `anonymous` role, or names a tenant that is not `active`
 * resolves to `undefined`: an authenticated user without a usable membership
 * gets no identity rather than a downgraded one.
 *
 * Hits the local in-memory LRU cache first to prevent repeated round-trips to Supabase.
 * @param token - Supabase-issued JWT presented by the caller.
 * @returns the identity, or `undefined` when the token is absent, invalid,
 *   expired, carries no usable tenant or role claim, names a tenant that is
 *   not active, or no longer maps to a known profile.
 */
async resolveIdentity(token: AuthToken): Promise<UserIdentity | undefined>

/**
 * Clears the in-memory identity cache.
 * Useful for test isolation or explicit revocation.
 */
clearCache(): void

/**
 * Resolve one bearer token to the child Context a scoped Remote method runs in.
 *
 * The child is a plain `ctx.extend(...)` overlay carrying `authIdentity`;
 * it creates no fiber and holds no registrations, so it needs no teardown.
 * @param token - Supabase-issued JWT presented by the caller.
 * @returns the identity-carrying Context, or `undefined` when unresolved.
 */
async resolveContext(token: AuthToken): Promise<Context | undefined>
```

Source: [`packages/api/auth-context/src/index.ts`](../../packages/api/auth-context/src/index.ts)
<!-- END GENERATED cordis-surface -->