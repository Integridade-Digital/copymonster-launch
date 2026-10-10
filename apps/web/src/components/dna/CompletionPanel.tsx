import { t } from '../../locales'
import './dna.css'

export interface CompletionPanelProps {
  onView(): void
  onStart(): void
}

export function CompletionPanel({ onView, onStart }: CompletionPanelProps) {
  return (
    <div className="cm-dna-overlay" role="dialog" aria-modal="true">
      <div className="cm-dna-card">
        <h2 className="cm-dna-card-title">{t('onboarding.dna.completionTitle')}</h2>
        <p className="cm-dna-card-text">{t('onboarding.dna.completionSubtitle')}</p>
        <div className="cm-dna-card-actions">
          <button type="button" className="cm-dna-button cm-dna-button--primary" onClick={onView}>
            {t('onboarding.dna.viewMapping')}
          </button>
          <button type="button" className="cm-dna-button" onClick={onStart}>
            {t('onboarding.dna.startProject')}
          </button>
        </div>
      </div>
    </div>
  )
}
