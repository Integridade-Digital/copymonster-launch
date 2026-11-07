import { useEffect, useState } from 'react'
import { t } from '../../locales'

/**
 * Settings > Models panel.
 *
 * Tenants (non-admin) see only the virtual "Model CopyMonster" card: the
 * real provider names, keys, and routes are masked and never exposed.
 * Platform admins see an informational card pointing them to the Admin >
 * Settings (System) > Central LLM Routing panel where the primary route,
 * fallback chain, and lightweight delegation are configured.
 * @param props - `isAdmin` resolves the viewer's platform-admin flag.
 */
export function ModelsPage({ isAdmin }: { isAdmin?: boolean }) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(true)
  }, [])

  if (!loaded) return null

  return (
    <div className="cm-settings-page cm-settings-models-card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '12px' }}>
          <span style={{ fontSize: '28px' }}>🤖</span>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--cm-foreground)', margin: 0 }}>
              {t('settings.models.title')}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: '6px 0 0 0' }}>
              {t('settings.models.subtitle')}
            </p>
          </div>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', background: 'color-mix(in srgb, var(--cm-primary) 12%, transparent)', color: 'var(--cm-primary)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', fontSize: '11px', fontWeight: 600 }}
          >
            {t('settings.models.virtual')}
          </span>
        </div>

        <div style={{ padding: '20px', background: 'var(--cm-background)', border: '1px solid var(--cm-border)', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--cm-foreground)', margin: '0 0 12px 0' }}>
            {t('settings.models.whatYouSee')}
          </h3>
          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--cm-muted-foreground)', fontSize: '13px', lineHeight: '1.6' }}>
            <li style={{ marginBottom: '6px' }}>
              {t('settings.models.onlyVirtualModel', { model: 'Model CopyMonster' })}
            </li>
            <li style={{ marginBottom: '6px' }}>
              {t('settings.models.realNamesHidden')}
            </li>
            <li>
              {t('settings.models.failoverTransparent')}
            </li>
          </ul>
        </div>

        {isAdmin === true && (
          <div style={{ padding: '20px', background: 'var(--cm-card)', border: '1px solid var(--cm-border)', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--cm-foreground)', margin: '0 0 12px 0' }}>
              {t('settings.models.adminTitle')}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--cm-muted-foreground)', margin: '0 0 12px 0' }}>
              {t('settings.models.adminHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
