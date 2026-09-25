---
description: "CopyMonster 身份服务：把 Supabase bearer token 解析为限定在租户内的用户身份，并为 `auth` Context 类别提供 Typert 的 Host 与 Client Context 适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-auth-context

[English](README.md) | 中文

## 概述

面向 `auth` Typert Context 类别的 CopyMonster 身份解析。Host 入口提供 `ctx.auth`，把 Supabase bearer token 转为 `UserIdentity`；`@deepseek-ai/dsh-api-auth-context/client` 则把已登录调用方的 access token 作为同一 Context 类别的 wire identity 发布。两半分属两个独立包的接口面，却共处一个包：声明 `context: 'auth'` 的 Remote 方法两者都需要，而 token 成为身份的唯一入口仍只有 Host 那一半。

## 目录

- [Host 服务：`AuthService`（ctx key：`auth`）](#host-service-authservice-ctx-key-auth)
- [Client 适配器：`auth-client`](#client-adapter-auth-client)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="host-service-authservice-ctx-key-auth"></a>
## Host 服务：`AuthService`（ctx key：`auth`）

`ctx.auth.resolveIdentity(token)` 用 `supabaseAdminClient.auth.getUser()` 校验 token，读取 Supabase Custom Access Token Hook 写入 JWT 的 `tenant_id` 与 `user_role` claim，并返回 `{ userId, tenantId, role, email }`；profile 行携带 `fullName`、`whatsapp` 与 `avatarUrl` 时一并返回。服务随后确认 claim 指定的租户仍能解析为一条 `active` 行，并按已校验的用户 id 从 `users` 读取 profile：成员关系由 hook 决定，本服务只拒绝已不可用的租户。`role` 收窄为 `owner`、`admin` 或 `member`；`anonymous` 成员关系以及该词汇之外的任何取值都解析为无身份，而不是降级的身份，因为只持有该角色的调用方没有可供其行动的租户。

失败不是异常。缺失、被拒绝或过期的 token、不是 JSON 对象的载荷、缺失或为空的 `tenant_id` 或 `user_role`、非 `active` 的租户，以及读不到或不存在的 profile，全部解析为 `undefined`：Typert lookup 因此答以稳定的 `context-not-found` 故障，而不会把 Supabase 错误抛给调用方。紧凑 JWS 载荷的解码不校验签名，因为在读取任何 claim 之前，`getUser()` 已经用 Supabase 校验过该 token。

`ctx.auth.resolveContext(token)` 把该身份包进普通的 `ctx.extend({ authIdentity })` overlay，既不创建 fiber，也不持有注册。构造函数在 `ctx.inject(['typert'], ...)` 内注册 `auth` 类别的 Host Context 适配器，绑定到 `authToken` wire 字段与 `@copymonster/auth#AuthToken` 类型符号；因此该注册随 Typert 注册表一同出现，并随本插件一同卸载。标记 `@RemoteScope` 的 Remote 方法通过该适配器解析接收者，因此作用域方法体从 `ctx.authIdentity` 读取身份。

<a id="client-adapter-auth-client"></a>
## Client 适配器：`auth-client`

`@deepseek-ai/dsh-api-auth-context/client` 是同一 Context 类别的浏览器那一半。它导出 `name`、`inject` 与 `apply`——没有默认导出，因此 Loader 会保留插件的 namespace——并为 `auth` 注册一个 Client Context 适配器，用页面当前发布的 access token 回答 `identity`。声明 `context: 'auth'` 的 Remote 方法以作用域投影的形式到达浏览器，缺少该适配器时 client Gateway 会拒绝调用它；`resolve` 把 token 转为携带 `authToken` 的子 Context。

页面通过 `__DSH_AUTH__` 全局变量发布会话，方式与 `__DSH_TRANSPORT__` 把 Host 拥有的传输事实带进浏览器插件一致，并由 `apps/web/src/main.tsx` 在 `supabaseClient.auth.onAuthStateChange()` 中写入。适配器自身不保存会话，每次调用都重新读取该全局变量，因此登出或 token 刷新在下一次调用时即刻生效，无需重载；它也只对同一应用根下的 Context 回答 `identity`。已登出的页面不发布任何 token，适配器返回 `undefined` 而不是空字符串。

## 模型体验

### 调用方身份解析

#### 模型看到什么

无。本包不注册任何提示词、工具或会话事件；以该 Context 限定作用域的 Remote 方法在任何请求组装之前，于 Host 代码中读取 `ctx.authIdentity`。

#### Token 影响

本包不产生任何进入请求的文本。

#### KV Cache 影响

本包贡献的请求前缀不会发生任何变化；消费方用该 Context 限定作用域的 Remote 方法负责任何模型可见结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 目前还没有 Remote 方法声明 `context: 'auth'`，因此 Client 适配器已完成接线与测试覆盖，却还没有被应用真正调用。首个消费方预计随多租户 API 阶段到来。
- 租户与角色来自 Custom Access Token Hook，而不是读取 `user_tenant_roles`。hook 部署前签发的 token 不携带任何 claim；claim 早于成员关系变更的 token 会一直保留 hook 写入的角色，直到它过期。每次解析都会重新检查租户状态，角色则不会。
- 只有 `status = 'active'` 的租户能解析成功，因此 `suspended` 与 `deleted` 都会拒绝，不会产生各自不同的结果。
- 适配器信任页面全局变量。页面上运行的任何脚本都可以在调用前替换 `__DSH_AUTH__`，而 Host 会对收到的 token 重新校验，因此暴露面仅限于选择这个浏览器出示哪个 token。

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

Host 与 Client 两半是不同的 compiler face：`tsconfig.host.json` 构建 `src/index.ts`，`tsconfig.client.json` 构建 `src/client/index.ts`，两者都从 `src/types.ts` 读取 `TypertContextMap` 的合并声明，因此浏览器 program 绝不会引入 Host 服务的 Supabase 与 Node import。`supabaseAdminClient` 是对等依赖（peer dependency），因为它是共享单例：Host 服务与 HTTP auth 路由必须观察到同一个 client 实例。

</details>

**运行时不变式：** 不发布伴生入口。每次解析都重新读取 Supabase 拥有的会话、租户与 profile 行，并返回一个值，而不是保留任何被观察到的关系。
