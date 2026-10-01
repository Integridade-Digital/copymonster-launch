import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

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
      const callRpc = supabase.rpc as unknown as RpcCaller
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
      const msg = err instanceof Error ? err.message : 'Failed to fetch billing data.'
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
  const formatCurrency = (cents: number) => {
    const amount = (cents || 0) / 100
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Active
          </span>
        )
      case 'trial':
      case 'trialing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e7bf73]/20 text-[#e7bf73] border border-[#e7bf73]/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e7bf73] animate-pulse" />
            Trialing
          </span>
        )
      case 'trial_expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#8b949e]/15 text-[#8b949e] border border-[#8b949e]/30">
            Trial Expired
          </span>
        )
      case 'past_due':
      case 'unpaid':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Past Due
          </span>
        )
      case 'canceled':
      case 'deleted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#30363d] text-[#8b949e]">
            Canceled
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#30363d] text-[#8b949e]">
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
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[#e7bf73]/20 text-[#e7bf73] border border-[#e7bf73]/40">
            {name || 'Legend'}
          </span>
        )
      case 'pro':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {name || 'Pro'}
          </span>
        )
      case 'starter':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            {name || 'Starter'}
          </span>
        )
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#161b22] text-[#8b949e] border border-[#30363d]">
            {name || 'Free'}
          </span>
        )
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="space-y-6 text-[#f0f6fc]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#30363d]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-[#f0f6fc]">Billing & Subscriptions</h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#e7bf73]/20 text-[#e7bf73] border border-[#e7bf73]/30">
              {kpis?.active_subscriptions ?? 0} active subscriptions
            </span>
            {kpis && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                MRR: {formatCurrency(kpis.mrr_estimated_cents)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#8b949e] mt-1">
            Global overview of recurring revenue, tenant subscriptions, token consumption, and Stripe lifecycle.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href={STRIPE_DASHBOARD_BASE}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg border border-[#b0955e]/50 bg-[#161b22] hover:bg-[#b0955e]/20 text-xs font-semibold text-[#e7bf73] transition flex items-center gap-1.5 shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>Open Stripe Dashboard</span>
          </a>

          <button
            onClick={() => loadBillingData(true)}
            disabled={isLoading || isRefreshing}
            className="px-3 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-xs font-medium text-[#f0f6fc] transition flex items-center gap-1.5 disabled:opacity-50"
            title="Refresh billing data"
          >
            <svg
              className={`w-3.5 h-3.5 text-[#8b949e] ${isRefreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Estimated MRR */}
        <div className="p-3.5 rounded-xl border border-[#b0955e]/40 bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#e7bf73]" />
            Estimated MRR
          </div>
          <div className="text-xl font-bold text-[#e7bf73] mt-1">
            {kpis ? formatCurrency(kpis.mrr_estimated_cents) : '-'}
          </div>
        </div>

        {/* Active Subscriptions */}
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Active Subscriptions
          </div>
          <div className="text-xl font-bold text-[#f0f6fc] mt-1">
            {kpis ? kpis.active_subscriptions.toLocaleString('en-US') : '-'}
          </div>
        </div>

        {/* Trialing */}
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#d8ae5f]" />
            Trialing
          </div>
          <div className="text-xl font-bold text-[#d8ae5f] mt-1">
            {kpis ? kpis.trialing_tenants.toLocaleString('en-US') : '-'}
          </div>
        </div>

        {/* Past Due */}
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <div className="text-xs text-[#8b949e] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Past Due
          </div>
          <div className="text-xl font-bold text-rose-400 mt-1">
            {kpis ? kpis.past_due_subscriptions.toLocaleString('en-US') : '-'}
          </div>
        </div>

        {/* Cycle Tokens */}
        <div className="p-3.5 rounded-xl border border-[#30363d] bg-[#161b22]/70 col-span-2 sm:col-span-1">
          <div className="text-xs text-[#8b949e] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#b0955e]" />
            Cycle Tokens Used
          </div>
          <div className="text-xl font-bold text-[#f0f6fc] mt-1">
            {kpis ? formatTokens(kpis.total_cycle_tokens) : '-'}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/50 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search */}
          <div className="sm:col-span-4 relative">
            <input
              type="text"
              placeholder="Search by tenant, slug, or Stripe ID..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 pl-9 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#f0f6fc] placeholder-[#8b949e] focus:outline-none focus:border-[#e7bf73] transition"
            />
            <svg
              className="w-4 h-4 text-[#8b949e] absolute left-3 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-xs text-[#8b949e] hover:text-[#f0f6fc]"
              >
                ✕
              </button>
            )}
          </div>

          {/* Plan Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedPlan}
              onChange={(e) => {
                setSelectedPlan(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">All Plans</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="legend">Legend</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="trial">Trialing / Trial</option>
              <option value="past_due">Past Due</option>
              <option value="canceled">Canceled</option>
              <option value="trial_expired">Trial Expired</option>
            </select>
          </div>

          {/* Interval Filter */}
          <div className="sm:col-span-2">
            <select
              value={selectedInterval}
              onChange={(e) => {
                setSelectedInterval(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">All Intervals</option>
              <option value="month">Monthly</option>
              <option value="year">Annual</option>
            </select>
          </div>
        </div>

        {/* Filters Summary */}
        {(debouncedSearch || selectedPlan || selectedStatus || selectedInterval) && (
          <div className="flex items-center justify-between text-xs text-[#8b949e] pt-2 border-t border-[#30363d]/50">
            <span>Filtered results: {totalCount} tenants.</span>
            <button
              onClick={() => {
                setSearchTerm('')
                setSelectedPlan('')
                setSelectedStatus('')
                setSelectedInterval('')
                setCurrentPage(1)
              }}
              className="text-[#e7bf73] hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-xl text-rose-300 text-sm flex items-center justify-between">
          <div>
            <p className="font-semibold">Error loading billing data</p>
            <p className="text-xs text-rose-400 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => loadBillingData()}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs rounded-lg transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tenants Billing Table */}
      <div className="border border-[#30363d] rounded-xl overflow-hidden bg-[#161b22]/70">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#f0f6fc]">
            <thead className="bg-[#161b22] border-b border-[#30363d] text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Cycle Tokens</th>
                <th className="px-4 py-3">Renewal / Trial</th>
                <th className="px-4 py-3">Stripe IDs</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]/60">
              {isLoading && !isRefreshing ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#8b949e]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-6 h-6 animate-spin text-[#e7bf73]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4" stroke="currentColor" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-xs">Loading billing data...</span>
                    </div>
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#8b949e]">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <p className="text-base font-medium text-[#f0f6fc]">No subscriptions found</p>
                      <p className="text-xs text-[#8b949e]">
                        {debouncedSearch || selectedPlan || selectedStatus || selectedInterval
                          ? 'Try adjusting your search filters above.'
                          : 'No tenants or billing records registered yet.'}
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
                    <tr key={row.tenant_id} className="hover:bg-[#30363d]/20 transition-colors">
                      {/* Tenant */}
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="font-medium text-[#f0f6fc] truncate" title={row.tenant_name}>
                          {row.tenant_name}
                        </div>
                        <div className="font-mono text-[11px] text-[#8b949e] truncate mt-0.5" title={row.tenant_slug}>
                          {row.tenant_slug}
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {getPlanBadge(row.plan_slug, row.plan_name)}
                          <span className="text-[11px] text-[#8b949e] capitalize font-medium">
                            {row.subscription_interval || 'monthly'}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        {getStatusBadge(row.subscription_status)}
                        {row.cancel_at_period_end && (
                          <div className="text-[10px] text-amber-400 mt-0.5">Cancels at end</div>
                        )}
                      </td>

                      {/* Cycle Tokens */}
                      <td className="px-4 py-3 min-w-[150px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-mono text-[#f0f6fc]">{formatTokens(tokenUsage)}</span>
                          <span className="text-[#8b949e] text-[11px]">
                            {tokenLimit > 0 ? `/ ${formatTokens(tokenLimit)}` : 'unlimited'}
                          </span>
                        </div>
                        {tokenLimit > 0 && (
                          <div className="w-full bg-[#0d1117] h-1.5 rounded-full overflow-hidden border border-[#30363d]">
                            <div
                              className={`h-full transition-all ${
                                usagePercent > 90 ? 'bg-rose-500' : usagePercent > 70 ? 'bg-amber-400' : 'bg-[#e7bf73]'
                              }`}
                              style={{ width: `${usagePercent}%` }}
                            />
                          </div>
                        )}
                      </td>

                      {/* Renewal / Trial Date */}
                      <td className="px-4 py-3 text-xs text-[#8b949e] whitespace-nowrap">
                        {row.subscription_status === 'trialing' || row.subscription_status === 'trial' ? (
                          <div>
                            <span className="text-[#e7bf73] font-medium block">Trial ends</span>
                            <span>{formatDate(row.trial_ends_at)}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="text-[#f0f6fc] block">Period end</span>
                            <span>{formatDate(row.current_period_end)}</span>
                          </div>
                        )}
                      </td>

                      {/* Stripe IDs */}
                      <td className="px-4 py-3 text-xs max-w-[180px]">
                        {row.stripe_customer_id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-[#8b949e] truncate" title={row.stripe_customer_id}>
                              {row.stripe_customer_id}
                            </span>
                            <button
                              onClick={() => handleCopy(row.stripe_customer_id || '', `cust_${row.tenant_id}`)}
                              className="text-[10px] text-[#8b949e] hover:text-[#e7bf73] transition"
                              title="Copy Customer ID"
                            >
                              {copiedId === `cust_${row.tenant_id}` ? '✓' : 'Copy'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[#8b949e] text-[11px] italic">No Stripe customer</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right text-xs">
                        <button
                          onClick={() => setInspectingTenant(row)}
                          className="px-2.5 py-1 rounded bg-[#161b22] border border-[#30363d] hover:border-[#e7bf73] text-[#f0f6fc] hover:text-[#e7bf73] transition font-medium"
                          title="Inspect billing details"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination & Footer */}
        <div className="px-4 py-3 bg-[#161b22] border-t border-[#30363d] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#8b949e]">
          <div className="flex items-center gap-2">
            <span>
              Showing {tenants.length} of {totalCount} subscriptions (Page {currentPage} of {totalPages})
            </span>
            <span className="text-[#30363d]">|</span>
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="bg-[#0d1117] border border-[#30363d] rounded px-1.5 py-0.5 text-xs text-[#f0f6fc]"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || isLoading}
              className="px-2.5 py-1 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#30363d]/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <span className="font-medium text-[#f0f6fc] px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isLoading}
              className="px-2.5 py-1 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#30363d]/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* DRAWER / MODAL DE INSPEÇÃO DE FATURAMENTO (READ-ONLY) */}
      {inspectingTenant && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInspectingTenant(null)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
        >
          <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/60">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#e7bf73]" />
                <h3 className="text-base font-bold text-[#f0f6fc]">Subscription Audit</h3>
                {getStatusBadge(inspectingTenant.subscription_status)}
              </div>
              <button
                onClick={() => setInspectingTenant(null)}
                className="text-[#8b949e] hover:text-[#f0f6fc] text-sm p-1 rounded-lg hover:bg-[#30363d]/40 transition"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {/* Tenant info */}
              <div>
                <label className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Tenant Organization</label>
                <div className="text-base font-medium text-[#f0f6fc] mt-1">{inspectingTenant.tenant_name}</div>
                <div className="font-mono text-xs text-[#8b949e] mt-0.5">{inspectingTenant.tenant_slug}</div>
              </div>

              {/* Grid: Plan & Cycle Details */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-[#30363d] bg-[#0d1117]/60">
                <div>
                  <span className="text-xs text-[#8b949e] block">Contracted Plan</span>
                  <div className="mt-1">{getPlanBadge(inspectingTenant.plan_slug, inspectingTenant.plan_name)}</div>
                </div>
                <div>
                  <span className="text-xs text-[#8b949e] block">Billing Cycle</span>
                  <span className="font-medium text-[#f0f6fc] capitalize">
                    {inspectingTenant.subscription_interval || 'monthly'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#8b949e] block">Monthly Price</span>
                  <span className="font-medium text-[#f0f6fc]">
                    {formatCurrency(inspectingTenant.monthly_price_cents || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#8b949e] block">Annual Price</span>
                  <span className="font-medium text-[#f0f6fc]">
                    {formatCurrency(inspectingTenant.annual_price_cents || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#8b949e] block">Current Period End</span>
                  <span className="text-xs text-[#f0f6fc]">{formatDate(inspectingTenant.current_period_end)}</span>
                </div>
                <div>
                  <span className="text-xs text-[#8b949e] block">Trial Expiration</span>
                  <span className="text-xs text-[#f0f6fc]">{formatDate(inspectingTenant.trial_ends_at)}</span>
                </div>
              </div>

              {/* Plan Limits & Consumption */}
              <div className="p-4 rounded-xl border border-[#30363d] bg-[#0d1117]/60 space-y-3">
                <div className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Plan Limits & Usage</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[#8b949e] block">Max Workspaces</span>
                    <span className="font-medium text-[#f0f6fc]">{inspectingTenant.max_workspaces ?? 'Unlimited'}</span>
                  </div>
                  <div>
                    <span className="text-[#8b949e] block">Max Sessions</span>
                    <span className="font-medium text-[#f0f6fc]">{inspectingTenant.max_sessions ?? 'Unlimited'}</span>
                  </div>
                  <div>
                    <span className="text-[#8b949e] block">Storage</span>
                    <span className="font-medium text-[#f0f6fc]">{inspectingTenant.storage_gb ?? 0} GB</span>
                  </div>
                  <div>
                    <span className="text-[#8b949e] block">AI Tier</span>
                    <span className="font-medium text-[#d8ae5f] capitalize">{inspectingTenant.ai_tier ?? 'standard'}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#30363d]/50">
                  <div className="flex items-center justify-between text-xs text-[#8b949e] mb-1">
                    <span>Cycle Tokens: {formatTokens(inspectingTenant.current_period_tokens_used)}</span>
                    <span>Trial Tokens: {formatTokens(inspectingTenant.trial_tokens_used)}</span>
                  </div>
                </div>
              </div>

              {/* Stripe Gateway Integration Box */}
              <div className="p-4 rounded-xl border border-[#b0955e]/40 bg-[#161b22] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#e7bf73] uppercase tracking-wider">
                    <svg className="w-4 h-4 text-[#e7bf73]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    Stripe Customer & Subscription IDs
                  </div>
                  {inspectingTenant.stripe_customer_id && (
                    <a
                      href={`${STRIPE_DASHBOARD_BASE}/customers/${inspectingTenant.stripe_customer_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded bg-[#b0955e]/20 hover:bg-[#b0955e]/30 border border-[#b0955e]/40 text-[#e7bf73] text-xs font-medium transition flex items-center gap-1"
                    >
                      <span>Open in Stripe</span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-[#0d1117] border border-[#30363d]">
                    <div className="truncate mr-2">
                      <span className="text-[#8b949e] block text-[10px]">Stripe Customer ID</span>
                      <span className="font-mono text-[#f0f6fc]">{inspectingTenant.stripe_customer_id || 'Not assigned'}</span>
                    </div>
                    {inspectingTenant.stripe_customer_id && (
                      <button
                        onClick={() => handleCopy(inspectingTenant.stripe_customer_id || '', 'drawer_cust')}
                        className="text-xs text-[#8b949e] hover:text-[#e7bf73] whitespace-nowrap transition px-2 py-0.5 rounded border border-[#30363d]"
                      >
                        {copiedId === 'drawer_cust' ? '✓ Copied' : 'Copy'}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-2 rounded bg-[#0d1117] border border-[#30363d]">
                    <div className="truncate mr-2">
                      <span className="text-[#8b949e] block text-[10px]">Stripe Subscription ID</span>
                      <span className="font-mono text-[#f0f6fc]">{inspectingTenant.stripe_subscription_id || 'Not assigned'}</span>
                    </div>
                    {inspectingTenant.stripe_subscription_id && (
                      <button
                        onClick={() => handleCopy(inspectingTenant.stripe_subscription_id || '', 'drawer_sub')}
                        className="text-xs text-[#8b949e] hover:text-[#e7bf73] whitespace-nowrap transition px-2 py-0.5 rounded border border-[#30363d]"
                      >
                        {copiedId === 'drawer_sub' ? '✓ Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>

                {inspectingTenant.cancel_at_period_end && (
                  <div className="p-2.5 rounded bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs">
                    ⚠️ <strong>Cancellation Scheduled:</strong> This subscription is
                    marked to cancel automatically at the end of the billing period in Stripe.
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="px-6 py-4 border-t border-[#30363d] bg-[#0d1117]/60 flex items-center justify-between">
              <span className="text-xs text-[#8b949e]">
                Read-only view. Manage payments and refunds via Stripe Dashboard.
              </span>
              <button
                onClick={() => setInspectingTenant(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-xs font-medium text-[#f0f6fc] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
