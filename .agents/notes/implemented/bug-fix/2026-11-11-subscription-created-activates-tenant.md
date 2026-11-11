# Agent Note: `customer.subscription.created` activates the tenant

Status: implemented

English | [中文](2026-11-11-subscription-created-activates-tenant.zh.md)

## Problem

The Stripe webhook handled `customer.subscription.updated` but fell through `customer.subscription.created` to the acknowledge-only default. A subscription sold through Checkout therefore never moved the tenant off `trialing`: `tenants.subscription_status` kept the trial value, `stripe_subscription_id` stayed empty, and `check_tenant_quota` answered `trial_expired` while Stripe reported the subscription as `active`.

Reading the payload also disagreed with the webhook's API version. The endpoint runs `2025-08-27.basil`, which reports `current_period_end` on each subscription item and omits it from the subscription, so the handler's subscription-level read stored no period end. The handler additionally took `items.data[0]` verbatim: a subscription that keeps an earlier line at quantity 0 beside the paid plan would resolve the plan from the unused price.

## Decision

`created` and `updated` share one update path. It records `stripe_subscription_id`, resolves the plan from the billed line item, and derives the period end as the latest `current_period_end` among items with a billed quantity, falling back to the subscription-level timestamp of an older payload. When no line item is billed, or none carries a period end, the stored value is left untouched rather than cleared.

A price no plan sells leaves `plan_id` unchanged. The Checkout prices `price_1UaLC3…` and `price_1UaLDaR…` are $0 "trial offer" lines of the Pro Monster product, not the Pro prices ($89/month, $924/year). Mapping them onto the `pro` plan would grant a paid plan to any checkout carrying a $0 line, so the fix belongs in the Stripe Checkout configuration that selects the price, not in `plans`.

## Verification

- [`billing.spec.ts`](../../../../packages/api/auth-http/tests/billing.spec.ts) pins activation on `created`, the subscription id, the item-level period end, the older subscription-level fallback, billed-item selection with an unbilled first line, and leaving the period end untouched when the payload carries none.

## Consequences

A tenant activated without a matching plan still passes the quota gate on the plan already stored, so activation and plan resolution stay independent. An event carrying no period end preserves the stored one instead of clearing it.

## Alternatives considered

- Allowlisting the $0 price ids in `plans` so this account maps to `pro`: rejected because the price is a trial offer shared by every checkout, and the mapping would be a free path into a paid plan.
- Deriving the period end as `start_date + 30 days` when the API returns none: rejected because the fallback would silently invent a billing date. The item already carries the authoritative timestamp.
