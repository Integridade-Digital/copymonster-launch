import React, { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth/auth.provider'
import './ProfilePage.css'

/**
 * Normaliza um número de telefone para o padrão E.164 internacional com entrada tolerante.
 * Aceita entradas com parênteses, traços e espaços como "(11) 98765-4321".
 */
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
      error: 'Número de WhatsApp inválido. Digite DDD + número (ex: (11) 99999-9999 ou +5511999999999)',
    }
  }

  return { e164: normalized, isValid: true }
}

export function ProfilePage() {
  const { user, updateProfile, updatePassword } = useAuth()

  const [fullName, setFullName] = useState(user?.fullName || '')
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp || '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [whatsappError, setWhatsappError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '')
      setWhatsapp(user.whatsapp || '')
    }
  }, [user])

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileMessage(null)
    setWhatsappError(null)

    const { e164, isValid, error } = sanitizeToE164(whatsapp)
    if (!isValid) {
      setWhatsappError(error || 'Número inválido.')
      return
    }

    setProfileSaving(true)
    const { error: saveError } = await updateProfile({
      fullName: fullName.trim(),
      whatsapp: e164,
    })
    setProfileSaving(false)

    if (saveError) {
      setProfileMessage({ type: 'error', text: `Erro ao salvar perfil: ${saveError.message}` })
    } else {
      setWhatsapp(e164)
      setProfileMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' })
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)

    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'A nova senha deve ter no mínimo 6 caracteres.' })
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'As senhas não coincidem.' })
      return
    }

    setPasswordSaving(true)
    const { error: passError } = await updatePassword(newPassword)
    setPasswordSaving(false)

    if (passError) {
      setPasswordMessage({ type: 'error', text: `Erro ao alterar senha: ${passError.message}` })
    } else {
      setPasswordMessage({ type: 'success', text: 'Senha alterada com sucesso!' })
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div className="cm-profile-container">
      <div className="cm-profile-header">
        <h1 className="cm-profile-title">Meu Perfil</h1>
        <p className="cm-profile-subtitle">Gerencie suas informações pessoais e credenciais de acesso</p>
      </div>

      <div className="cm-profile-card">
        <h2 className="cm-profile-card-title">Dados da Conta</h2>

        {profileMessage && (
          <div className={`cm-profile-alert cm-profile-alert-${profileMessage.type}`}>
            {profileMessage.text}
          </div>
        )}

        <form onSubmit={handleProfileSubmit}>
          <div className="cm-profile-field">
            <label className="cm-profile-label">E-mail</label>
            <input
              type="email"
              className="cm-profile-input"
              value={user?.email || ''}
              disabled
              title="O e-mail da conta não pode ser alterado"
            />
            <p className="cm-profile-help">O e-mail é o identificador exclusivo da sua conta.</p>
          </div>

          <div className="cm-profile-field">
            <label className="cm-profile-label" htmlFor="fullName">Nome Completo</label>
            <input
              id="fullName"
              type="text"
              className="cm-profile-input"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Seu nome"
              required
            />
          </div>

          <div className="cm-profile-field">
            <label className="cm-profile-label" htmlFor="whatsapp">WhatsApp</label>
            <input
              id="whatsapp"
              type="text"
              className="cm-profile-input"
              value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value)
                if (whatsappError) setWhatsappError(null)
              }}
              placeholder="(11) 99999-9999"
            />
            {whatsappError ? (
              <p className="cm-profile-error-text">{whatsappError}</p>
            ) : (
              <p className="cm-profile-help">Padrão internacional E.164 com tolerância a espaços e traços.</p>
            )}
          </div>

          <button
            type="submit"
            className="cm-profile-button"
            disabled={profileSaving}
          >
            {profileSaving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </form>
      </div>

      <div className="cm-profile-card">
        <h2 className="cm-profile-card-title">Segurança & Senha</h2>

        {passwordMessage && (
          <div className={`cm-profile-alert cm-profile-alert-${passwordMessage.type}`}>
            {passwordMessage.text}
          </div>
        )}

        <form onSubmit={handlePasswordSubmit}>
          <div className="cm-profile-field">
            <label className="cm-profile-label" htmlFor="newPassword">Nova Senha</label>
            <input
              id="newPassword"
              type="password"
              className="cm-profile-input"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="No mínimo 6 caracteres"
              required
            />
          </div>

          <div className="cm-profile-field">
            <label className="cm-profile-label" htmlFor="confirmPassword">Confirmar Nova Senha</label>
            <input
              id="confirmPassword"
              type="password"
              className="cm-profile-input"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
              required
            />
          </div>

          <button
            type="submit"
            className="cm-profile-button"
            disabled={passwordSaving}
          >
            {passwordSaving ? 'Atualizando...' : 'Atualizar Senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
