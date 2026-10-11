/**
 * Cross-component signal that opens the onboarding guide modal.
 *
 * The boot bridge and the My DNA actions request the modal before
 * `FooterActionsRoot` (the modal host) is guaranteed to be mounted, so a
 * request is remembered until the host consumes it and subscribers are
 * notified when one arrives late.
 */

let pending = false

const listeners = new Set<() => void>()

/** Request the onboarding guide modal; the host opens it now or on mount. */
export function requestOnboardingModal(): void {
  pending = true
  for (const listener of listeners) listener()
}

/**
 * Consume a pending request, if any.
 * @returns true when a request was pending and is now cleared.
 */
export function consumeOnboardingModalRequest(): boolean {
  const wasPending = pending
  pending = false
  return wasPending
}

/**
 * Subscribe to later requests.
 * @param listener - called on each request once the host is mounted.
 * @returns disposer removing the subscription.
 */
export function subscribeOnboardingModalRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
