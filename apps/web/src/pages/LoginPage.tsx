import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, formatAuthError } from '../lib/auth'

/** Existing user login. */
export function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const { error: signInError } = await signIn(formData.email, formData.password)
      if (signInError) throw signInError
      navigate('/')
    } catch (err: unknown) {
      setError(formatAuthError(err, 'Invalid email or password. Please try again.'))
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
          <h1 className="cm-auth-title">Sign in to your account</h1>
          <p className="cm-auth-subtitle">
            Don't have an account?{' '}
            <Link to="/register" className="cm-auth-link">Sign up now</Link>
          </p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="email" className="cm-auth-label">Email</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={formData.email} onChange={handleChange}
              className="cm-auth-input" placeholder="you@example.com"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">Password</label>
            <input
              id="password" name="password" type="password" autoComplete="current-password" required
              value={formData.password} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <div className="cm-auth-row">
            <Link to="/forgot-password" className="cm-auth-link">Forgot password?</Link>
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
