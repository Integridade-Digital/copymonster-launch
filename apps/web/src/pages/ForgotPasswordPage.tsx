import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/** Password recovery via email. */
export function ForgotPasswordPage() {
  const { resetPassword } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setIsLoading(true)

    try {
      const { error: resetError } = await resetPassword(email)
      if (resetError) throw resetError
      setSuccessMessage('Password reset link sent! Check your inbox.')
      setEmail('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error sending password reset email')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-brand">
          <img src="/favicon.svg" alt="CopyMonster" className="cm-auth-brand-logo" />
          <span className="cm-auth-brand-title">CopyMonster</span>
        </div>

        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Forgot password</h1>
          <p className="cm-auth-subtitle">
            Enter your email and we'll send you instructions to reset your password.
          </p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}
          {successMessage !== null && (
            <div className="cm-auth-alert cm-auth-alert--success" role="alert">{successMessage}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="email" className="cm-auth-label">Email</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              className="cm-auth-input" placeholder="you@example.com"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Sending…' : 'Send reset link'}
          </button>

          <p className="cm-auth-footer">
            <Link to="/login" className="cm-auth-link">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
