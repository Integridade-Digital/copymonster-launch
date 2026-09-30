import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { wizardBlocker, type PresetRow, type WizardDraft } from './section-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

export interface PresetWizardProps {
  draft: WizardDraft
  rows: readonly PresetRow[]
  t: (key: AgentPresetSettingsKey) => string
  onStepChange: (step: 1 | 2) => void
  onUpdate: (patch: Partial<WizardDraft>) => void
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function PresetWizard({
  draft,
  rows,
  t,
  onStepChange,
  onUpdate,
  onConfirm,
  onCancel,
}: PresetWizardProps): ReactNode {
  const blocker = wizardBlocker(draft, rows)
  const errorMessage = draft.error ?? (draft.step === 1 && blocker !== undefined && draft.id.length > 0 ? t(blocker) : null)
  const baseRow = rows.find(row => row.id === draft.basePreset)
  const baseTitle = baseRow ? presetDisplayText(baseRow, t).name : draft.basePreset

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={`${t('wizardTitle')} · ${draft.step === 1 ? t('wizardStepIdentity') : t('wizardStepReview')}`}
      closeLabel={t('close')}
      className={css.dialog as string}
      footer={(
        <>
          {draft.step === 1 ? (
            <>
              <Button
                variant="outline"
                disabled={draft.saving}
                onClick={onCancel}
              >
                {t('cancel')}
              </Button>
              <Button
                disabled={draft.saving || blocker !== undefined}
                onClick={() => { onStepChange(2) }}
              >
                {t('wizardNext')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={draft.saving}
                onClick={() => { onStepChange(1) }}
              >
                {t('wizardPrevious')}
              </Button>
              <Button
                disabled={draft.saving || blocker !== undefined}
                onClick={() => { void onConfirm() }}
              >
                {draft.saving ? t('creating') : t('wizardConfirm')}
              </Button>
            </>
          )}
        </>
      )}
    >
      <div className={css.dialogFields}>
        {draft.step === 1 ? (
          <>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('wizardBasePreset')}</span>
              <select
                className={css.input}
                value={draft.basePreset}
                onChange={(e) => { onUpdate({ basePreset: e.target.value }) }}
              >
                {rows
                  .filter(row => row.broken === undefined)
                  .map(row => (
                    <option key={row.id} value={row.id}>
                      {presetDisplayText(row, t).name} ({row.id})
                    </option>
                  ))}
              </select>
            </label>

            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                autoFocus
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(e) => { onUpdate({ id: e.target.value, error: null }) }}
              />
            </label>

            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(e) => { onUpdate({ name: e.target.value }) }}
              />
            </label>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p className={css.intro} style={{ margin: 0 }}>
              {t('wizardReviewIntro')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: '13px' }}>
              <span style={{ fontWeight: 600 }}>{t('wizardBasePreset')}:</span>
              <span>{baseTitle} ({draft.basePreset})</span>

              <span style={{ fontWeight: 600 }}>{t('presetId')}:</span>
              <span><code>{draft.id}</code></span>

              <span style={{ fontWeight: 600 }}>{t('displayName')}:</span>
              <span>{draft.name.trim() || draft.id}</span>
            </div>
          </div>
        )}

        {errorMessage ? (
          <p className={css.error} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
