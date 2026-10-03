# 认证子系统

`auth` 子系统为 DeepSeek Harness 提供持有者令牌认证和身份解析。

## 服务

### `auth` (服务)
**定义位置**: `packages/api/auth-context/src/index.ts`

`AuthService` 将持有者令牌解析为经过认证的用户身份。它验证 JWT 令牌并提取租户/用户身份声明。

#### 方法
- `resolveIdentity(token: AuthToken): Promise<UserIdentity | undefined>` — 将持有者令牌解析为用户身份，若令牌无效或过期则返回 undefined。
- `resolveContext(token: AuthToken): Promise<Context | undefined>` — 解析令牌并使用经过认证的身份扩展调用者上下文。

#### 上下文属性
- `ctx.authIdentity: UserIdentity` — 当前调用的经过认证的身份（仅存在于带作用域的 Remote 调用中）。

## 客户端

### `authToken` (上下文值)
**定义位置**: `packages/api/auth-context/src/client/index.ts`

客户端将当前访问令牌发布为 `ctx.authToken`。该令牌来源于 Supabase 会话 (`supabaseClient.auth.getSession()`)。

### `auth` 客户端上下文适配器
`auth` 客户端上下文适配器为带作用域的 Remote 调用提供 wire 身份：
- `identity(ctx)` — 从 `globalThis.__DSH_AUTH__.accessToken` 返回发布的访问令牌
- `resolve(token)` — 若令牌与发布的匹配，返回带有 `authToken` 的扩展上下文

## 类型

### `AuthToken`
**定义位置**: `packages/api/auth-context/src/types.ts`

```typescript
export type AuthToken = string
```

由 Supabase 认证签发的持有者令牌字符串。

### `UserIdentity`
**定义位置**: `packages/api/auth-context/src/types.ts`

```typescript
export interface UserIdentity {
  tenantId: string
  userId: string
  role: UserRole
  email: string
}
```

携带租户、用户、角色和邮箱声明的解析身份。

## 线协议

带 `@RemoteScope('auth', ...)` 的带作用域 Remote 调用将 `AuthToken` 作为 wire 参数传递。网关解码令牌并通过 `AuthService.resolveIdentity` 解析，用 `authIdentity` 扩展接收者上下文。

## 集成

`auth` 服务被以下组件使用：
- `workspaceController` — 用于按用户隔离工作区沙箱 (`@RemoteScope('auth')`)
- `directoryPickerController` — 用于沙箱限定的目录操作
- `settingsController` — 用于租户管理操作

## 配置

认证子系统需要配置带有 JWT 认证的 Supabase 项目。必须设置 `DEEPSEEK_API_KEY` 环境变量以供 Supabase 管理客户端使用。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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