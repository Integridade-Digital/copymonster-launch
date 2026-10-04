import React, { useState, useEffect } from 'react'
import { supabaseClient } from '../lib/auth/supabase.client'
import { t } from '../locales'
import './ProfilePage.css'

export function sanitizeToE164(input: string): { e164: string; isValid: boolean; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return { e164: '', isValid: true }
  }

  const cleaned = trimmed.replace(/[^\d+]/g, '')

  let normalized = cleaned
  if (!normalized.startsWith('+')) {
    const digitsOnly = normalized.replace(/\D/g, '')
    if (digitsOnly.length === 10 || digitsOnly.length === 11) {
      normalized = `+55${digitsOnly}`
    } else {
      normalized = `+${digitsOnly}`
    }
  }

  const e164Regex = /^\+[1-9]\d{9,14}$/
  if (!e164Regex.test(normalized)) {
    return {
      e164: normalized,
      isValid: false,
      error: t('profile.whatsappInvalid'),
    }
  }

  return { e164: normalized, isValid: true }
}

export interface ProfileUser {
  id?: string | undefined
  email?: string | undefined
  fullName?: string | undefined
  whatsapp?: string | undefined
}

export type ProfileSectionKey = 'account' | 'security'

export interface ProfilePageProps {
  currentUser?: ProfileUser | null | undefined
  onProfileUpdated?: (() => void) | undefined
  activeSection?: ProfileSectionKey | undefined
}

export function ProfilePage({ currentUser, onProfileUpdated, activeSection = 'account' }: ProfilePageProps = {}) {
  const [user, setUser] = useState<ProfileUser | null>(currentUser || null)

  const [fullName, setFullName] = useState(currentUser?.fullName || '')
  const [whatsapp, setWhatsapp] = useState(currentUser?.whatsapp || '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [whatsappError, setWhatsappError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (currentUser) {
      setUser(currentUser)
      setFullName(currentUser.fullName || '')
      setWhatsapp(currentUser.whatsapp || '')
    } else {
      void supabaseClient.auth.getUser().then(({ data: { user: authUser } }) => {
        if (!authUser) return
        const meta = authUser.user_metadata || {}
        const fetched: ProfileUser = {
          id: authUser.id,
          email: authUser.email ?? undefined,
          fullName: (meta.full_name || meta.name) ? String(meta.full_name || meta.name) : undefined,
          whatsapp: meta.whatsapp ? String(meta.whatsapp) : undefined,
        }
        setUser(fetched)
        setFullName(fetched.fullName || '')
        setWhatsapp(fetched.whatsapp || '')
      })
    }
  }, [currentUser])

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileMessage(null)
    setWhatsappError(null)

    const { e164, isValid, error } = sanitizeToE164(whatsapp)
    if (!isValid) {
      setWhatsappError(error || t('profile.whatsappInvalid'))
      return
    }

    try {
      setProfileSaving(true)
      const { error: updateError } = await supabaseClient.auth.updateUser({
        data: {
          full_name: fullName.trim(),
          name: fullName.trim(),
          whatsapp: e164,
        },
      })

      if (updateError) throw updateError

      setProfileMessage({ type: 'success', text: t('profile.accountSaved') })
      onProfileUpdated?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setProfileMessage({ type: 'error', text: msg })
    } finally {
      setProfileSaving(false)
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)

    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: t('profile.passwordTooShort') })
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: t('profile.passwordMismatch') })
      return
    }

    try {
      setPasswordSaving(true)
      const { error: updateError } = await supabaseClient.auth.updateUser({
        password: newPassword,
      })

      if (updateError) throw updateError

      setPasswordMessage({ type: 'success', text: t('profile.passwordSaved') })
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setPasswordMessage({ type: 'error', text: msg })
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '24px' }}>
      {/* Account Data Section */}
      {activeSection === 'account' && (
        <section>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: '0 0 4px 0' }}>
              Dados da Conta
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: 0 }}>
              Gerencie suas informações pessoais e detalhes de contato.
            </p>
          </div>

          <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column' }}>
            <div>
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: '13px', color: 'var(--cm-muted-foreground)', marginBottom: '6px', fontWeight: 500 }}
              >
                {t('profile.email')}
              </label>
              <input
                id="email"
                type="email"
                value={user?.email || ''}
                disabled
                style={{
                  display: 'block',
                  width: '100%',
                  height: '32px',
                  fontSize: '13px',
                  background: 'var(--cm-card)',
                  border: '1px solid var(--cm-border)',
                  borderRadius: '6px',
                  padding: '0 12px',
                  marginBottom: '16px',
                  color: 'var(--cm-muted-foreground)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="fullName"
                style={{ display: 'block', fontSize: '13px', color: 'var(--cm-muted-foreground)', marginBottom: '6px', fontWeight: 500 }}
              >
                {t('profile.fullName')}
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder={t('profile.fullNamePlaceholder')}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '32px',
                  fontSize: '13px',
                  background: 'var(--cm-background)',
                  border: '1px solid var(--cm-border)',
                  borderRadius: '6px',
                  padding: '0 12px',
                  marginBottom: '16px',
                  color: 'var(--cm-foreground)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="whatsapp"
                style={{ display: 'block', fontSize: '13px', color: 'var(--cm-muted-foreground)', marginBottom: '6px', fontWeight: 500 }}
              >
                {t('profile.whatsapp')}
              </label>
              <input
                id="whatsapp"
                type="text"
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(e.target.value)
                  if (whatsappError) setWhatsappError(null)
                }}
                placeholder={t('profile.whatsappPlaceholder')}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '32px',
                  fontSize: '13px',
                  background: 'var(--cm-background)',
                  border: `1px solid ${whatsappError ? 'var(--cm-destructive)' : 'var(--cm-border)'}`,
                  borderRadius: '6px',
                  padding: '0 12px',
                  marginBottom: whatsappError ? '6px' : '16px',
                  color: 'var(--cm-foreground)',
                  boxSizing: 'border-box',
                }}
              />
              {whatsappError && (
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--cm-destructive)', marginBottom: '16px' }}>
                  {whatsappError}
                </span>
              )}
            </div>

            {profileMessage && (
              <div
                style={{
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: profileMessage.type === 'success' ? 'color-mix(in srgb, var(--cm-success) 15%, transparent)' : 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)',
                  border: `1px solid ${profileMessage.type === 'success' ? 'var(--cm-success)' : 'var(--cm-destructive)'}`,
                  color: profileMessage.type === 'success' ? 'var(--cm-success)' : 'var(--cm-destructive)',
                  marginBottom: '16px',
                }}
              >
                {profileMessage.text}
              </div>
            )}

            <div style={{ paddingTop: '8px' }}>
              <button
                type="submit"
                disabled={profileSaving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '32px',
                  padding: '0 16px',
                  backgroundColor: 'var(--cm-primary)',
                  color: 'var(--cm-background)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  width: 'auto',
                  border: 'none',
                  cursor: profileSaving ? 'not-allowed' : 'pointer',
                  opacity: profileSaving ? 0.6 : 1,
                }}
              >
                {profileSaving ? t('common.saving') : t('profile.saveAccount')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Security & Password Section */}
      {activeSection === 'security' && (
        <section>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--cm-foreground)', margin: '0 0 4px 0' }}>
              Segurança & Senha
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: 0 }}>
              Atualize sua senha de acesso para proteger sua conta.
            </p>
          </div>

          <form onSubmit={handleUpdatePassword} style={{ display: 'flex', flexDirection: 'column' }}>
            <div>
              <label
                htmlFor="newPassword"
                style={{ display: 'block', fontSize: '13px', color: 'var(--cm-muted-foreground)', marginBottom: '6px', fontWeight: 500 }}
              >
                {t('profile.newPassword')}
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('profile.newPasswordPlaceholder')}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '32px',
                  fontSize: '13px',
                  background: 'var(--cm-background)',
                  border: '1px solid var(--cm-border)',
                  borderRadius: '6px',
                  padding: '0 12px',
                  marginBottom: '16px',
                  color: 'var(--cm-foreground)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                style={{ display: 'block', fontSize: '13px', color: 'var(--cm-muted-foreground)', marginBottom: '6px', fontWeight: 500 }}
              >
                {t('profile.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t('profile.confirmPasswordPlaceholder')}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '32px',
                  fontSize: '13px',
                  background: 'var(--cm-background)',
                  border: '1px solid var(--cm-border)',
                  borderRadius: '6px',
                  padding: '0 12px',
                  marginBottom: '16px',
                  color: 'var(--cm-foreground)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {passwordMessage && (
              <div
                style={{
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: passwordMessage.type === 'success' ? 'color-mix(in srgb, var(--cm-success) 15%, transparent)' : 'color-mix(in srgb, var(--cm-destructive) 15%, transparent)',
                  border: `1px solid ${passwordMessage.type === 'success' ? 'var(--cm-success)' : 'var(--cm-destructive)'}`,
                  color: passwordMessage.type === 'success' ? 'var(--cm-success)' : 'var(--cm-destructive)',
                  marginBottom: '16px',
                }}
              >
                {passwordMessage.text}
              </div>
            )}

            <div style={{ paddingTop: '8px' }}>
              <button
                type="submit"
                disabled={passwordSaving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '32px',
                  padding: '0 16px',
                  backgroundColor: 'var(--cm-primary)',
                  color: 'var(--cm-background)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  width: 'auto',
                  border: 'none',
                  cursor: passwordSaving ? 'not-allowed' : 'pointer',
                  opacity: passwordSaving ? 0.6 : 1,
                }}
              >
                {passwordSaving ? t('common.saving') : t('profile.savePassword')}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
