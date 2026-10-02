import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import './billing.css'

export type BillingCycle = 'monthly' | 'annual'

export interface PlanPricingItem {
  id: string
  name: string
  slug: string
  tagline: string
  monthlyPrice: number
  annualPrice: number
  annualPerMonthPrice: number
  monthlyPriceId: string
  annualPriceId: string
  tokenAllowanceInput: string
  tokenAllowanceOutput: string
  totalTokensMonthly: string
  maxWorkspaces: string
  maxSessions: string
  storage: string
  aiTier: string
  featured?: boolean
  features: string[]
}

const STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/login/cNi14p0HG1Iv8HqbgN2Nq00'

export const PRICING_PLANS: PlanPricingItem[] = [
  {
    id: 'starter',
    name: 'Starter',
    slug: 'starter',
    tagline: 'Essential autonomous copywriting pipeline for solo creators and emerging marketers.',
    monthlyPrice: 97,
    annualPrice: 600,
    annualPerMonthPrice: 50,
    monthlyPriceId: 'price_1SqRcbRiKNxooUH09cijDYsq',
    annualPriceId: 'price_1UK6ToRiKNxooUH0cNSm1DLp',
    tokenAllowanceInput: '2,000,000 tokens',
    tokenAllowanceOutput: '1,000,000 tokens',
    totalTokensMonthly: '3,000,000 tokens/month',
    maxWorkspaces: '1 Isolated Workspace',
    maxSessions: '5 Concurrent Sessions',
    storage: '1 GB Secure Storage',
    aiTier: 'Standard AI Engine',
    features: [
      '3,000,000 monthly tokens (2M input / 1M output)',
      '1 isolated workspace with secure data isolation',
      'Up to 5 concurrent agent execution sessions',
      'Full campaign copy templates & funnel structures',
      'Automated email & social copy pipelines',
      'Community & email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    slug: 'pro',
    tagline: 'High-octane multi-agent workflows for growing brands, agencies, and performance teams.',
    monthlyPrice: 297,
    annualPrice: 1800,
    annualPerMonthPrice: 150,
    monthlyPriceId: 'price_1SqRe4RiKNxooUH0tYyprM4P',
    annualPriceId: 'price_1UK6UuRiKNxooUH0IomDOBgN',
    tokenAllowanceInput: '7,000,000 tokens',
    tokenAllowanceOutput: '3,000,000 tokens',
    totalTokensMonthly: '10,000,000 tokens/month',
    maxWorkspaces: '5 Isolated Workspaces',
    maxSessions: '20 Concurrent Sessions',
    storage: '10 GB Secure Storage',
    aiTier: 'Advanced Multi-Agent AI Engine',
    featured: true,
    features: [
      '10,000,000 monthly tokens (7M input / 3M output)',
      '5 isolated workspaces with granular RBAC permissions',
      'Up to 20 concurrent execution sessions',
      'Advanced multi-agent autonomous reasoning',
      'High-converting VSL, sales page & webinar scripts',
      '10 GB high-performance storage',
      'Priority model execution queue & priority support',
    ],
  },
  {
    id: 'legend',
    name: 'Legend',
    slug: 'legend',
    tagline: 'Maximum throughput, dedicated capacity, and custom agent infrastructure for high-scale operators.',
    monthlyPrice: 997,
    annualPrice: 5600,
    annualPerMonthPrice: 466,
    monthlyPriceId: 'price_1UK6P1RiKNxooUH0uikg0x4f',
    annualPriceId: 'price_1UK6VtRiKNxooUH0GjMUV9Wb',
    tokenAllowanceInput: '25,000,000 tokens',
    tokenAllowanceOutput: '10,000,000 tokens',
    totalTokensMonthly: '35,000,000 tokens/month',
    maxWorkspaces: 'Unlimited Workspaces',
    maxSessions: 'Unlimited Sessions',
    storage: '100 GB Dedicated Storage',
    aiTier: 'Premium Dedicated AI Infrastructure',
    features: [
      '35,000,000 monthly tokens (25M input / 10M output)',
      'Unlimited workspaces with bespoke access controls',
      'Unlimited concurrent agent sessions',
      '100 GB dedicated enterprise storage',
      'Custom tone-of-voice fine-tuning & prompt libraries',
      'Dedicated SLA, priority compute lane & account manager',
    ],
  },
]

interface DbTenantRow {
  id: string
  name: string
  subscription_status?: string | null
  current_period_end?: string | null
  plan_id?: string | null
  trial_ends_at?: string | null
  trial_used?: boolean | null
  trial_tokens_used?: number | null
  current_period_tokens_used?: number | null
  subscription_interval?: string | null
  stripe_customer_id?: string | null
}

interface TenantDetails {
  id: string
  name: string
  subscription_status: string
  current_period_end: string | null
  plan_id: string | null
  trial_ends_at: string | null
  trial_used: boolean
  trial_tokens_used: number
  current_period_tokens_used: number
  subscription_interval: string | null
  stripe_customer_id: string | null
}

interface CheckoutResponse {
  url?: string
  error?: string
  message?: string
}

export interface PlansUser {
  id?: string | undefined
  email?: string | undefined
  tenantId?: string | undefined
  role?: string | undefined
}

export interface PlansPageProps {
  currentUser?: PlansUser | null | undefined
}

export function PlansPage({ currentUser }: PlansPageProps = {}) {
  const [user, setUser] = useState<PlansUser | null | undefined>(currentUser)

  useEffect(() => {
    if (currentUser !== undefined) {
      setUser(currentUser)
    } else {
      void supabase.auth.getUser().then(async ({ data: { user: authUser } }) => {
        if (!authUser) return
        const { data: roleRow } = await supabase
          .from('user_tenant_roles')
          .select('role, tenant_id')
          .eq('user_id', authUser.id)
          .limit(1)
          .maybeSingle()
        setUser({
          id: authUser.id,
          email: authUser.email ?? undefined,
          role: roleRow?.role ? String(roleRow.role) : undefined,
          tenantId: roleRow?.tenant_id ? String(roleRow.tenant_id) : undefined,
        })
      })
    }
  }, [currentUser])
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual')
  const [tenant, setTenant] = useState<TenantDetails | null>(null)
  const [planMap, setPlanMap] = useState<Record<string, { id: string; slug: string; name: string }>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [processingPriceId, setProcessingPriceId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    void loadTenantAndPlans()
  }, [user?.tenantId])

  async function loadTenantAndPlans(): Promise<void> {
    try {
      setIsLoading(true)
      setActionError(null)

      const { data: dbPlans } = await supabase
        .from('plans')
        .select('id, slug, name')
        .eq('is_active', true)

      if (dbPlans) {
        const mapping: Record<string, { id: string; slug: string; name: string }> = {}
        for (const p of dbPlans) {
          mapping[p.id] = p
          mapping[p.slug] = p
        }
        setPlanMap(mapping)
      }

      const tenantId = user?.tenantId
      if (tenantId) {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle()

        if (tenantData) {
          const row = tenantData as unknown as DbTenantRow
          setTenant({
            id: row.id,
            name: row.name,
            subscription_status: row.subscription_status ?? 'trialing',
            current_period_end: row.current_period_end ?? null,
            plan_id: row.plan_id ?? null,
            trial_ends_at: row.trial_ends_at ?? null,
            trial_used: Boolean(row.trial_used),
            trial_tokens_used: typeof row.trial_tokens_used === 'number' ? row.trial_tokens_used : 0,
            current_period_tokens_used: typeof row.current_period_tokens_used === 'number'
              ? row.current_period_tokens_used
              : 0,
            subscription_interval: row.subscription_interval ?? null,
            stripe_customer_id: row.stripe_customer_id ?? null,
          })
        }
      }
    } catch (err: unknown) {
      console.error('Error fetching subscription data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubscribe(priceId: string): Promise<void> {
    setActionError(null)
    setProcessingPriceId(priceId)

    try {
      const sessionResult = await supabase.auth.getSession()
      const token = sessionResult.data.session?.access_token

      if (!token) {
        throw new Error('You must be logged in to initiate checkout. Please refresh or sign in again.')
      }

      const host = window.location.origin
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${host}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${host}/billing/cancel`,
        }),
      })

      const data = (await response.json().catch(() => null)) as CheckoutResponse | null

      if (!response.ok) {
        const msg = data?.error ?? data?.message ?? `Checkout failed (${response.status})`
        throw new Error(msg)
      }

      if (data?.url) {
        window.location.href = data.url
      } else {
        throw new Error('No checkout redirection URL was returned.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setActionError(message)
      setProcessingPriceId(null)
    }
  }

  function getTrialDaysRemaining(): number {
    if (!tenant?.trial_ends_at) return 0
    const diff = new Date(tenant.trial_ends_at).getTime() - Date.now()
    if (diff <= 0) return 0
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const currentPlanSlug = tenant?.plan_id ? (planMap[tenant.plan_id]?.slug ?? 'pro') : null
  const isTrialing = tenant?.subscription_status === 'trialing'
  const isTrialExpired = tenant?.subscription_status === 'trial_expired'
  const isActive = tenant?.subscription_status === 'active'
  const isPastDue = tenant?.subscription_status === 'past_due'
  const trialDaysLeft = getTrialDaysRemaining()
  const trialTokensUsed = tenant?.trial_tokens_used ?? 0
  const trialTokenLimit = 1000000
  const trialTokenPercent = Math.min(100, Math.round((trialTokensUsed / trialTokenLimit) * 100))

  if (isLoading) {
    return (
      <div className="cm-billing-container" style={{ textAlign: 'center', paddingTop: '6rem' }}>
        <div className="cm-billing-spinner" />
        <p style={{ marginTop: '1rem', color: '#64748b' }}>Loading pricing plans and subscription status…</p>
      </div>
    )
  }

  return (
    <div className="cm-billing-container">
      <div className="cm-billing-top-actions">
        <a
          href={STRIPE_CUSTOMER_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="cm-billing-portal-btn"
          title="Open official Stripe Customer Billing Portal"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          <span>Customer Billing Portal</span>
        </a>
      </div>

      <div className="cm-billing-header">
        <h1 className="cm-billing-title">Plans & Pricing</h1>
        <p className="cm-billing-subtitle">
          Scale your launch copywriting and autonomous AI funnels with dedicated multi-agent throughput.
        </p>
      </div>

      {isTrialing && (
        <div className="cm-billing-banner cm-billing-banner--trial">
          <div className="cm-billing-banner-header">
            <span className="cm-billing-banner-title">
              <span>🚀 7-Day Free Trial Active</span>
              <span className="cm-billing-banner-badge cm-billing-banner-badge--blue">Pro Access</span>
            </span>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e40af' }}>
              {trialDaysLeft > 0 ? `${trialDaysLeft} days remaining` : 'Expires today'}
            </span>
          </div>
          <p className="cm-billing-banner-desc">
            You have full access to our <strong>Pro plan</strong> features, including advanced multi-agent orchestration
            and up to 3 workspaces during your trial. Upon trial completion, your account transitions to the Starter tier.
          </p>
          <div className="cm-billing-progress-box">
            <div className="cm-billing-progress-label">
              <span>Trial Token Consumption</span>
              <span>{trialTokensUsed.toLocaleString()} / {trialTokenLimit.toLocaleString()} tokens ({trialTokenPercent}%)</span>
            </div>
            <div className="cm-billing-progress-track">
              <div className="cm-billing-progress-fill" style={{ width: `${trialTokenPercent}%` }} />
            </div>
          </div>
        </div>
      )}

      {isTrialExpired && (
        <div className="cm-billing-banner cm-billing-banner--expired">
          <div className="cm-billing-banner-header">
            <span className="cm-billing-banner-title">
              <span>⚠️ Free Trial Expired</span>
              <span className="cm-billing-banner-badge cm-billing-banner-badge--amber">Action Required</span>
            </span>
          </div>
          <p className="cm-billing-banner-desc">
            Your 7-day trial period or credit quota has been reached. Select a subscription plan below to reactivate
            workspace sessions, autonomous agents, and production copy generation.
          </p>
        </div>
      )}

      {isActive && (
        <div className="cm-billing-banner cm-billing-banner--active">
          <div className="cm-billing-banner-header">
            <span className="cm-billing-banner-title">
              <span>✅ Active Subscription</span>
              <span className="cm-billing-banner-badge cm-billing-banner-badge--green">
                {currentPlanSlug ? currentPlanSlug.toUpperCase() : 'ACTIVE'}
              </span>
            </span>
            {tenant.current_period_end ? (
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#15803d' }}>
                Next billing date: {new Date(tenant.current_period_end).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            ) : null}
          </div>
          <p className="cm-billing-banner-desc">
            Your workspace is active under the <strong>{currentPlanSlug ? currentPlanSlug.toUpperCase() : 'selected'}</strong>{' '}
            plan ({tenant.subscription_interval === 'year' ? 'Annual Billing' : 'Monthly Billing'}).
            {tenant.current_period_tokens_used > 0 ? (
              <> Tokens consumed in current cycle: <strong>{tenant.current_period_tokens_used.toLocaleString()}</strong>.</>
            ) : null}
          </p>
        </div>
      )}

      {isPastDue && (
        <div className="cm-billing-banner cm-billing-banner--danger">
          <div className="cm-billing-banner-header">
            <span className="cm-billing-banner-title">
              <span>⚠️ Payment Past Due</span>
              <span className="cm-billing-banner-badge cm-billing-banner-badge--amber">Suspension Risk</span>
            </span>
          </div>
          <p className="cm-billing-banner-desc">
            Your recent subscription payment attempt failed. Please update your payment method through the{' '}
            <strong>Customer Billing Portal</strong> to prevent interruption of autonomous services.
          </p>
        </div>
      )}

      {actionError ? (
        <div
          style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#b91c1c',
            fontSize: '0.875rem',
          }}
        >
          <strong>Error: </strong>
          {actionError}
        </div>
      ) : null}

      <div className="cm-billing-toggle-wrap">
        <button
          type="button"
          onClick={() => { setBillingCycle('monthly') }}
          className={`cm-billing-toggle-btn ${billingCycle === 'monthly' ? 'cm-billing-toggle-btn--active' : ''}`}
        >
          Monthly Billing
        </button>
        <button
          type="button"
          onClick={() => { setBillingCycle('annual') }}
          className={`cm-billing-toggle-btn ${billingCycle === 'annual' ? 'cm-billing-toggle-btn--active' : ''}`}
        >
          <span>Annual Billing</span>
          <span className="cm-billing-discount-tag">Save up to 50%</span>
        </button>
      </div>

      <div className="cm-billing-grid">
        {PRICING_PLANS.map((plan) => {
          const isSelectedPlan = isActive && currentPlanSlug === plan.slug
          const price = billingCycle === 'annual' ? plan.annualPerMonthPrice : plan.monthlyPrice
          const priceId = billingCycle === 'annual' ? plan.annualPriceId : plan.monthlyPriceId
          const isProcessingThis = processingPriceId === priceId

          return (
            <div
              key={plan.id}
              className={`cm-plan-card ${plan.featured ? 'cm-plan-card--featured' : ''} ${isSelectedPlan ? 'cm-plan-card--current' : ''}`}
            >
              {plan.featured ? <div className="cm-plan-card-tag">Most Popular</div> : null}

              <div className="cm-plan-header">
                <h2 className="cm-plan-name">{plan.name}</h2>
                <p className="cm-plan-desc">{plan.tagline}</p>
              </div>

              <div className="cm-plan-price-wrap">
                <span className="cm-plan-price">${price}</span>
                <span className="cm-plan-period">/ month</span>
              </div>

              {billingCycle === 'annual' ? (
                <div className="cm-plan-billing-note" style={{ marginBottom: '1.5rem' }}>
                  Billed annually at ${plan.annualPrice}/year (save ${(plan.monthlyPrice * 12) - plan.annualPrice}/yr)
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => { void handleSubscribe(priceId) }}
                disabled={isSelectedPlan || isProcessingThis}
                className={`cm-plan-action-btn ${
                  isSelectedPlan
                    ? 'cm-plan-action-btn--current'
                    : plan.featured
                      ? 'cm-plan-action-btn--primary'
                      : 'cm-plan-action-btn--secondary'
                }`}
              >
                {isProcessingThis
                  ? 'Redirecting to Checkout…'
                  : isSelectedPlan
                    ? 'Current Plan'
                    : `Subscribe to ${plan.name}`}
              </button>

              <div className="cm-plan-features">
                <h3 className="cm-plan-features-title">Plan Specifications & Limits</h3>
                <ul className="cm-plan-features-list">
                  <li className="cm-plan-feature-item">
                    <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span><strong>Token Quota:</strong> {plan.totalTokensMonthly}</span>
                  </li>
                  <li className="cm-plan-feature-item">
                    <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span><strong>Workspaces:</strong> {plan.maxWorkspaces}</span>
                  </li>
                  <li className="cm-plan-feature-item">
                    <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span><strong>Concurrency:</strong> {plan.maxSessions}</span>
                  </li>
                  <li className="cm-plan-feature-item">
                    <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span><strong>Storage:</strong> {plan.storage}</span>
                  </li>
                  <li className="cm-plan-feature-item">
                    <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span><strong>AI Architecture:</strong> {plan.aiTier}</span>
                  </li>

                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="cm-plan-feature-item">
                      <svg className="cm-plan-feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>

      <div className="cm-billing-faq-section">
        <h2 className="cm-billing-faq-heading">Frequently Asked Questions</h2>

        <details className="cm-billing-faq-item">
          <summary className="cm-billing-faq-summary">
            <span>How does the 7-day Free Trial work?</span>
            <svg className="cm-billing-faq-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="cm-billing-faq-content">
            Every new organization automatically receives 7 days of full access to the Pro tier, backed by 1,000,000 trial tokens
            (500k input + 500k output) and up to 3 isolated workspaces. No credit card is required to begin. Once the trial ends,
            you can select any paid plan or transition to the Starter tier.
          </div>
        </details>

        <details className="cm-billing-faq-item">
          <summary className="cm-billing-faq-summary">
            <span>Can I manage or cancel my subscription at any time?</span>
            <svg className="cm-billing-faq-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="cm-billing-faq-content">
            Yes. You can manage payment methods, view invoices, or cancel your subscription at any time via the official
            Stripe Customer Billing Portal button above. If you cancel, your access remains active until the end of your prepaid period.
          </div>
        </details>

        <details className="cm-billing-faq-item">
          <summary className="cm-billing-faq-summary">
            <span>What happens when I reach my monthly token quota?</span>
            <svg className="cm-billing-faq-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="cm-billing-faq-content">
            Your monthly token allocation covers both prompt inputs and AI agent generation outputs. If your tenant reaches its
            monthly limit, workspaces and saved assets remain accessible, and you can instantly upgrade your tier
            to unlock additional volume.
          </div>
        </details>

        <details className="cm-billing-faq-item">
          <summary className="cm-billing-faq-summary">
            <span>Are workspaces strictly isolated between tenants?</span>
            <svg className="cm-billing-faq-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="cm-billing-faq-content">
            Yes. CopyMonster enforces strict multi-tenant database Row-Level Security (RLS) and isolated sandbox environments.
            Workspaces, files, conversation sessions, and API credentials are completely partitioned
            and inaccessible to other organizations.
          </div>
        </details>
      </div>
    </div>
  )
}
