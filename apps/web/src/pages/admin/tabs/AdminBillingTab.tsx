import { formatCurrency } from '../../../lib/format'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'

interface AdminBillingRow {
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  plan_id: string | null
  plan_name: string
  plan_slug: string
  monthly_price_cents: number | null
  annual_price_cents: number | null
  token_limit_input: number | null
  token_limit_output: number | null
  max_workspaces: number | null
  max_sessions: number | null
  storage_gb: number | null
  ai_tier: string | null
  subscription_status: string
  subscription_interval: string
  cancel_at_period_end: boolean
  current_period_end: string | null
  trial_ends_at: string | null
  trial_used: boolean
  trial_tokens_used: number
  current_period_tokens_used: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
  updated_at: string
  total_count: number
}

interface BillingKPIs {
  mrr_estimated_cents: number
  active_subscriptions: number
  trialing_tenants: number
  past_due_subscriptions: number
  canceled_subscriptions: number
  total_cycle_tokens: number
}

type RpcCaller = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

const STRIPE_DASHBOARD_BASE = 'https://dashboard.stripe.com'

export function AdminBillingTab() {
  const [tenants, setTenants] = useState<AdminBillingRow[]>([])
  const [kpis, setKpis] = useState<BillingKPIs | null>(null)

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [selectedPlan, setSelectedPlan] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedInterval, setSelectedInterval] = useState<string>('')

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(25)
  const [totalCount, setTotalCount] = useState<number>(0)

  // Drawer / Inspection
  const [inspectingTenant, setInspectingTenant] = useState<AdminBillingRow | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setCurrentPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Load Billing Data & KPIs
  const loadBillingData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
      const [kpisRes, listRes] = await Promise.all([
        callRpc('get_admin_billing_kpis'),
        callRpc('get_admin_billing_tenants', {
          p_search: debouncedSearch.trim() || null,
          p_plan_slug: selectedPlan || null,
          p_status: selectedStatus || null,
          p_interval: selectedInterval || null,
          p_page: currentPage,
          p_page_size: pageSize,
        }),
      ])

      if (kpisRes.error) throw new Error(`KPIs: ${kpisRes.error.message}`)
      if (listRes.error) throw new Error(`Tenants: ${listRes.error.message}`)

      setKpis(kpisRes.data as BillingKPIs)

      const rows = (listRes.data as AdminBillingRow[]) || []
      setTenants(rows)

      const firstRow = rows[0]
      if (firstRow && firstRow.total_count !== undefined) {
        setTotalCount(Number(firstRow.total_count))
      } else {
        setTotalCount(0)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.billing.loadError')
      console.error('Failed to load billing data:', err)
      setError(msg)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [debouncedSearch, selectedPlan, selectedStatus, selectedInterval, currentPage, pageSize])

  useEffect(() => {
    loadBillingData()
  }, [loadBillingData])

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(label)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Format currency
  const formatCurrencyLocal = (cents: number) => {
    return formatCurrency((cents || 0) / 100)
  }

  // Format tokens
  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`
    return (num || 0).toLocaleString('en-US')
  }

  // Format date
  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return '-'
    const d = new Date(isoStr)
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Status Badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)', color: 'var(--cm-success)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-success)', display: 'inline-block' }} />
            {t('admin.billing.statusActive')}
          </span>
        )
      case 'trial':
      case 'trialing':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-primary) 15%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-primary)', display: 'inline-block' }} />
            {t('admin.billing.statusTrialing')}
          </span>
        )
      case 'trial_expired':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-secondary)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {t('admin.billing.statusTrialExpired')}
          </span>
        )
      case 'past_due':
      case 'unpaid':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', color: 'var(--cm-destructive)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cm-destructive)', display: 'inline-block' }} />
            {t('admin.billing.statusPastDue')}
          </span>
        )
      case 'canceled':
      case 'deleted':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-secondary)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {t('admin.billing.statusCanceled')}
          </span>
        )
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-secondary)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {status}
          </span>
        )
    }
  }

  // Plan Badge
  const getPlanBadge = (slug: string, name: string) => {
    switch (slug?.toLowerCase()) {
      case 'legend':
        return (
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-primary) 15%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
            {name || t('admin.billing.planLegend')}
          </span>
        )
      case 'pro':
        return (
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)', color: 'var(--cm-success)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)' }}>
            {name || t('admin.billing.planPro')}
          </span>
        )
      case 'starter':
        return (
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-background)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {name || t('admin.billing.planStarter')}
          </span>
        )
      default:
        return (
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--cm-card)', color: 'var(--cm-muted-foreground)', border: '1px solid var(--cm-border)' }}>
            {name || t('admin.billing.planFree')}
          </span>
        )
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const hasActiveFilters = Boolean(debouncedSearch || selectedPlan || selectedStatus || selectedInterval)

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--cm-border)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.billing.title')}</h2>
            <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-primary) 20%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)' }}>
              {t('admin.billing.activeSubscriptionsBadge', { count: kpis?.active_subscriptions ?? 0 })}
            </span>
            {kpis && (
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500, background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)', color: 'var(--cm-success)', border: '1px solid color-mix(in srgb, var(--cm-success) 30%, transparent)' }}>
                {t('admin.billing.mrrBadge', { value: formatCurrencyLocal(kpis.mrr_estimated_cents) })}
              </span>
            )}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: '4px 0 0 0' }}>
            {t('admin.billing.subtitle')}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a
            href={STRIPE_DASHBOARD_BASE}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 16px', background: 'color-mix(in srgb, var(--cm-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--cm-primary)', cursor: 'pointer', textDecoration: 'none' }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>{t('admin.billing.openStripe')}</span>
          </a>

          <button
            onClick={() => loadBillingData(true)}
            disabled={isLoading || isRefreshing}
            title={t('admin.billing.refreshAria')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 16px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '8px', fontSize: '12px', fontWeight: 500, color: 'var(--cm-foreground)', cursor: 'pointer', opacity: isLoading || isRefreshing ? 0.5 : 1 }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-muted-foreground)', animation: isRefreshing ? 'cm-auth-spin 0.8s linear infinite' : undefined }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? t('admin.common.refreshing') : t('admin.common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="adminGrid">
        <div className="adminCard" style={{ border: '2px solid var(--cm-primary)' }}>
          <div className="adminCardLabel">{t('admin.billing.estimatedMrr')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis ? formatCurrencyLocal(kpis.mrr_estimated_cents) : '-'}</div>
          <div className="adminCardSub">{t('admin.billing.recurringRevenue')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.billing.activeSubscriptions')}</div>
          <div className="adminCardValue">{kpis ? kpis.active_subscriptions.toLocaleString('en-US') : '-'}</div>
          <div className="adminCardSub">{t('admin.billing.activeHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.billing.trialing')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis ? kpis.trialing_tenants.toLocaleString('en-US') : '-'}</div>
          <div className="adminCardSub">{t('admin.billing.trialingHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.billing.pastDue')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-destructive)' }}>{kpis ? kpis.past_due_subscriptions.toLocaleString('en-US') : '-'}</div>
          <div className="adminCardSub">{t('admin.billing.pastDueHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.billing.cycleTokens')}</div>
          <div className="adminCardValue">{kpis ? formatTokens(kpis.total_cycle_tokens) : '-'}</div>
          <div className="adminCardSub">{t('admin.billing.cycleHint')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder={t('admin.billing.searchPlaceholder')}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="adminInput"
          style={{ width: '240px', marginBottom: 0 }}
        />
        <select
          value={selectedPlan}
          onChange={(e) => {
            setSelectedPlan(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="">{t('admin.billing.allPlans')}</option>
          <option value="starter">{t('admin.billing.planStarter')}</option>
          <option value="pro">{t('admin.billing.planPro')}</option>
          <option value="legend">{t('admin.billing.legend')}</option>
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => {
            setSelectedStatus(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '180px', marginBottom: 0 }}
        >
          <option value="">{t('admin.billing.allStatuses')}</option>
          <option value="active">{t('admin.billing.statusActive')}</option>
          <option value="trial">{t('admin.billing.statusTrialing')}</option>
          <option value="past_due">{t('admin.billing.pastDue')}</option>
          <option value="canceled">{t('admin.billing.statusCanceled')}</option>
          <option value="trial_expired">{t('admin.billing.statusTrialExpired')}</option>
        </select>
        <select
          value={selectedInterval}
          onChange={(e) => {
            setSelectedInterval(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="">{t('admin.billing.allIntervals')}</option>
          <option value="month">{t('admin.billing.monthly')}</option>
          <option value="year">{t('admin.billing.annual')}</option>
        </select>
        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearchTerm('')
              setSelectedPlan('')
              setSelectedStatus('')
              setSelectedInterval('')
              setCurrentPage(1)
            }}
            style={{ fontSize: '12px', color: 'var(--cm-primary)', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline' }}
          >
            {t('admin.common.clearAllFilters')}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, margin: 0 }}>{t('admin.billing.loadError')}</p>
            <p style={{ margin: '2px 0 0 0' }}>{error}</p>
          </div>
          <button
            onClick={() => loadBillingData()}
            style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)', color: 'var(--cm-destructive)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
          >
            {t('admin.common.retry')}
          </button>
        </div>
      )}

      <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="adminTable">
            <thead>
              <tr>
                <th>{t('admin.common.tenant')}</th>
                <th>{t('admin.billing.plan')}</th>
                <th style={{ textAlign: 'center' }}>{t('admin.common.status')}</th>
                <th>{t('admin.billing.cycleTokensColumn')}</th>
                <th>{t('admin.billing.renewal')}</th>
                <th>{t('admin.billing.stripeIds')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !isRefreshing ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      <div style={{ width: '24px', height: '24px', border: '2px solid var(--cm-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'cm-auth-spin 0.8s linear infinite' }} />
                      <span style={{ fontSize: '12px' }}>{t('admin.billing.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.billing.empty')}</p>
                      <p style={{ fontSize: '12px', margin: 0 }}>
                        {debouncedSearch || selectedPlan || selectedStatus || selectedInterval
                          ? t('admin.common.tryAdjustFilters')
                          : t('admin.billing.emptyTenants')}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                tenants.map((row) => {
                  const tokenLimit = (row.token_limit_input || 0) + (row.token_limit_output || 0)
                  const tokenUsage = row.current_period_tokens_used || 0
                  const usagePercent = tokenLimit > 0 ? Math.min(100, Math.round((tokenUsage / tokenLimit) * 100)) : 0

                  return (
                    <tr key={row.tenant_id}>
                      <td style={{ maxWidth: '220px' }}>
                        <div style={{ fontWeight: 500, color: 'var(--cm-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.tenant_name}>
                          {row.tenant_name}
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }} title={row.tenant_slug}>
                          {row.tenant_slug}
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {getPlanBadge(row.plan_slug, row.plan_name)}
                          <span style={{ fontSize: '11px', color: 'var(--cm-muted-foreground)', textTransform: 'capitalize', fontWeight: 500 }}>
                            {row.subscription_interval || t('admin.billing.monthlyFallback')}
                          </span>
                        </div>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        {getStatusBadge(row.subscription_status)}
                        {row.cancel_at_period_end && (
                          <div style={{ fontSize: '10px', color: 'var(--cm-destructive)', marginTop: '4px' }}>{t('admin.billing.cancelsAtEnd')}</div>
                        )}
                      </td>

                      <td style={{ minWidth: '150px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{formatTokens(tokenUsage)}</span>
                          <span style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px' }}>
                            {tokenLimit > 0 ? `/ ${formatTokens(tokenLimit)}` : t('admin.billing.unlimitedFallback')}
                          </span>
                        </div>
                        {tokenLimit > 0 && (
                          <div style={{ height: '6px', borderRadius: '3px', background: 'var(--cm-secondary)', overflow: 'hidden' }}>
                            <div
                              style={{ height: '100%', borderRadius: '3px', background: usagePercent > 90 ? 'var(--cm-destructive)' : 'var(--cm-primary)', width: `${usagePercent}%` }}
                            />
                          </div>
                        )}
                      </td>

                      <td style={{ color: 'var(--cm-muted-foreground)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {row.subscription_status === 'trialing' || row.subscription_status === 'trial' ? (
                          <div>
                            <span style={{ color: 'var(--cm-primary)', fontWeight: 500, display: 'block' }}>{t('admin.billing.trialEnds')}</span>
                            <span>{formatDate(row.trial_ends_at)}</span>
                          </div>
                        ) : (
                          <div>
                            <span style={{ color: 'var(--cm-foreground)', display: 'block' }}>{t('admin.billing.periodEnd')}</span>
                            <span>{formatDate(row.current_period_end)}</span>
                          </div>
                        )}
                      </td>

                      <td style={{ maxWidth: '180px' }}>
                        {row.stripe_customer_id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cm-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.stripe_customer_id}>
                              {row.stripe_customer_id}
                            </span>
                            <button
                              onClick={() => handleCopy(row.stripe_customer_id || '', `cust_${row.tenant_id}`)}
                              style={{ fontSize: '10px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap' }}
                              title={t('admin.billing.copyCustomerAria')}
                            >
                              {copiedId === `cust_${row.tenant_id}` ? '✓' : t('admin.common.copy')}
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px', fontStyle: 'italic' }}>{t('admin.billing.noStripeCustomer')}</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => setInspectingTenant(row)}
                          style={{ padding: '4px 10px', borderRadius: '6px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                          title={t('admin.billing.inspectAria')}
                        >
                          {t('admin.common.details')}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderTop: '1px solid var(--cm-border)', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--cm-muted-foreground)' }}>
            <span>{t('admin.common.showingOf', { count: tenants.length, total: totalCount, unit: t('admin.billing.subscriptionsUnit') })}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{t('admin.common.rowsPerPage')}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="adminInput"
                style={{ width: '72px', height: '28px', marginBottom: 0, fontSize: '12px' }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)' }}>
              {t('admin.common.pageOf', { page: currentPage, total: totalPages })}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isLoading}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', opacity: (currentPage <= 1 || isLoading) ? 0.4 : 1, fontSize: '12px' }}
              >
                {t('admin.common.previous')}
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || isLoading}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--cm-border)', background: 'var(--cm-card)', color: 'var(--cm-foreground)', cursor: 'pointer', opacity: (currentPage >= totalPages || isLoading) ? 0.4 : 1, fontSize: '12px' }}
              >
                {t('admin.common.next')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {inspectingTenant && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'var(--cm-overlay)', backdropFilter: 'blur(4px)' }}
            onClick={() => setInspectingTenant(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setInspectingTenant(null)
            }}
            style={{ position: 'relative', width: '100%', maxWidth: '640px', margin: '24px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--cm-shadow)', maxHeight: '80vh', overflowY: 'auto', outline: 'none', color: 'var(--cm-foreground)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--cm-border)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--cm-primary)', display: 'inline-block' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.billing.subscriptionAudit')}</h3>
                {getStatusBadge(inspectingTenant.subscription_status)}
              </div>
              <button
                onClick={() => setInspectingTenant(null)}
                style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--cm-muted-foreground)', fontSize: '16px' }}
                title={t('admin.common.close')}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('admin.billing.tenantOrganization')}</span>
                <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingTenant.tenant_name}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--cm-muted-foreground)', marginTop: '2px' }}>{inspectingTenant.tenant_slug}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', padding: '16px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.contractedPlan')}</span>
                  <div style={{ marginTop: '4px' }}>{getPlanBadge(inspectingTenant.plan_slug, inspectingTenant.plan_name)}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.billingCycle')}</span>
                  <span style={{ fontWeight: 500, color: 'var(--cm-foreground)', textTransform: 'capitalize' }}>
                    {inspectingTenant.subscription_interval || t('admin.billing.monthlyFallback')}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.monthlyPrice')}</span>
                  <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>
                    {formatCurrencyLocal(inspectingTenant.monthly_price_cents || 0)}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.annualPrice')}</span>
                  <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>
                    {formatCurrencyLocal(inspectingTenant.annual_price_cents || 0)}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.currentPeriodEnd')}</span>
                  <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{formatDate(inspectingTenant.current_period_end)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '12px' }}>{t('admin.billing.trialExpiration')}</span>
                  <span style={{ fontSize: '12px', color: 'var(--cm-foreground)' }}>{formatDate(inspectingTenant.trial_ends_at)}</span>
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--cm-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>{t('admin.billing.planLimits')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: 'var(--cm-muted-foreground)', display: 'block' }}>{t('admin.billing.maxWorkspaces')}</span>
                    <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingTenant.max_workspaces ?? t('admin.common.unlimited')}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--cm-muted-foreground)', display: 'block' }}>{t('admin.billing.maxSessions')}</span>
                    <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingTenant.max_sessions ?? t('admin.common.unlimited')}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--cm-muted-foreground)', display: 'block' }}>{t('admin.billing.storage')}</span>
                    <span style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{inspectingTenant.storage_gb ?? 0} GB</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--cm-muted-foreground)', display: 'block' }}>{t('admin.billing.aiTier')}</span>
                    <span style={{ fontWeight: 500, color: 'var(--cm-primary)', textTransform: 'capitalize' }}>{inspectingTenant.ai_tier ?? t('admin.billing.standardFallback')}</span>
                  </div>
                </div>

                <div style={{ paddingTop: '8px', marginTop: '12px', borderTop: '1px solid var(--cm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                  <span>{t('admin.billing.cycleTokensLine', { value: formatTokens(inspectingTenant.current_period_tokens_used) })}</span>
                  <span>{t('admin.billing.trialTokensLine', { value: formatTokens(inspectingTenant.trial_tokens_used) })}</span>
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', background: 'var(--cm-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 600, color: 'var(--cm-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-primary)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {t('admin.billing.stripeIdsTitle')}
                  </div>
                  {inspectingTenant.stripe_customer_id && (
                    <a
                      href={`${STRIPE_DASHBOARD_BASE}/customers/${inspectingTenant.stripe_customer_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', background: 'color-mix(in srgb, var(--cm-primary) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-primary) 40%, transparent)', color: 'var(--cm-primary)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}
                    >
                      <span>{t('admin.billing.openInStripe')}</span>
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', borderRadius: '6px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)' }}>
                    <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                      <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '10px' }}>{t('admin.billing.customerId')}</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{inspectingTenant.stripe_customer_id || t('admin.common.notAssigned')}</span>
                    </div>
                    {inspectingTenant.stripe_customer_id && (
                      <button
                        onClick={() => handleCopy(inspectingTenant.stripe_customer_id || '', 'drawer_cust')}
                        style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', background: 'none', border: '1px solid var(--cm-border)', borderRadius: '4px', padding: '2px 8px', whiteSpace: 'nowrap' }}
                      >
                        {copiedId === 'drawer_cust' ? `✓ ${t('admin.common.copied')}` : t('admin.common.copy')}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', borderRadius: '6px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)' }}>
                    <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                      <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', fontSize: '10px' }}>{t('admin.billing.subscriptionId')}</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--cm-foreground)' }}>{inspectingTenant.stripe_subscription_id || t('admin.common.notAssigned')}</span>
                    </div>
                    {inspectingTenant.stripe_subscription_id && (
                      <button
                        onClick={() => handleCopy(inspectingTenant.stripe_subscription_id || '', 'drawer_sub')}
                        style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)', cursor: 'pointer', background: 'none', border: '1px solid var(--cm-border)', borderRadius: '4px', padding: '2px 8px', whiteSpace: 'nowrap' }}
                      >
                        {copiedId === 'drawer_sub' ? `✓ ${t('admin.common.copied')}` : t('admin.common.copy')}
                      </button>
                    )}
                  </div>
                </div>

                {inspectingTenant.cancel_at_period_end && (
                  <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', color: 'var(--cm-destructive)', fontSize: '12px', marginTop: '12px' }}>
                    <strong>{t('admin.billing.cancellationScheduled')}</strong> {t('admin.billing.cancellationNote')}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '16px', marginTop: '16px', borderTop: '1px solid var(--cm-border)' }}>
              <span style={{ fontSize: '12px', color: 'var(--cm-muted-foreground)' }}>
                {t('admin.billing.readOnly')}
              </span>
              <button
                onClick={() => setInspectingTenant(null)}
                style={{ height: '32px', padding: '0 16px', background: 'transparent', border: '1px solid var(--cm-border)', borderRadius: '6px', color: 'var(--cm-foreground)', cursor: 'pointer', fontSize: '13px' }}
              >
                {t('admin.common.cancelAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
