import { useMemo, useState } from 'react'
import { t } from '../../locales'
import { dnaBlock, type PositioningMapping } from './useDnaOnboardingState'
import './dna.css'

export interface ExportDocumentModalProps {
  mapping: PositioningMapping
  onClose(): void
}

function buildMappingText(mapping: PositioningMapping): string {
  const lines: string[] = [
    t('onboarding.dna.exportTitle'),
    '',
    `${t('onboarding.dna.exportProductName')}: ${mapping.product_name === '' ? mapping.name : mapping.product_name}`,
    '',
  ]
  for (let block = 1; block <= 12; block += 1) {
    const meta = dnaBlock(block)
    if (meta === undefined) continue
    lines.push(`${block}. ${t(meta.nameKey)}`)
    lines.push(mapping[meta.column] ?? '')
    lines.push('')
  }
  return lines.join('\n')
}

export function ExportDocumentModal({ mapping, onClose }: ExportDocumentModalProps) {
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => buildMappingText(mapping), [mapping])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard access denied: the download button still works.
    }
  }

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'dna-mapping.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="cm-dna-overlay" role="dialog" aria-modal="true">
      <div className="cm-dna-card cm-dna-card--wide">
        <h2 className="cm-dna-card-title">{t('onboarding.dna.exportTitle')}</h2>
        <pre className="cm-dna-export">{text}</pre>
        <div className="cm-dna-card-actions">
          <button type="button" className="cm-dna-button" onClick={() => { void copy() }}>
            {copied ? t('common.copied') : t('onboarding.dna.exportCopy')}
          </button>
          <button type="button" className="cm-dna-button" onClick={download}>
            {t('onboarding.dna.exportDownload')}
          </button>
          <button type="button" className="cm-dna-button cm-dna-button--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
