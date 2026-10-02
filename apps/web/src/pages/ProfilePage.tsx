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
    <div className="profile-container" style={{ padding: '0 4px' }}>
      {/* Account Data Section */}
      {activeSection === 'account' && (
        <section className="profile-section" style={{ border: 'none', background: 'transparent', padding: 0 }}>
          <form onSubmit={handleUpdateProfile} className="profile-form">
            <div className="form-group">
              <label htmlFor="email" style={{ color: '#8b949e', fontSize: '13px' }}>{t('profile.email')}</label>
              <input
                id="email"
                type="email"
                value={user?.email || ''}
                disabled
                className="input-disabled"
                style={{ background: '#161b22', border: '1px solid #30363d', color: '#8b949e', fontSize: '13px' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="fullName" style={{ color: '#8b949e', fontSize: '13px' }}>{t('profile.fullName')}</label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder={t('profile.fullNamePlaceholder')}
                className="input-text"
                style={{ background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', fontSize: '13px' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="whatsapp" style={{ color: '#8b949e', fontSize: '13px' }}>{t('profile.whatsapp')}</label>
              <input
                id="whatsapp"
                type="text"
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(e.target.value)
                  if (whatsappError) setWhatsappError(null)
                }}
                placeholder={t('profile.whatsappPlaceholder')}
                className={`input-text ${whatsappError ? 'input-error' : ''}`}
                style={{ background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', fontSize: '13px' }}
              />
              {whatsappError && <span className="field-error" style={{ fontSize: '12px', color: '#f85149' }}>{whatsappError}</span>}
            </div>

            {profileMessage && (
              <div
                className={`feedback-message ${profileMessage.type}`}
                style={{
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: profileMessage.type === 'success' ? 'rgba(46, 160, 67, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                  border: `1px solid ${profileMessage.type === 'success' ? '#2ea043' : '#f85149'}`,
                  color: profileMessage.type === 'success' ? '#3fb950' : '#f85149',
                }}
              >
                {profileMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="btn-primary"
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#E7BF73',
                color: '#0d1117',
                fontWeight: 600,
                fontSize: '13px',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {profileSaving ? t('common.saving') : t('profile.saveAccount')}
            </button>
          </form>
        </section>
      )}

      {/* Security & Password Section */}
      {activeSection === 'security' && (
        <section className="profile-section" style={{ border: 'none', background: 'transparent', padding: 0 }}>
          <form onSubmit={handleUpdatePassword} className="profile-form">
            <div className="form-group">
              <label htmlFor="newPassword" style={{ color: '#8b949e', fontSize: '13px' }}>{t('profile.newPassword')}</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('profile.newPasswordPlaceholder')}
                className="input-text"
                style={{ background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', fontSize: '13px' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword" style={{ color: '#8b949e', fontSize: '13px' }}>{t('profile.confirmPassword')}</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t('profile.confirmPasswordPlaceholder')}
                className="input-text"
                style={{ background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', fontSize: '13px' }}
              />
            </div>

            {passwordMessage && (
              <div
                className={`feedback-message ${passwordMessage.type}`}
                style={{
                  fontSize: '13px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: passwordMessage.type === 'success' ? 'rgba(46, 160, 67, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                  border: `1px solid ${passwordMessage.type === 'success' ? '#2ea043' : '#f85149'}`,
                  color: passwordMessage.type === 'success' ? '#3fb950' : '#f85149',
                }}
              >
                {passwordMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={passwordSaving}
              className="btn-primary"
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#E7BF73',
                color: '#0d1117',
                fontWeight: 600,
                fontSize: '13px',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {passwordSaving ? t('common.saving') : t('profile.savePassword')}
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
