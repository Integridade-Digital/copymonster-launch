# Agent Note: `customer.subscription.created` 激活租户

Status: implemented

[English](2026-11-11-subscription-created-activates-tenant.md) | 中文

## Problem

Stripe webhook 处理 `customer.subscription.updated`，却让 `customer.subscription.created` 落入仅确认的 default 分支。通过 Checkout 售出的订阅因此无法把租户从 `trialing` 移出：`tenants.subscription_status` 保持试用值，`stripe_subscription_id` 始终为空，而 Stripe 报告订阅为 `active` 时 `check_tenant_quota` 仍返回 `trial_expired`。

读取 payload 的方式也与 webhook 的 API 版本不符。该 endpoint 使用 `2025-08-27.basil`，此版本把 `current_period_end` 报告在每条 subscription item 上，并从 subscription 本身移除，因此 handler 在 subscription 层读取时没有存下账期结束时间。handler 另外逐字取用 `items.data[0]`：当订阅在付费计划之外保留一条数量为 0 的旧项目时，会从未使用的价格解析计划。

## Decision

`created` 与 `updated` 共用一条更新路径。它记录 `stripe_subscription_id`，从已计费的项目解析计划，并把账期结束时间取为已计费数量项目中最新的 `current_period_end`；旧版 payload 则回退到 subscription 层的时间戳。没有已计费项目或都没有账期结束时间时，保留已存的值而不清空。

没有任何计划出售的价格不会改动 `plan_id`。Checkout 价格 `price_1UaLC3…` 与 `price_1UaLDaR…` 是 Pro Monster 产品的 $0「trial offer」项目，而非 Pro 价格（$89/月、$924/年）。把它们映射到 `pro` 计划会让任何携带 $0 项目的 checkout 获得付费计划，因此修复属于选择价格所在的 Stripe Checkout 配置，而不是 `plans`。

## Verification

- [`billing.spec.ts`](../../../../packages/api/auth-http/tests/billing.spec.ts) 固定 `created` 时的激活、subscription id、项目级账期结束时间、旧版 subscription 层回退、在首条项目未计费时选择已计费项目，以及 payload 不含账期结束时间时保留已存值。

## Consequences

没有匹配计划而被激活的租户仍按已存的计划通过配额网关，激活与计划解析因此相互独立。不含账期结束时间的事件保留已存值而不清空。

## Alternatives considered

- 在 `plans` 中允许 $0 价格 id，使该账号映射到 `pro`：拒绝，因为该价格是每个 checkout 共享的 trial offer，映射会构成通往付费计划的免费通道。
- API 未返回时以 `start_date + 30 days` 推导账期结束时间：拒绝，因为该回退会凭空编造计费日期。项目本身已携带权威时间戳。
