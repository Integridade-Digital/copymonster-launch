// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconAlarmClockOutline16, IconApiOutline14, IconArchiveOutline20, IconFolderClose16,
  IconGoalOutline16, IconSendOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 21 figma extracts + fourteen product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(81)
    // The composer menu's own glyphs, pinned by name.
    expect(iconNames).toEqual(expect.arrayContaining(['IconPlanOutline14', 'IconCompactOutline16', 'IconShieldOutline16']))
  })

  it('the permission selector composes its marks over the shield contour exported here', () => {
    const { container } = render(<primitives.IconShieldOutline16 />)
    expect(container.querySelector('path')?.getAttribute('d')).toBe(primitives.SHIELD_OUTLINE_PATH)
    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe(primitives.SHIELD_OUTLINE_STROKE)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline14 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
    const alarm = render(<IconAlarmClockOutline16 />)
    expect(alarm.container.querySelector('svg')!.getAttribute('width')).toBe('16')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the brand mark image at a square of the requested size', () => {
    const view = render(<primitives.FishLogo />)
    const img = view.container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/brand.png')
    expect(img.getAttribute('width')).toBe('24')
    expect(img.getAttribute('height')).toBe('24')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.hasAttribute('aria-hidden')).toBe(true)

    view.rerender(<primitives.FishLogo size={34} className="x" />)
    expect(img.getAttribute('width')).toBe('34')
    expect(img.getAttribute('height')).toBe('34')
    expect(img.classList.contains('x')).toBe(true)
  })
})

describe('BrandWordmark', () => {
  it('renders the mark image and the wordmark image, both driven by size', () => {
    const { container } = render(<primitives.BrandWordmark size={40} />)
    const [mark, wordmark] = Array.from(container.querySelectorAll('img'))
    expect(mark!.getAttribute('src')).toBe('/brand.png')
    expect(mark!.getAttribute('width')).toBe('40')
    expect(mark!.getAttribute('height')).toBe('40')
    expect(wordmark!.getAttribute('src')).toBe('/brand-text.png')
    expect(wordmark!.getAttribute('alt')).toBe('CopyMonster')
    expect(wordmark!.getAttribute('height')).toBe('24')
  })

  it('drops only the leading mark when includeMark is false', () => {
    const { container } = render(<primitives.BrandWordmark includeMark={false} />)
    const [wordmark] = Array.from(container.querySelectorAll('img'))
    expect(container.querySelector('img[src="/brand.png"]')).toBeNull()
    expect(wordmark!.getAttribute('src')).toBe('/brand-text.png')
    expect(wordmark!.getAttribute('alt')).toBe('CopyMonster')
  })
})
