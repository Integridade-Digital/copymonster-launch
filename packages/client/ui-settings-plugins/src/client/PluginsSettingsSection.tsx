/** Plugins settings section: localized tabs around feature-owned pages. */

import { useEffect, useId, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import { isPlatformAdmin } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PluginsSettingsSection.module.css'

/** One tab projected from a `settings.plugins.tab` contribution. */
export interface PluginsSettingsTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the section. */
export interface PluginsSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Plugins tab ledger. */
    tabs: HostObservable<readonly PluginsSettingsTabEntry[]>
  }
}

/** Props the renderer binds for the section. */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.tab'>
  & InjectFace<PluginsSettingsSectionInjected>

/** Render one Plugins page whose contents arrive from feature-owned tabs; one contribution shows as the page itself. */
export function PluginsSettingsSection({ t, renderSlot, useTabs }: PluginsSettingsSectionProps) {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const allRows = useTabs(value => value)
  // Hide the CopyMonster Market tab (id: "dsh-market") for non-admin users.
  const isAdmin = isPlatformAdmin()
  const MARKET_TAB_ID = 'dsh-market'
  const rows = isAdmin ? allRows : allRows.filter(row => row.id !== MARKET_TAB_ID)
  const [activeId, setActiveId] = useState<string>()
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id
  // If a non-admin user somehow has the market tab selected (e.g., via URL), redirect to first available tab.
  useEffect(() => {
    if (!isAdmin && activeId === MARKET_TAB_ID) {
      setActiveId(rows[0]?.id)
    }
  }, [isAdmin, activeId, rows])
  const single = rows.length === 1 ? rows[0] : undefined

  // A tab mounts only when first selected, then stays mounted while hidden so
  // local drafts, disclosure state, search, and the inventory snapshot survive
  // switching between the two views.
  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : single !== undefined ? (
        <div className={css.panel}>{renderSlot('settings.plugins.tab', {}, { only: single.id })}</div>
      ) : (
        <>
          <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
            {rows.map((row, index) => {
              const selected = row.id === active
              return (
                <button
                  key={row.id}
                  ref={(element) => { tabRefs.current[index] = element }}
                  id={`${tabsId}-tab-${row.id}`}
                  type="button"
                  role="tab"
                  className={css.tab}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-panel-${row.id}`}
                  data-active={selected ? 'true' : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => { setActiveId(row.id) }}
                  onKeyDown={(event) => {
                    let nextIndex: number
                    switch (event.key) {
                      case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                      case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                      case 'Home': nextIndex = 0; break
                      case 'End': nextIndex = rows.length - 1; break
                      default: return
                    }
                    event.preventDefault()
                    const nextRow = rows[nextIndex] as PluginsSettingsTabEntry
                    const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
                    setActiveId(nextRow.id)
                    nextTab.focus()
                  }}
                >
                  {row.label}
                </button>
              )
            })}
          </div>
          {rows
            .filter(row => row.id === active || visitedIds.has(row.id))
            .map((row) => {
              const selected = row.id === active
              return (
                <div
                  key={row.id}
                  id={`${tabsId}-panel-${row.id}`}
                  className={css.panel}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-tab-${row.id}`}
                  hidden={!selected}
                >
                  {renderSlot('settings.plugins.tab', {}, { only: row.id })}
                </div>
              )
            })}
        </>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Built-in plugins section and plugin configuration page copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}
