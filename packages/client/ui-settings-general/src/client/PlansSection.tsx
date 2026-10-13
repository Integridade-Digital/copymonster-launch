/** The Plans section: renders feature-owned plans items. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type PlansSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.plans.item'>

/**
 * Render the Plans section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function PlansSection({ renderSlot }: PlansSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.plans.item', {})}
    </div>
  )
}
