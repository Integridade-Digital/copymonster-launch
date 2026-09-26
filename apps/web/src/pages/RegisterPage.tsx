import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, formatAuthError } from '../lib/auth'

/**
 * Registro de novo usuário.
 * Campos: Nome, E-mail, WhatsApp (formato internacional), Senha.
 */
export function RegisterPage() {
  const navigate = useNavigate()
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!formData.fullName || !formData.email || !formData.whatsapp || !formData.password) {
      setError('Preencha todos os campos obrigatórios')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem')
      return
    }

    if (formData.password.length < 8 || !/[0-9]/.test(formData.password) || !/[A-Za-z]/.test(formData.password)) {
      setError('A senha deve ter ao menos 8 caracteres, 1 número e 1 letra')
      return
    }

    const whatsappRegex = /^\+[1-9]\d{9,14}$/
    if (!whatsappRegex.test(formData.whatsapp)) {
      setError('WhatsApp deve estar no formato internacional (ex: +5511999999999)')
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

      setSuccessMessage('Conta criada! Verifique seu e-mail para confirmar o registro.')
      setTimeout(() => { navigate('/login') }, 3000)
    } catch (err: unknown) {
      setError(formatAuthError(err, 'Erro ao criar conta. Tente novamente.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card">
        <div className="cm-auth-header">
          <h1 className="cm-auth-title">Criar sua conta</h1>
          <p className="cm-auth-subtitle">
            Já tem uma conta?{' '}
            <Link to="/login" className="cm-auth-link">Faça login</Link>
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
            <label htmlFor="fullName" className="cm-auth-label">Nome completo</label>
            <input
              id="fullName" name="fullName" type="text" required
              value={formData.fullName} onChange={handleChange}
              className="cm-auth-input" placeholder="Seu nome completo"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="email" className="cm-auth-label">E-mail</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={formData.email} onChange={handleChange}
              className="cm-auth-input" placeholder="seu@email.com"
            />
          </div>

          <div className="cm-auth-field">
            <label htmlFor="whatsapp" className="cm-auth-label">WhatsApp (formato internacional)</label>
            <input
              id="whatsapp" name="whatsapp" type="tel" required
              value={formData.whatsapp} onChange={handleChange}
              className="cm-auth-input" placeholder="+5511999999999"
            />
            <span className="cm-auth-hint">Exemplo: +5511999999999 (país + DDD + número)</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="password" className="cm-auth-label">Senha</label>
            <input
              id="password" name="password" type="password" autoComplete="new-password" required
              value={formData.password} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
            <span className="cm-auth-hint">Mínimo 8 caracteres, com 1 número e 1 letra.</span>
          </div>

          <div className="cm-auth-field">
            <label htmlFor="confirmPassword" className="cm-auth-label">Confirmar senha</label>
            <input
              id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required
              value={formData.confirmPassword} onChange={handleChange}
              className="cm-auth-input" placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={isLoading} className="cm-auth-button">
            {isLoading ? 'Criando…' : 'Criar conta'}
          </button>

          <p className="cm-auth-footer">
            Ao criar a conta você concorda com os Termos de Uso.
          </p>
        </form>
      </div>
    </div>
  )
}
