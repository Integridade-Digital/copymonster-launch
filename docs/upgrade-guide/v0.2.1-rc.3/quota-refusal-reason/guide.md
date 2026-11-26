---
kind: upgrade-guide
description: "A quota refusal now reports the exhausted allowance under `session/quota-exceeded`, and the gate lets the deployment profile's own administrator through."
---

# Quota refusals name the exhausted allowance

English | [中文](guide.zh.md)

## Change

`session/quota-exceeded` now carries a stable `details.reason` of `quota_exceeded`, `trial_expired`, or `trial_tokens_exhausted`; the message names the allowance instead of the generic provider failure. Copy handling that code gets a specific explanation rather than "the AI service is unstable".

The gate skips `check_my_tenant_quota` only when the profile installs the `copymonster` default provider **and** the caller's own `get_my_tenant_metrics` row is neither inactive nor a past-due trial. Every other refusal, including an unreadable local row, still blocks. This lets the installation's own administrator—whose signed identity may lack the platform flag—keep working after their trial ends, without releasing a tenant that really exhausted its allowance.

Migration `062` keeps `trial_ends_at` out of billing: a paid subscription past its old trial is judged by `current_period_tokens_used` against the plan limits, and the trial counters stop growing after the trial ends.

## Migration

1. Apply `supabase/migrations/062_tenant_usage_reset_and_local_row.sql` before rolling out the Host build; the gate's local read uses the `get_my_tenant_metrics` payload, which the migration extends.
2. Rebuild the Host artifacts so every tenant process runs the updated `session-controller`.
3. Update Clients that key recovery copy on the refusal message; use `details.reason` instead.
4. Confirm the change with `check_tenant_quota` for the operator tenant (expected `allowed: true`) and for a tenant whose trial tokens are exhausted (expected `allowed: false`).
