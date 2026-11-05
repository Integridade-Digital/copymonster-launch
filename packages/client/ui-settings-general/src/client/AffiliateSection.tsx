/** The Affiliate section: renders feature-owned affiliate settings items. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type AffiliateSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.affiliate.item'>

/**
 * Render the Affiliate section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AffiliateSection({ renderSlot }: AffiliateSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.affiliate.item', {})}
    </div>
  )
}
