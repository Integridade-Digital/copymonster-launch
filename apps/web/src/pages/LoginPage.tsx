import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, formatAuthError } from '../lib/auth'

/** Login de usuário existente. */
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
      setError(formatAuthError(err, 'E-mail ou senha inválidos. Tente novamente.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Acesse sua conta</h1>
          <p className="cm-auth-subtitle">
            Não tem uma conta?{' '}
            <Link to="/register" className="cm-auth-link">Crie agora</Link>
          </p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="email" className="cm-auth-label">E-mail</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={formData.email} onChange={handleChange}
              className="cm-auth-input" placeholder="seu@email.com"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">Senha</label>
            <input
              id="password" name="password" type="password" autoComplete="current-password" required
              value={formData.password} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <div className="cm-auth-row">
            <Link to="/forgot-password" className="cm-auth-link">Esqueceu a senha?</Link>
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
