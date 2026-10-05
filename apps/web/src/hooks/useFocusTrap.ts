import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface UseFocusTrapOptions {
  isOpen: boolean
  onClose?: (() => void) | undefined
  triggerRef?: RefObject<HTMLElement | null> | undefined
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { isOpen, onClose, triggerRef }: UseFocusTrapOptions
) {
  useEffect(() => {
    if (!isOpen) return

    const container = containerRef.current
    if (!container) return

    const getFocusableElements = (): HTMLElement[] => {
      if (!container) return []
      return Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => {
        return (
          el.offsetParent !== null ||
          el.getClientRects().length > 0 ||
          getComputedStyle(el).visibility !== 'hidden'
        )
      })
    }

    const initialElements = getFocusableElements()
    const firstInitial = initialElements[0]
    if (firstInitial) {
      firstInitial.focus()
    } else {
      container.focus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onClose) {
          event.stopPropagation()
          event.preventDefault()
          onClose()
        }
        return
      }

      if (event.key !== 'Tab') return

      const elements = getFocusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        return
      }

      const firstElement = elements[0]
      const lastElement = elements[elements.length - 1]

      if (event.shiftKey) {
        if (firstElement && (document.activeElement === firstElement || document.activeElement === container)) {
          event.preventDefault()
          if (lastElement) {
            lastElement.focus()
          }
        }
      } else {
        if (lastElement && document.activeElement === lastElement) {
          event.preventDefault()
          if (firstElement) {
            firstElement.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      triggerRef?.current?.focus()
    }
  }, [isOpen, onClose, triggerRef, containerRef])
}
