import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/** Recuperação de senha por e-mail. */
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
      setSuccessMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.')
      setEmail('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar e-mail de recuperação')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Recuperar senha</h1>
          <p className="cm-auth-subtitle">
            Digite seu e-mail e enviaremos instruções para redefinir sua senha.
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
            <label htmlFor="email" className="cm-auth-label">E-mail</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              className="cm-auth-input" placeholder="seu@email.com"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Enviando…' : 'Enviar e-mail de recuperação'}
          </button>

          <p className="cm-auth-footer">
            <Link to="/login" className="cm-auth-link">Voltar para o login</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
