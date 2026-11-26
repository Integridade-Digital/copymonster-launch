---
kind: upgrade-guide
description: "拒绝配额的 `session/quota-exceeded` 现在报告已用尽的额度，并且该检查放行部署配置自身的管理员。"
---

# 配额拒绝会说明已用尽的额度

[English](guide.md) | 中文

## 变更

`session/quota-exceeded` 现在携带稳定的 `details.reason`：`quota_exceeded`、`trial_expired` 或 `trial_tokens_exhausted`；提示语说明已达上限的额度，而不是通用的供应商故障。按该错误码处理的文案会得到具体说明，而不是“AI 服务暂时不稳定”。

只有当配置安装了 `copymonster` 默认供应商，**并且**调用者自己的 `get_my_tenant_metrics` 行既非停用状态也非过期的试用时，检查才会跳过 `check_my_tenant_quota`。其他拒绝——包括本地行无法读取——仍然阻止请求。这样，安装本身的管理员（其签名身份可能不带平台标志）在试用结束后仍可继续工作，同时不会放行真正用尽额度的租户。

迁移 `062` 把 `trial_ends_at` 移出计费判断：试用期已过但仍为有效付费订阅的账户，按 `current_period_tokens_used` 与套餐上限比较；试用结束后试用计数不再增长。

## 迁移

1. 在发布 Host 构建之前应用 `supabase/migrations/062_tenant_usage_reset_and_local_row.sql`；该检查的本地读取使用迁移扩展后的 `get_my_tenant_metrics` 返回值。
2. 重新构建 Host 产物，使每个租户进程运行更新后的 `session-controller`。
3. 更新按拒绝消息匹配恢复文案的客户端，改用 `details.reason`。
4. 用 `check_tenant_quota` 确认：操作员租户应返回 `allowed: true`；试用令牌已用尽的租户应返回 `allowed: false`。
