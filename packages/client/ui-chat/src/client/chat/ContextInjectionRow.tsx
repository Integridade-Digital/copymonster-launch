import { useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconContextInjectionOutline16, ReferenceIconRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  producer: ContextMessageNode['producer']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * A producer label that is a scoped package id: the name of an internal
 * subsystem, never copy a reader should see.
 */
const SCOPED_PACKAGE_ID = /^@[^\s/]+\/\S+$/

function isToolRegistrySource(source: unknown): boolean {
  return typeof source === 'object' && source !== null
    && 'kind' in source && source.kind === 'tool-registry'
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * A producer identified only by a scoped package id is an internal subsystem,
 * so the header carries the generic system-context title and no package name.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, producer, form, t }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false)
  const additions = content.flatMap(block => block.type === 'tool-addition' ? [block.toolName] : [])
  const removals = content.flatMap(block => block.type === 'tool-removal' ? [block.toolName] : [])
  const isToolRegistryUpdate = isToolRegistrySource(source)
    && content.length > 0 && additions.length + removals.length === content.length
  if (isToolRegistryUpdate) {
    if (content.length === 1) {
      const name = additions[0] ?? removals[0] ?? ''
      return <div className={css.body} data-tool-registry-update="single">
        {t(additions.length ? 'message.toolAdded' : 'message.toolRemoved', { name })}
      </div>
    }
    const summary = additions.length > 0 && removals.length > 0
      ? t('message.toolsChanged', { added: additions.length, removed: removals.length })
      : additions.length > 0
        ? t('message.toolsAddedCount', { count: additions.length })
        : t('message.toolsRemovedCount', { count: removals.length })
    return <DisclosureRow
      className={css.root}
      icon={<IconContextInjectionOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t('message.toolsUpdated')}
      collapsedContent={<span className={css.summary} data-context-summary>{summary}</span>}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form="tool-registry">
        {additions.length > 0 && <div>{t('message.toolsAdded', { names: additions.join(', ') })}</div>}
        {removals.length > 0 && <div>{t('message.toolsRemoved', { names: removals.join(', ') })}</div>}
      </div>
    </DisclosureRow>
  }
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t })
  const packageProducer = producer.label !== null && SCOPED_PACKAGE_ID.test(producer.label)
  const title = packageProducer
    ? t('message.systemContext')
    : t(producer.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')

  return (
    <DisclosureRow
      className={css.root}
      icon={producer.role === 'recall'
        ? <span data-context-recall-icon><ReferenceIconRegular kind="session" /></span>
        : <IconContextInjectionOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={title}
      collapsedContent={producer.label === null || packageProducer ? undefined : (
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the two readable parts and the two disclosure rows expose one
           name shape. A source that names no producer drops the dot with it. */
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.source} data-context-source>{producer.label}</span>
          {summary !== null && (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.summary} data-context-summary>{summary}</span>
            </>
          )}
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </DisclosureRow>
  )
}
