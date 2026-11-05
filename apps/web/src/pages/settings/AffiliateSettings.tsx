import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { t } from '../../locales'
import { isValidAffiliateRef } from '../../lib/affiliate'
import { errorText } from '../../lib/error-text'
import css from './AffiliateSettings.module.css'

interface AffiliateProfile {
  id: string
  user_id: string
  full_name: string
  cpf_cnpj: string
  paypal_email: string
  address_city: string | null
  address_state: string | null
  kyc_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  created_at: string
}

interface Commission {
  id: string
  commission_amount: number
  status: string
  eligible_at: string
  created_at: string
}

interface LedgerEntry {
  amount: number
  entry_type: 'CREDIT' | 'DEBIT'
  reference_type: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function money(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)
}

/** CPF has 11 digits and CNPJ has 14; punctuation is ignored. */
function isValidTaxId(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 || digits.length === 14
}

export function AffiliateSettings() {
  const [profile, setProfile] = useState<AffiliateProfile | null>(null)
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [minimumPayout, setMinimumPayout] = useState(50)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requestingPayout, setRequestingPayout] = useState(false)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [pendingRequest, setPendingRequest] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fullName, setFullName] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [paypalEmail, setPaypalEmail] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      const user = authData.user
      if (!user) throw new Error(t('affiliate.error.loginRequired'))

      const { data: profileData, error: profileError } = await (supabase as any)
        .schema('affiliate').from('profiles').select('*').eq('user_id', user.id).maybeSingle()
      if (profileError) throw profileError
      const currentProfile = profileData as AffiliateProfile | null
      setProfile(currentProfile)
      if (!currentProfile) return

      setPaypalEmail(currentProfile.paypal_email)
      const [commissionResult, ledgerResult, payoutResult, ruleResult] = await Promise.all([
        (supabase as any).schema('affiliate').from('commissions')
          .select('id, commission_amount, status, eligible_at, created_at')
          .eq('affiliate_id', currentProfile.id).order('created_at', { ascending: false }).limit(100),
        (supabase as any).schema('finance').from('ledger_entries')
          .select('amount, entry_type, reference_type').eq('affiliate_id', currentProfile.id),
        (supabase as any).schema('finance').from('payout_requests')
          .select('id, status').eq('affiliate_id', currentProfile.id)
          .in('status', ['REQUESTED', 'APPROVED', 'PROCESSING']),
        (supabase as any).schema('affiliate').from('commission_rules')
          .select('min_payout_amount').eq('is_current', true).maybeSingle(),
      ])
      for (const [label, result] of [
        ['commissions', commissionResult],
        ['ledger_entries', ledgerResult],
        ['payout_requests', payoutResult],
        ['commission_rules', ruleResult],
      ] as const) {
        if (result.error) {
          console.error(`affiliate settings query failed: ${label}`, result.error)
          throw result.error
        }
      }
      setCommissions((commissionResult.data ?? []) as Commission[])
      setLedger((ledgerResult.data ?? []) as LedgerEntry[])
      setPendingRequest((payoutResult.data ?? []).some((row: { status: string }) => ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(row.status)))
      setMinimumPayout(Number(ruleResult.data?.min_payout_amount ?? 50))
    } catch (loadError) {
      setError(t('affiliate.error.load', { reason: errorText(loadError) }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const balances = useMemo(() => {
    const held = commissions
      .filter(row => row.status === 'HOLDING' || row.status === 'PENDING_VALIDATION')
      .reduce((sum, row) => sum + Number(row.commission_amount), 0)
    const available = ledger.reduce((sum, row) => sum + (row.entry_type === 'CREDIT' ? Number(row.amount) : -Number(row.amount)), 0)
    const paid = ledger.filter(row => row.entry_type === 'DEBIT' && row.reference_type === 'PAYOUT')
      .reduce((sum, row) => sum + Number(row.amount), 0)
    return { held, available, paid }
  }, [commissions, ledger])

  const referralLink = useMemo(() => profile
    ? `https://app.copymonster.co/register?ref=${profile.id}`
    : '', [profile])

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!termsAccepted) {
      setError(t('affiliate.error.termsRequired'))
      return
    }
    if (!isValidTaxId(cpfCnpj)) {
      setError(t('affiliate.error.invalidTaxId'))
      return
    }
    if (!EMAIL_PATTERN.test(paypalEmail)) {
      setError(t('affiliate.error.invalidPaypalEmail'))
      return
    }
    setSaving(true)
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!authData.user) throw new Error(t('affiliate.error.loginRequired'))
      const { error: insertError } = await (supabase as any).schema('affiliate').rpc('register_profile', {
        p_full_name: fullName.trim(),
        p_cpf_cnpj: cpfCnpj.trim(),
        p_paypal_email: paypalEmail.trim().toLowerCase(),
        p_address_city: city.trim() || null,
        p_address_state: state.trim().toUpperCase() || null,
        p_terms_version: '1.0',
      })
      if (insertError) throw insertError
      setNotice(t('affiliate.register.success'))
      await load()
    } catch (saveError) {
      setError(t('affiliate.error.save', { reason: errorText(saveError) }))
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (copyError) {
      setError(t('affiliate.error.copy', { reason: errorText(copyError) }))
    }
  }

  async function handleSavePaypal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !EMAIL_PATTERN.test(paypalEmail)) {
      setError(t('affiliate.error.invalidPaypalEmail'))
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { error: updateError } = await (supabase as any).schema('affiliate').rpc('update_paypal_email', {
        p_paypal_email: paypalEmail.trim().toLowerCase(),
      })
      if (updateError) throw updateError
      setNotice(t('affiliate.paypal.saved'))
      await load()
    } catch (saveError) {
      setError(t('affiliate.error.save', { reason: errorText(saveError) }))
    } finally {
      setSaving(false)
    }
  }

  async function handlePayoutRequest() {
    if (!profile) return
    setRequestingPayout(true)
    setError('')
    setNotice('')
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const token = sessionData.session?.access_token
      if (!token) throw new Error(t('affiliate.error.loginRequired'))
      const response = await fetch('/api/affiliate/payout/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(payoutAmount) }),
      })
      const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null
      if (!response.ok) throw new Error(t(`affiliate.payout.error.${(payload?.error ?? 'unknown').replace(/[^a-z0-9_]/gi, '')}` as any))
      setNotice(t('affiliate.payout.requested'))
      await load()
    } catch (payoutError) {
      setError(t('affiliate.error.payout', { reason: errorText(payoutError) }))
    } finally {
      setRequestingPayout(false)
    }
  }

  if (loading) {
    return <div className={css.loading} role="status"><div className={css.spinner} />{t('affiliate.loading')}</div>
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h2 className={css.title}>{t('affiliate.title')}</h2>
        <p className={css.subtitle}>{t('affiliate.subtitle')}</p>
      </header>
      {error && <p className={css.error} role="alert">{error}</p>}
      {notice && <div className={`${css.notice} ${css.noticeSuccess}`} role="status">{notice}</div>}

      {!profile ? (
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('affiliate.register.title')}</h3>
          <p className={css.subtitle}>{t('affiliate.register.description')}</p>
          <form className={css.page} onSubmit={(event) => { void handleRegister(event) }}>
            <div className={css.formGrid}>
              <label className={css.formGroup}>
                <span className={css.formLabel}>{t('affiliate.field.fullName')}</span>
                <input className={css.input} value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={160} autoComplete="name" />
              </label>
              <label className={css.formGroup}>
                <span className={css.formLabel}>{t('affiliate.field.taxId')}</span>
                <input className={css.input} value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)} required maxLength={32} autoComplete="off" />
              </label>
              <label className={css.formGroup}>
                <span className={css.formLabel}>{t('affiliate.field.paypalEmail')}</span>
                <input className={css.input} type="email" value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} required maxLength={254} autoComplete="email" />
              </label>
              <label className={css.formGroup}>
                <span className={css.formLabel}>{t('affiliate.field.city')}</span>
                <input className={css.input} value={city} onChange={e => setCity(e.target.value)} maxLength={100} autoComplete="address-level2" />
              </label>
              <label className={css.formGroup}>
                <span className={css.formLabel}>{t('affiliate.field.state')}</span>
                <input className={css.input} value={state} onChange={e => setState(e.target.value)} maxLength={100} autoComplete="address-level1" />
              </label>
            </div>
            <label className={css.checkboxLabel}>
              <input className={css.checkbox} type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} required />
              <span>{t('affiliate.register.acceptTerms')}</span>
            </label>
            <button className={css.primaryButton} type="submit" disabled={saving}>
              {saving ? t('affiliate.saving') : t('affiliate.register.submit')}
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className={css.notice + ' ' + (profile.kyc_status === 'APPROVED' ? css.noticeSuccess : css.noticeWarning)}>
            {t('affiliate.kyc.status')}: <strong>{t(`affiliate.kyc.${profile.kyc_status.toLowerCase()}` as any)}</strong>
            {profile.kyc_status === 'PENDING' && <span> · {t('affiliate.kyc.pendingDescription')}</span>}
            {profile.kyc_status === 'REJECTED' && <span> · {t('affiliate.kyc.rejectedDescription')}</span>}
          </div>
          <section className={css.card}>
            <h3 className={css.cardTitle}>{t('affiliate.referral.title')}</h3>
            <p className={css.subtitle}>{t('affiliate.referral.description')}</p>
            <div className={css.referralBox}>
              <input className={css.referralInput} readOnly value={referralLink} aria-label={t('affiliate.referral.linkLabel')} />
              <button className={css.secondaryButton} type="button" onClick={() => { void handleCopy() }}>
                {copied ? t('affiliate.referral.copied') : t('affiliate.referral.copy')}
              </button>
            </div>
          </section>
          <div className={css.statsGrid}>
            <article className={css.statCard}><span className={css.statLabel}>{t('affiliate.balance.held')}</span><strong className={css.statValueGold}>{money(balances.held)}</strong></article>
            <article className={css.statCard}><span className={css.statLabel}>{t('affiliate.balance.available')}</span><strong className={css.statValueGreen}>{money(balances.available)}</strong></article>
            <article className={css.statCard}><span className={css.statLabel}>{t('affiliate.balance.paid')}</span><strong className={css.statValue}>{money(balances.paid)}</strong></article>
          </div>
          <section className={css.card}>
            <h3 className={css.cardTitle}>{t('affiliate.paypal.title')}</h3>
            <form className={css.referralBox} onSubmit={(event) => { void handleSavePaypal(event) }}>
              <input className={css.input} type="email" value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} required maxLength={254} aria-label={t('affiliate.field.paypalEmail')} />
              <button className={css.secondaryButton} type="submit" disabled={saving}>{saving ? t('affiliate.saving') : t('affiliate.paypal.save')}</button>
            </form>
          </section>
          <section className={css.card}>
            <div className={css.referralBox}>
              <div>
                <h3 className={css.cardTitle}>{t('affiliate.payout.title')}</h3>
                <p className={css.subtitle}>{t('affiliate.payout.minimum', { amount: money(minimumPayout) })}</p>
              </div>
              <input className={css.input} type="number" min={minimumPayout} max={balances.available} step="0.01" value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} placeholder={t('affiliate.payout.amountPlaceholder')} aria-label={t('affiliate.payout.amount')} />
              <button className={css.primaryButton} type="button"
                disabled={profile.kyc_status !== 'APPROVED' || Number(payoutAmount) < minimumPayout || Number(payoutAmount) > balances.available || pendingRequest || requestingPayout}
                onClick={() => { void handlePayoutRequest() }}>
                {requestingPayout ? t('affiliate.payout.requesting') : t('affiliate.payout.request')}
              </button>
            </div>
            {pendingRequest && <div className={css.notice + ' ' + css.noticeInfo}>{t('affiliate.payout.pending')}</div>}
          </section>
          <section className={css.card}>
            <h3 className={css.cardTitle}>{t('affiliate.commissions.title')}</h3>
            {commissions.length === 0 ? <p className={css.subtitle}>{t('affiliate.commissions.empty')}</p> : (
              <div className={css.tableWrapper}>
                <table className={css.table}>
                  <thead><tr>
                    <th className={css.th}>{t('affiliate.commissions.date')}</th>
                    <th className={css.th}>{t('affiliate.commissions.amount')}</th>
                    <th className={css.th}>{t('affiliate.commissions.status')}</th>
                    <th className={css.th}>{t('affiliate.commissions.eligibility')}</th>
                  </tr></thead>
                  <tbody>{commissions.map((commission) => {
                    const createdAt = new Date(commission.created_at).getTime()
                    const eligibleAt = new Date(commission.eligible_at).getTime()
                    const duration = Math.max(eligibleAt - createdAt, 1)
                    const progress = Math.max(0, Math.min(100, ((Date.now() - createdAt) / duration) * 100))
                    const matured = Date.now() >= eligibleAt
                    return <tr key={commission.id}>
                      <td className={css.td}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(commission.created_at))}</td>
                      <td className={css.td}>{money(Number(commission.commission_amount))}</td>
                      <td className={css.td}><span className={`${css.badge} ${commission.status === 'ELIGIBLE' ? css.badgeApproved : commission.status === 'CANCELLED' ? css.badgeRejected : css.badgePending}`}>{t(`affiliate.commissions.state.${commission.status.toLowerCase()}` as any)}</span></td>
                      <td className={css.td}>
                        {commission.status === 'HOLDING' ? (
                          <><span>{t('affiliate.commissions.daysRemaining', { days: Math.max(0, Math.ceil((eligibleAt - Date.now()) / 86400000)) })}</span>
                            <div className={css.progressBar} role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t('affiliate.commissions.progress')}>
                              <div className={`${css.progressFill} ${matured ? css.progressFillMature : css.progressFillHolding}`} style={{ width: `${progress}%` }} />
                            </div></>
                        ) : t('affiliate.commissions.periodComplete')}
                      </td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export { isValidAffiliateRef }
