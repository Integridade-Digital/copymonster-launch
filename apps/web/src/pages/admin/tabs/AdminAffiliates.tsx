import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'
import { errorText } from '../../../lib/error-text'
import css from './AdminAffiliates.module.css'

type QueueTab = 'profiles' | 'kyc' | 'commissions' | 'payouts' | 'rules'
type Row = Record<string, any>
const TAB_KEYS: QueueTab[] = ['profiles', 'kyc', 'commissions', 'payouts', 'rules']
const asRecord = (data: unknown): Row[] => Array.isArray(data) ? data as Row[] : []

export function AdminAffiliates() {
  const [tab, setTab] = useState<QueueTab>('profiles')
  const [profiles, setProfiles] = useState<Row[]>([])
  const [kyc, setKyc] = useState<Row[]>([])
  const [commissions, setCommissions] = useState<Row[]>([])
  const [payouts, setPayouts] = useState<Row[]>([])
  const [rules, setRules] = useState<Row[]>([])
  const [reason, setReason] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rule, setRule] = useState({ version: '', percentage: '30', days: '35', minimum: '50' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [profileRes, kycRes, commissionRes, payoutRes, ruleRes] = await Promise.all([
        (supabase as any).schema('affiliate').from('profiles').select('id,user_id,full_name,paypal_email,kyc_status,created_at,active').eq('active', true).order('created_at', { ascending: false }).limit(500),
        (supabase as any).schema('affiliate').from('profiles').select('id,user_id,full_name,cpf_cnpj,paypal_email,address_city,address_state,kyc_status,created_at').eq('active', true).eq('kyc_status', 'PENDING').order('created_at').limit(200),
        (supabase as any).schema('affiliate').from('commissions').select('id,affiliate_id,commission_amount,status,eligible_at,created_at').eq('active', true).eq('status', 'PENDING_VALIDATION').order('created_at').limit(300),
        (supabase as any).schema('finance').from('payout_requests').select('id,affiliate_id,amount,paypal_email_snapshot,status,created_at').eq('active', true).eq('status', 'REQUESTED').order('created_at').limit(300),
        (supabase as any).schema('affiliate').from('commission_rules').select('id,version_name,percentage,retention_days,min_payout_amount,is_current,created_at').eq('active', true).order('created_at', { ascending: false }).limit(20),
      ])
      for (const [label, result] of [
        ['affiliate.profiles', profileRes],
        ['affiliate.kyc', kycRes],
        ['affiliate.commissions', commissionRes],
        ['finance.payout_requests', payoutRes],
        ['affiliate.commission_rules', ruleRes],
      ] as const) {
        if (result.error) {
          console.error(`affiliate admin query failed: ${label}`, result.error)
          throw result.error
        }
      }
      setProfiles(asRecord(profileRes.data)); setKyc(asRecord(kycRes.data)); setCommissions(asRecord(commissionRes.data)); setPayouts(asRecord(payoutRes.data)); setRules(asRecord(ruleRes.data))
    } catch (e) { setError(t('admin.affiliates.error.load', { reason: errorText(e) })) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function runAction(id: string, action: () => Promise<void>, successKey: string) {
    setBusy(id); setError(''); setNotice('')
    try { await action(); setNotice(t(successKey as any)); await load() }
    catch (e) { setError(t('admin.affiliates.error.action', { reason: errorText(e) })) }
    finally { setBusy(null) }
  }
  async function reviewKyc(row: Row, approve: boolean) {
    const why = reason[row.id]?.trim() ?? ''
    if (!approve && !why) { setError(t('admin.affiliates.error.reasonRequired')); return }
    await runAction(row.id, async () => {
      const { error } = await (supabase as any).schema('affiliate').rpc('admin_review_kyc', { p_profile_id: row.id, p_approved: approve, p_reason: why || null })
      if (error) throw error
    }, approve ? 'admin.affiliates.success.kycApproved' : 'admin.affiliates.success.kycRejected')
  }
  async function reviewCommission(row: Row, approve: boolean) {
    const why = reason[row.id]?.trim() ?? ''
    if (!approve && !why) { setError(t('admin.affiliates.error.reasonRequired')); return }
    await runAction(row.id, async () => {
      const { error } = await (supabase as any).schema('affiliate').rpc('admin_review_commission', { p_commission_id: row.id, p_approved: approve, p_reason: why || null })
      if (error) throw error
    }, approve ? 'admin.affiliates.success.commissionApproved' : 'admin.affiliates.success.commissionRejected')
  }
  async function executePayout(row: Row) {
    await runAction(row.id, async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error(t('affiliate.error.loginRequired'))
      const response = await fetch('/api/admin/affiliate/payout/execute', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ payoutId: row.id }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
    }, 'admin.affiliates.success.payoutExecuted')
  }
  async function publishRule(e: React.FormEvent) {
    e.preventDefault()
    await runAction('rule', async () => {
      const { error } = await (supabase as any).schema('affiliate').rpc('admin_publish_commission_rule', {
        p_version_name: rule.version.trim(), p_percentage: Number(rule.percentage), p_retention_days: Number(rule.days), p_min_payout_amount: Number(rule.minimum),
      })
      if (error) throw error
      setRule({ version: '', percentage: rule.percentage, days: rule.days, minimum: rule.minimum })
    }, 'admin.affiliates.success.rulePublished')
  }

  const filteredProfiles = profiles.filter(row => `${row.full_name} ${row.paypal_email} ${row.kyc_status}`.toLowerCase().includes(query.toLowerCase()))
  const affiliateName = (id: string) => profiles.find(profile => profile.id === id)?.full_name ?? id
  const fmt = (value: unknown) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value) || 0)
  const tabLabel = (key: QueueTab) => t(`admin.affiliates.tab.${key}` as any)
  if (loading) return <div className={css.loading} role="status">{t('admin.affiliates.loading')}</div>

  return <section className={css.root}>
    <div className={css.tabs} role="tablist" aria-label={t('admin.affiliates.title')}>
      {TAB_KEYS.map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`${css.tab} ${tab === key ? css.tabActive : ''}`} onClick={() => setTab(key)}>{tabLabel(key)}</button>)}
      <button type="button" className={css.secondary} onClick={() => { void load() }}>{t('admin.affiliates.refresh')}</button>
    </div>
    {error && <div className={css.error} role="alert">{error}</div>}{notice && <div className={css.success} role="status">{notice}</div>}
    {tab === 'profiles' && <>
      <label className={css.label}>{t('admin.affiliates.search')}<input className={css.input} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('admin.affiliates.name')}</th><th>{t('admin.affiliates.email')}</th><th>{t('admin.affiliates.kyc')}</th><th>{t('admin.affiliates.created')}</th></tr></thead><tbody>{filteredProfiles.map(row => <tr key={row.id}><td>{row.full_name}</td><td>{row.paypal_email}</td><td><span className={css.status}>{t(`affiliate.kyc.${String(row.kyc_status).toLowerCase()}` as any)}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>
    </>}
    {tab === 'kyc' && <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('admin.affiliates.name')}</th><th>{t('admin.affiliates.email')}</th><th>{t('admin.affiliates.created')}</th><th>{t('admin.affiliates.reason')}</th><th>{t('admin.affiliates.actions')}</th></tr></thead><tbody>{kyc.map(row => <tr key={row.id}><td>{row.full_name}<br /><small>{row.cpf_cnpj} · {[row.address_city, row.address_state].filter(Boolean).join(', ')}</small></td><td>{row.paypal_email}</td><td>{new Date(row.created_at).toLocaleDateString()}</td><td><input className={`${css.input} ${css.reason}`} value={reason[row.id] ?? ''} onChange={e => setReason({ ...reason, [row.id]: e.target.value })} /></td><td><div className={css.actions}><button className={css.button} disabled={busy === row.id} onClick={() => { void reviewKyc(row, true) }}>{t('admin.affiliates.approve')}</button><button className={css.secondary} disabled={busy === row.id} onClick={() => { void reviewKyc(row, false) }}>{t('admin.affiliates.reject')}</button></div></td></tr>)}</tbody></table>{kyc.length === 0 && <p className={css.empty}>{t('admin.affiliates.empty')}</p>}</div>}
    {tab === 'commissions' && <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('admin.affiliates.name')}</th><th>{t('admin.affiliates.amount')}</th><th>{t('admin.affiliates.created')}</th><th>{t('admin.affiliates.reason')}</th><th>{t('admin.affiliates.actions')}</th></tr></thead><tbody>{commissions.map(row => <tr key={row.id}><td>{affiliateName(row.affiliate_id)}</td><td>{fmt(row.commission_amount)}</td><td>{new Date(row.created_at).toLocaleDateString()}</td><td><input className={`${css.input} ${css.reason}`} value={reason[row.id] ?? ''} onChange={e => setReason({ ...reason, [row.id]: e.target.value })} /></td><td><div className={css.actions}><button className={css.button} disabled={busy === row.id} onClick={() => { void reviewCommission(row, true) }}>{t('admin.affiliates.approve')}</button><button className={css.secondary} disabled={busy === row.id} onClick={() => { void reviewCommission(row, false) }}>{t('admin.affiliates.reject')}</button></div></td></tr>)}</tbody></table>{commissions.length === 0 && <p className={css.empty}>{t('admin.affiliates.empty')}</p>}</div>}
    {tab === 'payouts' && <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('admin.affiliates.name')}</th><th>{t('admin.affiliates.amount')}</th><th>{t('admin.affiliates.email')}</th><th>{t('admin.affiliates.created')}</th><th>{t('admin.affiliates.actions')}</th></tr></thead><tbody>{payouts.map(row => <tr key={row.id}><td>{affiliateName(row.affiliate_id)}</td><td>{fmt(row.amount)}</td><td>{row.paypal_email_snapshot}</td><td>{new Date(row.created_at).toLocaleDateString()}</td><td><button className={css.button} disabled={busy === row.id} onClick={() => { void executePayout(row) }}>{t('admin.affiliates.paypalPay')}</button></td></tr>)}</tbody></table>{payouts.length === 0 && <p className={css.empty}>{t('admin.affiliates.empty')}</p>}</div>}
    {tab === 'rules' && <>
      {rules.filter(row => row.is_current).map(row => <div key={row.id} className={css.status}>{t('admin.affiliates.currentRule')}: {row.version_name} · {row.percentage}% · {row.retention_days} {t('admin.affiliates.retentionDays').toLowerCase()} · {fmt(row.min_payout_amount)}</div>)}
      <form className={css.form} onSubmit={e => { void publishRule(e) }}>
        <label className={css.label}>{t('admin.affiliates.ruleVersion')}<input className={css.input} required maxLength={80} value={rule.version} onChange={e => setRule({ ...rule, version: e.target.value })} /></label>
        <label className={css.label}>{t('admin.affiliates.percent')}<input className={css.input} type="number" min="0" max="100" step="0.01" required value={rule.percentage} onChange={e => setRule({ ...rule, percentage: e.target.value })} /></label>
        <label className={css.label}>{t('admin.affiliates.retentionDays')}<input className={css.input} type="number" min="0" step="1" required value={rule.days} onChange={e => setRule({ ...rule, days: e.target.value })} /></label>
        <label className={css.label}>{t('admin.affiliates.minimumPayout')}<input className={css.input} type="number" min="0" step="0.01" required value={rule.minimum} onChange={e => setRule({ ...rule, minimum: e.target.value })} /></label>
        <button className={css.button} disabled={busy === 'rule'}>{t('admin.affiliates.publishRule')}</button>
      </form>
    </>}
  </section>
}
