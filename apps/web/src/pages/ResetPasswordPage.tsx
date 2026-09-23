import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseClient } from '../lib/auth'

/** Redefinição de senha, acessada pelo link do e-mail de recuperação. */
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
        setError('Link de recuperação inválido ou expirado')
        setIsVerifying(false)
        return
      }

      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession()

      if (sessionError || !session) {
        setError('Sessão inválida. Solicite um novo link de recuperação.')
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
      setError('As senhas não coincidem')
      return
    }

    if (password.length < 8 || !/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) {
      setError('A senha deve ter ao menos 8 caracteres, 1 número e 1 letra')
      return
    }

    setIsLoading(true)

    try {
      const { error: updateError } = await supabaseClient.auth.updateUser({ password })
      if (updateError) throw updateError

      setSuccessMessage('Senha redefinida! Redirecionando para o login…')
      setTimeout(() => { navigate('/login') }, 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha')
    } finally {
      setIsLoading(false)
    }
  }

  if (isVerifying) {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>Verificando link de recuperação…</span>
      </div>
    )
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Redefinir senha</h1>
          <p className="cm-auth-subtitle">Digite sua nova senha abaixo.</p>
        </div>

        <form className="cm-auth-form" onSubmit={handleSubmit}>
          {error !== null && (
            <div className="cm-auth-alert cm-auth-alert--error" role="alert">{error}</div>
          )}
          {successMessage !== null && (
            <div className="cm-auth-alert cm-auth-alert--success" role="alert">{successMessage}</div>
          )}

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">Nova senha</label>
            <input
              id="password" name="password" type="password" autoComplete="new-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              className="cm-auth-input" placeholder="••••••••"
            />
            <span className="cm-auth-hint">Mínimo 8 caracteres, com 1 número e 1 letra.</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="confirmPassword" className="cm-auth-label">Confirmar nova senha</label>
            <input
              id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Redefinindo…' : 'Redefinir senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
