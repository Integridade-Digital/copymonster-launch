/** The My DNA section: renders feature-owned DNA items. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type MyDnaSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.my-dna.item'>

/**
 * Render the My DNA section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function MyDnaSection({ renderSlot }: MyDnaSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.my-dna.item', {})}
    </div>
  )
}
