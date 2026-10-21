import { useState } from 'react'
import { t } from '../../locales'
import { finalizePositioningMapping, type PositioningMapping } from './useDnaOnboardingState'
import css from './CompletionPanel.module.css'

export interface CompletionPanelProps {
  readonly mapping: PositioningMapping
  readonly detectedProductName?: string | null | undefined
  readonly onFinalized?: ((updated: PositioningMapping) => void) | undefined
  readonly onView: () => void
  readonly onStart: () => void
}

export function CompletionPanel({
  mapping,
  detectedProductName,
  onFinalized,
  onView,
  onStart,
}: CompletionPanelProps) {
  const isAlreadyCompleted = mapping.status === 'completed'
  const [phase, setPhase] = useState<'name' | 'actions'>(isAlreadyCompleted ? 'actions' : 'name')
  const [name, setName] = useState(() => {
    if (detectedProductName && detectedProductName.trim().length > 0) {
      return detectedProductName.trim()
    }
    if (mapping.product_name && mapping.product_name.trim().length > 0) {
      return mapping.product_name.trim()
    }
    if (mapping.name && mapping.name !== 'My first DNA') {
      return mapping.name
    }
    return ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSaveName = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Por favor, informe um nome para o seu DNA.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await finalizePositioningMapping(
        mapping.id,
        trimmed,
        detectedProductName || mapping.product_name || null,
      )
      onFinalized?.(updated)
      setPhase('actions')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o DNA.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.overlay} role="dialog" aria-modal="true">
      <div className={css.card}>
        <h2 className={css.title}>{t('onboarding.dna.completionTitle')}</h2>
        <p className={css.text}>{t('onboarding.dna.completionSubtitle')}</p>

        {phase === 'name' ? (
          <form onSubmit={handleSaveName} className={css.form}>
            <label className={css.label} htmlFor="cm-dna-name-input">
              Nome do seu DNA
            </label>
            <input
              id="cm-dna-name-input"
              type="text"
              className={css.input}
              placeholder="Ex: Meu Produto Principal"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={saving}
              autoFocus
            />
            {error && <div className={css.error}>{error}</div>}
            <div className={css.actions}>
              <button
                type="submit"
                className={`${css.button} ${css.saveButton}`}
                disabled={saving || !name.trim()}
              >
                {saving ? t('onboarding.dna.saving') : 'Salvar DNA'}
              </button>
            </div>
          </form>
        ) : (
          <div className={css.actions}>
            <button type="button" className={`${css.button} ${css.saveButton}`} onClick={onView}>
              {t('onboarding.dna.viewMapping')}
            </button>
            <button type="button" className={css.button} onClick={onStart}>
              {t('onboarding.dna.startProject')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
