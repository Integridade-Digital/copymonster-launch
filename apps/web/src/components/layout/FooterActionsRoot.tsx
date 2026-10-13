import { useEffect, useRef, useState } from 'react'
import { AdminModal } from './AdminModal'
import { OnboardingDnaModal } from './OnboardingDnaModal'
import { consumeOnboardingModalRequest, subscribeOnboardingModalRequest } from '../dna/onboardingModal'
import { t, getActiveLocale } from '../../locales'
import css from './FooterActionsRoot.module.css'

interface FooterActionsRootProps {
  wide?: boolean
}

export function FooterActionsRoot({ wide = true }: FooterActionsRootProps) {
  const [activeModal, setActiveModal] = useState<'admin' | 'dna-onboarding' | null>(null)
  const [isAdminFlag, setIsAdminFlag] = useState(false)
  const lang = getActiveLocale()

  const adminBtnRef = useRef<HTMLButtonElement>(null)

  const closeModal = () => setActiveModal(null)

  useEffect(() => {
    const handleCustomModal = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      const target = customEvent.detail
      if (target === 'admin' || target === 'admin_audit') {
        setActiveModal('admin')
      }
    }

    window.addEventListener('copymonster:modal', handleCustomModal)

    // The admin flag lives in public.users.metadata, not the JWT or
    // user_metadata, so it is only known after the app bootstrap resolves the
    // profile and republishes __DSH_AUTH__. Re-read it on each notification.
    const readIsAdminFlag = (): boolean =>
      (globalThis as { __DSH_AUTH__?: { isAdmin?: boolean } }).__DSH_AUTH__?.isAdmin === true
    setIsAdminFlag(readIsAdminFlag())
    const handleAuthResolved = (): void => { setIsAdminFlag(readIsAdminFlag()) }
    window.addEventListener('copymonster:auth', handleAuthResolved)

    if (consumeOnboardingModalRequest()) setActiveModal('dna-onboarding')
    const unsubscribeOnboarding = subscribeOnboardingModalRequest(() => {
      setActiveModal('dna-onboarding')
    })

    return () => {
      window.removeEventListener('copymonster:modal', handleCustomModal)
      window.removeEventListener('copymonster:auth', handleAuthResolved)
      unsubscribeOnboarding()
    }
  }, [])

  const isAdmin = isAdminFlag

  const adminLabel = lang === 'zh' ? '管理员 (Admin)' : 'Admin'

  return (
    <>
      <div className={css.container}>
        {/* Row: Admin */}
        {isAdmin && (
          <button
            ref={adminBtnRef}
            type="button"
            className={css.actionButton}
            onClick={() => setActiveModal('admin')}
            title={wide ? undefined : t('common.admin')}
            aria-label={t('common.admin')}
            aria-haspopup="dialog"
          >
            <span className={css.icon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </span>
            {wide && <span className={css.label}>{adminLabel}</span>}
          </button>
        )}

        {/* Row: Sign Out */}
        <button
          type="button"
          className={css.actionButton}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('copymonster:logout'))
          }}
          title={wide ? undefined : t('common.signOut')}
          aria-label={t('common.signOut')}
        >
          <span className={css.icon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          {wide && <span className={css.label}>{t('common.signOut')}</span>}
        </button>
      </div>

      <AdminModal
        isOpen={activeModal === 'admin'}
        onClose={closeModal}
        triggerRef={adminBtnRef}
        isPlatformAdmin={isAdmin}
      />
      <OnboardingDnaModal
        isOpen={activeModal === 'dna-onboarding'}
        onClose={closeModal}
      />
    </>
  )
}
