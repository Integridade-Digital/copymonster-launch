import type { IconProps } from './icons/props.ts'

/** Display options for the CopyMonster brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading brand mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the CopyMonster brand wordmark (image mark + wordmark image).
 * @param props.size - height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading brand mark.
 * @returns the wordmark as inline elements.
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.25,
        height: size,
        fontSize: size * 0.7,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {includeMark && (
        <img
          src="/brand.png"
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          style={{ objectFit: 'contain', display: 'block' }}
        />
      )}
      <img
        src="/brand-text.png"
        alt="CopyMonster"
        height={size * 0.6}
        style={{ objectFit: 'contain', display: 'block' }}
      />
    </span>
  )
}
