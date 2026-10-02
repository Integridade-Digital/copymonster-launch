import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../../lib/auth/supabase.client'
import { PlansModal } from './PlansModal'
import { ProfileModal } from './ProfileModal'
import { AdminModal } from './AdminModal'
import { t, getActiveLocale } from '../../locales'
import type { PlansUser } from '../../pages/billing/PlansPage'
import type { ProfileUser } from '../../pages/ProfilePage'
import css from './FooterActionsRoot.module.css'

interface FooterActionsRootProps {
  wide?: boolean
}

export interface FooterUser extends PlansUser, ProfileUser {
  role?: string | undefined
}

export function FooterActionsRoot({ wide = true }: FooterActionsRootProps) {
  const [activeModal, setActiveModal] = useState<'plans' | 'profile' | 'admin' | null>(null)
  const [currentUser, setCurrentUser] = useState<FooterUser | null>(null)
  const lang = getActiveLocale()

  const plansBtnRef = useRef<HTMLButtonElement>(null)
  const profileBtnRef = useRef<HTMLButtonElement>(null)
  const adminBtnRef = useRef<HTMLButtonElement>(null)

  const closeModal = () => setActiveModal(null)

  const fetchCurrentUser = async () => {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser()
      if (!user) {
        setCurrentUser(null)
        return
      }

      const { data: roleData } = await supabaseClient
        .from('user_tenant_roles')
        .select('role, tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      const meta = user.user_metadata || {}
      setCurrentUser({
        id: user.id,
        email: user.email ?? undefined,
        fullName: (meta.full_name || meta.name) ? String(meta.full_name || meta.name) : undefined,
        whatsapp: meta.whatsapp ? String(meta.whatsapp) : undefined,
        role: roleData?.role ? String(roleData.role) : undefined,
        tenantId: roleData?.tenant_id ? String(roleData.tenant_id) : undefined,
      })
    } catch (err) {
      console.error('FooterActionsRoot fetchCurrentUser error:', err)
    }
  }

  useEffect(() => {
    void fetchCurrentUser()

    const handleCustomModal = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      const target = customEvent.detail
      if (target === 'plans' || target === 'profile' || target === 'admin') {
        setActiveModal(target)
      } else if (target === 'admin_audit') {
        setActiveModal('admin')
      }
    }

    window.addEventListener('copymonster:modal', handleCustomModal)
    return () => {
      window.removeEventListener('copymonster:modal', handleCustomModal)
    }
  }, [])

  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'

  const plansLabel = lang === 'zh' ? '计划 (Plans)' : 'Plans'
  const profileLabel = lang === 'zh' ? '个人资料 (Profile)' : 'Profile'
  const adminLabel = lang === 'zh' ? '管理员 (Admin)' : 'Admin'

  return (
    <>
      <div className={css.container}>
        {/* Row 1: Plans */}
        <button
          ref={plansBtnRef}
          type="button"
          className={css.actionButton}
          onClick={() => setActiveModal('plans')}
          title={wide ? undefined : t('common.plans')}
          aria-haspopup="dialog"
        >
          <span className={css.icon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </span>
          {wide && <span className={css.label}>{plansLabel}</span>}
        </button>

        {/* Row 2: Profile */}
        <button
          ref={profileBtnRef}
          type="button"
          className={css.actionButton}
          onClick={() => setActiveModal('profile')}
          title={wide ? undefined : t('common.profile')}
          aria-haspopup="dialog"
        >
          <span className={css.icon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          {wide && <span className={css.label}>{profileLabel}</span>}
        </button>

        {/* Row 3: Admin */}
        {isAdmin && (
          <button
            ref={adminBtnRef}
            type="button"
            className={css.actionButton}
            onClick={() => setActiveModal('admin')}
            title={wide ? undefined : t('common.admin')}
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
      </div>

      <PlansModal
        isOpen={activeModal === 'plans'}
        onClose={closeModal}
        triggerRef={plansBtnRef}
        currentUser={currentUser}
      />
      <ProfileModal
        isOpen={activeModal === 'profile'}
        onClose={closeModal}
        triggerRef={profileBtnRef}
        currentUser={currentUser}
        onProfileUpdated={fetchCurrentUser}
      />
      <AdminModal
        isOpen={activeModal === 'admin'}
        onClose={closeModal}
        triggerRef={adminBtnRef}
        role={currentUser?.role}
      />
    </>
  )
}
