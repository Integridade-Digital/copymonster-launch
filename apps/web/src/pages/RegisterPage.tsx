import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, formatAuthError, supabaseClient } from '../lib/auth'

/**
 * New user registration.
 * Fields: Full name, Email, WhatsApp (international format), Password.
 */
export function RegisterPage() {
  const { signUp } = useAuth()

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    password: '',
    confirmPassword: '',
  })

  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [resendFeedback, setResendFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.fullName || !formData.email || !formData.whatsapp || !formData.password) {
      setError('Please fill in all required fields')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8 || !/[0-9]/.test(formData.password) || !/[A-Za-z]/.test(formData.password)) {
      setError('Password must be at least 8 characters, with 1 number and 1 letter')
      return
    }

    const whatsappRegex = /^\+[1-9]\d{9,14}$/
    if (!whatsappRegex.test(formData.whatsapp)) {
      setError('WhatsApp must be in international format (e.g. +1234567890)')
      return
    }

    setIsLoading(true)

    try {
      const { error: signUpError } = await signUp(
        formData.email,
        formData.password,
        formData.fullName,
        formData.whatsapp,
      )

      if (signUpError) throw signUpError

      setAwaitingEmail(formData.email)
    } catch (err: unknown) {
      setError(formatAuthError(err, 'Error creating account. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => { setCooldown(cooldown - 1) }, 1000)
    return () => { clearTimeout(id) }
  }, [cooldown])

  const handleResend = async () => {
    if (awaitingEmail === null || isResending || cooldown > 0) return
    setIsResending(true)
    setResendFeedback(null)
    try {
      const { error } = await supabaseClient.auth.resend({ type: 'signup', email: awaitingEmail })
      if (error) throw error
      setResendFeedback({ type: 'success', message: 'Confirmation email sent. Check your inbox.' })
      setCooldown(30)
    } catch (err: unknown) {
      setResendFeedback({ type: 'error', message: formatAuthError(err, 'Could not resend the email. Try again shortly.') })
    } finally {
      setIsResending(false)
    }
  }

  if (awaitingEmail !== null) {
    return (
      <div className="cm-auth-page">
        <div className="cm-auth-card">
          <div className="cm-auth-brand">
            <img src="/favicon.svg" alt="CopyMonster" className="cm-auth-brand-logo" />
            <span className="cm-auth-brand-title">CopyMonster</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden style={{ margin: '0 auto' }}>
              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 6l9 7 9-7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <h1 className="cm-auth-title">Confirm your email</h1>
            <p className="cm-auth-subtitle">
              We sent a confirmation link to <strong>{awaitingEmail}</strong>.
              Open the email and click the link to activate your account.
            </p>
            <p className="cm-auth-hint">Didn&apos;t receive it? Check your spam folder, then resend below.</p>
            <button
              type="button"
              className="cm-auth-button"
              onClick={handleResend}
              disabled={isResending || cooldown > 0}
            >
              {isResending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend confirmation email'}
            </button>
            {resendFeedback !== null && (
              <div className={`cm-auth-alert cm-auth-alert--${resendFeedback.type}`} role="alert">
                {resendFeedback.message}
              </div>
            )}
            <p className="cm-auth-footer">
              Already confirmed? <Link to="/login" className="cm-auth-link">Go to login</Link>
            </p>
          </div>
        </div>
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
          <h1 className="cm-auth-title">Create your account</h1>
          <p className="cm-auth-subtitle">
            Already have an account?{' '}
            <Link to="/login" className="cm-auth-link">Sign in</Link>
          </p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="fullName" className="cm-auth-label">Full name</label>
            <input
              id="fullName" name="fullName" type="text" required
              value={formData.fullName} onChange={handleChange}
              className="cm-auth-input" placeholder="Your full name"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="email" className="cm-auth-label">Email</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={formData.email} onChange={handleChange}
              className="cm-auth-input" placeholder="you@example.com"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="whatsapp" className="cm-auth-label">WhatsApp (international format)</label>
            <input
              id="whatsapp" name="whatsapp" type="tel" required
              value={formData.whatsapp} onChange={handleChange}
              className="cm-auth-input" placeholder="+1234567890"
            />
            <span className="cm-auth-hint">Example: +1234567890 (country code + area code + number)</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">Password</label>
            <input
              id="password" name="password" type="password" autoComplete="new-password" required
              value={formData.password} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
            <span className="cm-auth-hint">Minimum 8 characters, with 1 number and 1 letter.</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="confirmPassword" className="cm-auth-label">Confirm password</label>
            <input
              id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required
              value={formData.confirmPassword} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Creating account…' : 'Create account'}
          </button>

          <p className="cm-auth-footer">
            By creating an account, you agree to the Terms of Service.
          </p>
        </form>
      </div>
    </div>
  )
}
