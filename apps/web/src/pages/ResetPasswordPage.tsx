import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseClient } from '../lib/auth'

/** Password reset, accessed via the recovery email link. */
export function ResetPasswordPage() {
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(true)

  useEffect(() => {
    async function verifyRecoveryHash() {
      const hash = window.location.hash

      if (!hash || !hash.includes('access_token')) {
        setError('Invalid or expired reset link')
        setIsVerifying(false)
        return
      }

      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession()

      if (sessionError || !session) {
        setError('Invalid session. Please request a new reset link.')
        setIsVerifying(false)
        return
      }

      setIsVerifying(false)
    }

    void verifyRecoveryHash()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8 || !/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) {
      setError('Password must be at least 8 characters, with 1 number and 1 letter')
      return
    }

    setIsLoading(true)

    try {
      const { error: updateError } = await supabaseClient.auth.updateUser({ password })
      if (updateError) throw updateError

      setSuccessMessage('Password reset! Redirecting to sign in…')
      setTimeout(() => { navigate('/login') }, 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error resetting password')
    } finally {
      setIsLoading(false)
    }
  }

  if (isVerifying) {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>Verifying reset link…</span>
      </div>
    )
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-brand">
          <img src="/favicon.svg" alt="CopyMonster" className="cm-auth-brand-logo" />
          <span className="cm-auth-brand-title">CopyMonster</span>
        </div>

        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Reset password</h1>
          <p className="cm-auth-subtitle">Enter your new password below.</p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}
          {successMessage !== null && (
            <div className="cm-auth-alert cm-auth-alert--success" role="alert">{successMessage}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">New password</label>
            <input
              id="password" name="password" type="password" autoComplete="new-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              className="cm-auth-input" placeholder="••••••••"
            />
            <span className="cm-auth-hint">Minimum 8 characters, with 1 number and 1 letter.</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="confirmPassword" className="cm-auth-label">Confirm new password</label>
            <input
              id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  )
}
