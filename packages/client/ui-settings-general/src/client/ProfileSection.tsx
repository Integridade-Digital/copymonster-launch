/** The Profile section: renders feature-owned profile items. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type ProfileSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.profile.item'>

/**
 * Render the Profile section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ProfileSection({ renderSlot }: ProfileSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.profile.item', {})}
    </div>
  )
}
