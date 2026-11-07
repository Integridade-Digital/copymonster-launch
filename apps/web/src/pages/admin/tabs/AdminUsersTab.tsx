import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'
import { t } from '../../../locales'

interface TenantOption {
  id: string
  name: string
  slug: string
}

interface AdminUserRow {
  user_id: string
  email: string
  full_name: string | null
  membership_id: string | null
  tenant_id: string | null
  tenant_name: string | null
  tenant_slug: string | null
  role: string | null
  user_status: 'active' | 'suspended' | string
  created_at: string
}

interface UserKPIs {
  total: number
  owners: number
  admins: number
  members: number
  suspended: number
}

type ModalType = 'role' | 'status' | 'reset_password'

export function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [kpis, setKpis] = useState<UserKPIs | null>(null)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedTenant, setSelectedTenant] = useState<string>('')

  const [pageSize, setPageSize] = useState<number>(25)
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Controle de menu de ações por linha e modais
  const [actionMenuOpenRow, setActionMenuOpenRow] = useState<string | null>(null)
  const [activeModalType, setActiveModalType] = useState<ModalType | null>(null)
  const [activeActionUser, setActiveActionUser] = useState<AdminUserRow | null>(null)

  // Estados dos modais de ação
  const [selectedNewRole, setSelectedNewRole] = useState<'owner' | 'admin' | 'member'>('member')
  const [tenantOwnerCount, setTenantOwnerCount] = useState<number | null>(null)
  const [isMutating, setIsMutating] = useState<boolean>(false)
  const [modalFeedback, setModalFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } | null }) => {
      if (data?.user) {
        setCurrentUserId(data.user.id)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchTerm])

  // Fecha menu de ações ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      setActionMenuOpenRow(null)
    }
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  const loadTenants = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, slug')
        .order('name', { ascending: true })

      if (error) throw error
      setTenants(data || [])
    } catch (err: unknown) {
      console.error('[AdminUsersTab] Error ao carregar tenants:', err)
    }
  }, [])

  const loadKPIs = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_admin_users_kpis')
      if (error) throw error
      if (data) {
        const raw = Array.isArray(data) ? data[0] : data
        setKpis({
          total: Number(raw?.total_users ?? 0),
          owners: Number(raw?.total_owners ?? 0),
          admins: Number(raw?.total_admins ?? 0),
          members: Number(raw?.total_members ?? 0),
          suspended: Number(raw?.total_suspended ?? 0),
        })
      }
    } catch (err: unknown) {
      console.error('[AdminUsersTab] Error ao carregar KPIs de usuários:', err)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const offset = (currentPage - 1) * pageSize
      const params: {
        p_limit: number
        p_offset: number
        p_search?: string
        p_role?: string
        p_status?: string
        p_tenant_id?: string
      } = {
        p_limit: pageSize,
        p_offset: offset,
      }
      if (debouncedSearch) params.p_search = debouncedSearch
      if (selectedRole) params.p_role = selectedRole
      if (selectedStatus) params.p_status = selectedStatus
      if (selectedTenant) params.p_tenant_id = selectedTenant

      const { data, error: rpcError } = await supabase.rpc('get_admin_users', params)

      if (rpcError) throw rpcError

      const list: AdminUserRow[] = (data || []).map((row: {
        user_id: string
        email: string
        full_name: string | null
        membership_id: string | null
        tenant_id: string | null
        tenant_name: string | null
        tenant_slug: string | null
        role: string | null
        user_status: string
        created_at: string
        total_count?: number
      }) => ({
        user_id: row.user_id,
        email: row.email,
        full_name: row.full_name,
        membership_id: row.membership_id,
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_name,
        tenant_slug: row.tenant_slug,
        role: row.role,
        user_status: row.user_status || 'active',
        created_at: row.created_at,
      }))

      setUsers(list)
      const count = data && data.length > 0 && data[0] && 'total_count' in data[0] && data[0].total_count !== undefined ? Number(data[0].total_count) : 0
      setTotalCount(count)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      console.error('[AdminUsersTab] Error ao listar usuários:', err)
    } finally {
      setIsLoading(false)
    }
  }, [currentPage, pageSize, debouncedSearch, selectedRole, selectedStatus, selectedTenant])

  useEffect(() => {
    loadTenants()
    loadKPIs()
  }, [loadTenants, loadKPIs])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const handleClearFilters = () => {
    setSearchTerm('')
    setDebouncedSearch('')
    setSelectedRole('')
    setSelectedStatus('')
    setSelectedTenant('')
    setCurrentPage(1)
  }

  const hasActiveFilters = Boolean(debouncedSearch || selectedRole || selectedStatus || selectedTenant)
  const totalPages = Math.ceil(totalCount / pageSize) || 1

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(dateStr))
    } catch {
      return dateStr
    }
  }

  const closeModal = () => {
    setActiveModalType(null)
    setActiveActionUser(null)
    setModalFeedback(null)
    setTenantOwnerCount(null)
    setIsMutating(false)
  }

  const openRoleModal = async (user: AdminUserRow) => {
    setActiveActionUser(user)
    setSelectedNewRole((user.role as 'owner' | 'admin' | 'member') || 'member')
    setActiveModalType('role')
    setModalFeedback(null)
    setTenantOwnerCount(null)

    // Contagem de owners se o tenant for conhecido
    if (user.tenant_id) {
      try {
        const { count, error } = await supabase
          .from('user_tenant_roles')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', user.tenant_id)
          .eq('role', 'owner')

        if (!error && count !== null) {
          setTenantOwnerCount(count)
        }
      } catch {
        // silencioso
      }
    }
  }

  const openStatusModal = (user: AdminUserRow) => {
    setActiveActionUser(user)
    setActiveModalType('status')
    setModalFeedback(null)
  }

  const openResetPasswordModal = (user: AdminUserRow) => {
    setActiveActionUser(user)
    setActiveModalType('reset_password')
    setModalFeedback(null)
  }

  // Execução da mutação de Role
  const handleUpdateRole = async () => {
    if (!activeActionUser || !activeActionUser.membership_id) return
    setIsMutating(true)
    setModalFeedback(null)

    try {
      const { error: rpcError } = await supabase.rpc('admin_update_user_role', {
        p_membership_id: activeActionUser.membership_id,
        p_new_role: selectedNewRole,
      })

      if (rpcError) throw rpcError

      setModalFeedback({ type: 'success', message: t('admin.users.roleUpdated') })
      await Promise.all([loadUsers(), loadKPIs()])
      setTimeout(() => closeModal(), 1200)
    } catch (err: unknown) {
      setModalFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsMutating(false)
    }
  }

  // Execução da mutação de Status (Suspender / Reativar)
  const handleToggleStatus = async () => {
    if (!activeActionUser) return
    setIsMutating(true)
    setModalFeedback(null)

    const nextStatus = activeActionUser.user_status === 'suspended' ? 'active' : 'suspended'

    try {
      const { error: rpcError } = await supabase.rpc('admin_toggle_user_status', {
        p_user_id: activeActionUser.user_id,
        p_new_status: nextStatus,
      })

      if (rpcError) throw rpcError

      setModalFeedback({
        type: 'success',
        message: nextStatus === 'suspended' ? t('admin.users.suspended') : t('admin.users.reactivated'),
      })
      await Promise.all([loadUsers(), loadKPIs()])
      setTimeout(() => closeModal(), 1200)
    } catch (err: unknown) {
      setModalFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsMutating(false)
    }
  }

  // Execução de disparo de Reset de Senha
  const handleResetPassword = async () => {
    if (!activeActionUser) return
    setIsMutating(true)
    setModalFeedback(null)

    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(activeActionUser.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (authError) throw authError

      setModalFeedback({
        type: 'success',
        message: t('admin.users.resetSent', { email: activeActionUser.email }),
      })
      setTimeout(() => closeModal(), 1800)
    } catch (err: unknown) {
      setModalFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsMutating(false)
    }
  }

  const isSelf = activeActionUser ? activeActionUser.user_id === currentUserId : false
  const isLastOwner = activeActionUser?.role === 'owner' && (tenantOwnerCount !== null && tenantOwnerCount <= 1)

  return (
    <div className="adminTabBody">
      <div className="adminTabHeader">
        <div className="adminTabHeaderText">
          <div className="adminTabTitleRow">
            <p className="adminTabSubtitle">{t('admin.users.subtitle')}</p>
            <span className="adminBadge adminBadgePrimary">
              {t('admin.users.totalBadge', { count: totalCount })}
            </span>
          </div>
        </div>
        <div className="adminToolbar">
          <button
            onClick={() => {
              loadUsers()
              loadKPIs()
            }}
            disabled={isLoading}
            title={t('admin.users.refreshAria')}
            className="adminButton adminButtonSecondary"
            style={{ opacity: isLoading ? 0.5 : 1 }}
          >
            {isLoading ? (
              <span className="adminSpinner" aria-hidden="true" />
            ) : (
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-muted-foreground)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span>{t('admin.common.refresh')}</span>
          </button>
        </div>
      </div>

      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.users.total')}</div>
          <div className="adminCardValue">{kpis ? kpis.total : '-'}</div>
          <div className="adminCardSub">{t('admin.users.registered')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.users.owners')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-primary)' }}>{kpis ? kpis.owners : '-'}</div>
          <div className="adminCardSub">{t('admin.users.ownersHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.users.admins')}</div>
          <div className="adminCardValue">{kpis ? kpis.admins : '-'}</div>
          <div className="adminCardSub">{t('admin.users.adminsHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.users.members')}</div>
          <div className="adminCardValue">{kpis ? kpis.members : '-'}</div>
          <div className="adminCardSub">{t('admin.users.membersHint')}</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">{t('admin.common.suspended')}</div>
          <div className="adminCardValue" style={{ color: 'var(--cm-destructive)' }}>{kpis ? kpis.suspended : '-'}</div>
          <div className="adminCardSub">{t('admin.users.suspendedHint')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          className="adminInput"
          style={{ width: '240px', marginBottom: 0 }}
        />
        <select
          value={selectedRole}
          onChange={(e) => {
            setSelectedRole(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="">{t('admin.users.allRoles')}</option>
          <option value="owner">{t('admin.users.owners')}</option>
          <option value="admin">{t('admin.users.admins')}</option>
          <option value="member">{t('admin.users.members')}</option>
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => {
            setSelectedStatus(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '160px', marginBottom: 0 }}
        >
          <option value="">{t('admin.common.allStatuses')}</option>
          <option value="active">{t('admin.common.active')}</option>
          <option value="suspended">{t('admin.common.suspended')}</option>
        </select>
        <select
          value={selectedTenant}
          onChange={(e) => {
            setSelectedTenant(e.target.value)
            setCurrentPage(1)
          }}
          className="adminInput"
          style={{ width: '220px', marginBottom: 0 }}
        >
          <option value="">{t('admin.common.allTenants')}</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="adminLinkButton"
          >
            {t('admin.common.clearAllFilters')}
          </button>
        )}
      </div>

      {error && (
        <div className="adminNotice adminNoticeError">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadUsers()}
            className="adminRowButton adminRowButtonDanger"
          >
            {t('admin.common.retry')}
          </button>
        </div>
      )}

      <div className="adminCard adminCardTable">
        <div style={{ overflowX: 'auto' }}>
          <table className="adminTable">
            <thead>
              <tr>
                <th>{t('admin.common.user')}</th>
                <th>{t('admin.common.tenant')}</th>
                <th>{t('admin.users.role')}</th>
                <th>{t('admin.common.status')}</th>
                <th>{t('admin.users.registeredAt')}</th>
                <th style={{ textAlign: 'right' }}>{t('admin.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      <span className="adminSpinner" aria-hidden="true" />
                      <span>{t('admin.users.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--cm-muted-foreground)' }}>
                    {hasActiveFilters ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <p style={{ color: 'var(--cm-foreground)', margin: 0 }}>{t('admin.users.emptyFiltered')}</p>
                        <button
                          onClick={handleClearFilters}
                          className="adminLinkButton"
                        >
                          {t('admin.common.clearFilters')}
                        </button>
                      </div>
                    ) : (
                      <span>{t('admin.users.empty')}</span>
                    )}
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const rowKey = user.membership_id ?? `${user.user_id}-${user.tenant_id ?? 'root'}`
                  const isMenuOpen = actionMenuOpenRow === rowKey
                  const isPrivilegedRole = user.role === 'owner' || user.role === 'admin'
                  const roleClassName = isPrivilegedRole ? 'adminBadge adminBadgePrimary' : 'adminBadge'
                  const suspended = user.user_status === 'suspended'

                  return (
                    <tr key={rowKey}>
                      <td>
                        <div style={{ fontWeight: 500, color: 'var(--cm-foreground)' }}>{user.full_name || t('admin.common.noName')}</div>
                        <div style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{user.email}</div>
                      </td>

                      <td>
                        {user.tenant_name ? (
                          <div>
                            <span style={{ color: 'var(--cm-foreground)', fontWeight: 500 }}>{user.tenant_name}</span>
                            {user.tenant_slug && (
                              <span style={{ fontSize: '10px', color: 'var(--cm-muted-foreground)', display: 'block', fontFamily: 'monospace' }}>
                                /{user.tenant_slug}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--cm-muted-foreground)', fontStyle: 'italic' }}>{t('admin.users.noTenant')}</span>
                        )}
                      </td>

                      <td>
                        {user.role ? (
                          <span className={roleClassName} style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{user.role}</span>
                        ) : (
                          <span style={{ color: 'var(--cm-muted-foreground)' }}>-</span>
                        )}
                      </td>

                      <td>
                        <span className={`adminBadge ${suspended ? 'adminBadgeDanger' : 'adminBadgeSuccess'}`}>
                          <span
                            aria-hidden="true"
                            style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}
                          />
                          <span>{suspended ? t('admin.common.suspended') : t('admin.common.active')}</span>
                        </span>
                      </td>

                      <td style={{ color: 'var(--cm-muted-foreground)' }}>
                        {formatDate(user.created_at)}
                      </td>

                      <td style={{ position: 'relative', textAlign: 'right' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActionMenuOpenRow(isMenuOpen ? null : rowKey)
                            }}
                            title={t('admin.users.actionsAria')}
                            className="adminIconButton"
                          >
                            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                              />
                            </svg>
                          </button>

                          {isMenuOpen && (
                            <div
                              onClick={e => e.stopPropagation()}
                              className="adminMenu"
                            >
                              <button
                                onClick={() => {
                                  setActionMenuOpenRow(null)
                                  openRoleModal(user)
                                }}
                                disabled={!user.membership_id}
                                className="adminMenuItem"
                                style={{ opacity: user.membership_id ? 1 : 0.4 }}
                              >
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-primary)' }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span>{t('admin.users.changeRole')}</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActionMenuOpenRow(null)
                                  openStatusModal(user)
                                }}
                                className="adminMenuItem"
                                style={{ color: suspended ? 'var(--cm-success)' : 'var(--cm-destructive)' }}
                              >
                                {suspended ? (
                                  <>
                                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>{t('admin.users.reactivate')}</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                    </svg>
                                    <span>{t('admin.users.suspend')}</span>
                                  </>
                                )}
                              </button>

                              <button
                                onClick={() => {
                                  setActionMenuOpenRow(null)
                                  openResetPasswordModal(user)
                                }}
                                className="adminMenuItem"
                              >
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--cm-primary)' }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                </svg>
                                <span>{t('admin.users.resetPassword')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderTop: '1px solid var(--cm-border)', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--cm-muted-foreground)' }}>
            <span>{t('admin.common.showing')}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="adminInput"
              style={{ width: '72px', height: '28px', marginBottom: 0, fontSize: '12px' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>{t('admin.users.showingOf', { count: users.length, total: totalCount })}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--cm-muted-foreground)' }}>
              {t('admin.common.pageOf', { page: currentPage, total: totalPages })}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage <= 1 || isLoading}
                className="adminRowButton"
                style={{ opacity: (currentPage <= 1 || isLoading) ? 0.4 : 1 }}
              >
                {t('admin.common.previous')}
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage >= totalPages || isLoading}
                className="adminRowButton"
                style={{ opacity: (currentPage >= totalPages || isLoading) ? 0.4 : 1 }}
              >
                {t('admin.common.next')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal 1: Alterar Role (Role) */}
      {activeModalType === 'role' && activeActionUser && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={el => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModal()
              }
            }}
            className="adminDialog"
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">{t('admin.users.changeRoleTitle')}</h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', marginBottom: '4px' }}>{t('admin.audit.userLabel')}</span>
                <div style={{ padding: '10px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                  <div style={{ color: 'var(--cm-foreground)', fontWeight: 500, fontSize: '13px' }}>{activeActionUser.full_name || t('admin.common.noName')}</div>
                  <div style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{activeActionUser.email}</div>
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--cm-muted-foreground)', display: 'block', marginBottom: '4px' }}>{t('admin.users.linkedTenant')}</span>
                <div style={{ color: 'var(--cm-foreground)', fontWeight: 500, padding: '10px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)', fontSize: '13px' }}>
                  {activeActionUser.tenant_name || t('admin.common.none')}
                </div>
              </div>

              <div>
                <label style={{ color: 'var(--cm-muted-foreground)', display: 'block', marginBottom: '4px' }}>{t('admin.users.selectRole')}</label>
                <select
                  value={selectedNewRole}
                  onChange={e => setSelectedNewRole(e.target.value as 'owner' | 'admin' | 'member')}
                  disabled={isMutating}
                  className="adminInput"
                  style={{ marginBottom: 0, opacity: isMutating ? 0.5 : 1 }}
                >
                  {(['owner', 'admin', 'member'] as const).map((r) => {
                    const isCurrent = activeActionUser.role === r
                    const isOptionDisabled = (isSelf && r !== activeActionUser.role) || (isLastOwner && r !== 'owner')

                    return (
                      <option key={r} value={r} disabled={isOptionDisabled}>
                        {r.toUpperCase()} {isCurrent ? t('admin.users.roleCurrent') : ''}
                        {isSelf && !isCurrent ? ` ${t('admin.users.roleSelfBlocked')}` : ''}
                        {isLastOwner && !isCurrent ? ` ${t('admin.users.roleLastOwner')}` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {isSelf && (
                <div style={{ padding: '12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid color-mix(in srgb, var(--cm-primary) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-primary) 10%, transparent)', color: 'var(--cm-primary)', fontSize: '11px' }}>
                  {t('admin.users.selfRoleWarning')}
                </div>
              )}

              {isLastOwner && selectedNewRole !== 'owner' && (
                <div style={{ padding: '12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '11px' }}>
                  {t('admin.users.lastOwnerWarning')}
                </div>
              )}

              {modalFeedback && (
                <div className={`adminNotice ${modalFeedback.type === 'success' ? 'adminNoticeSuccess' : 'adminNoticeError'}`}>
                  {modalFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="adminButton adminButtonSecondary"
                  style={{ flex: 1, opacity: isMutating ? 0.5 : 1 }}
                >
                  {t('admin.common.cancelAction')}
                </button>
                <button
                  onClick={handleUpdateRole}
                  disabled={
                    isMutating ||
                    selectedNewRole === activeActionUser.role ||
                    (isSelf && selectedNewRole !== activeActionUser.role) ||
                    (isLastOwner && selectedNewRole !== 'owner')
                  }
                  className="adminButton"
                  style={{ flex: 1, gap: '8px', opacity: (isMutating || selectedNewRole === activeActionUser.role || (isSelf && selectedNewRole !== activeActionUser.role) || (isLastOwner && selectedNewRole !== 'owner')) ? 0.4 : 1 }}
                >
                  {isMutating && <span className="adminSpinner" aria-hidden="true" />}
                  <span>{t('admin.users.saveChange')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Suspender / Reativar Conta */}
      {activeModalType === 'status' && activeActionUser && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={el => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModal()
              }
            }}
            className="adminDialog"
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">
                {activeActionUser.user_status === 'suspended' ? t('admin.users.reactivateUser') : t('admin.users.suspendUser')}
              </h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ color: 'var(--cm-muted-foreground)', margin: 0 }}>
                {activeActionUser.user_status === 'suspended' ? (
                  <>{t('admin.users.reactivateConfirm')}</>
                ) : (
                  <>
                    {t('admin.users.suspendConfirm')}
                  </>
                )}
              </p>

              <div style={{ padding: '12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ color: 'var(--cm-foreground)', fontWeight: 500, fontSize: '13px' }}>{activeActionUser.full_name || t('admin.common.noName')}</div>
                <div style={{ color: 'var(--cm-muted-foreground)', fontFamily: 'monospace', fontSize: '11px' }}>{activeActionUser.email}</div>
                <div style={{ fontSize: '11px' }}>
                  {t('admin.users.currentStatus')}{' '}
                  <span style={{ color: activeActionUser.user_status === 'suspended' ? 'var(--cm-destructive)' : 'var(--cm-success)', fontWeight: 600 }}>
                    {activeActionUser.user_status === 'suspended' ? t('admin.common.suspended') : t('admin.common.active')}
                  </span>
                </div>
              </div>

              {isSelf && (
                <div style={{ padding: '12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid color-mix(in srgb, var(--cm-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--cm-destructive) 10%, transparent)', color: 'var(--cm-destructive)', fontSize: '11px' }}>
                  {t('admin.users.selfSuspendWarning')}
                </div>
              )}

              {modalFeedback && (
                <div className={`adminNotice ${modalFeedback.type === 'success' ? 'adminNoticeSuccess' : 'adminNoticeError'}`}>
                  {modalFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="adminButton adminButtonSecondary"
                  style={{ flex: 1, opacity: isMutating ? 0.5 : 1 }}
                >
                  {t('admin.common.cancelAction')}
                </button>
                <button
                  onClick={handleToggleStatus}
                  disabled={isMutating || isSelf}
                  className="adminButton"
                  style={{
                    flex: 1,
                    background: activeActionUser.user_status === 'suspended' ? 'var(--cm-success)' : 'var(--cm-destructive)',
                    color: 'var(--cm-primary-foreground)',
                    opacity: (isMutating || isSelf) ? 0.4 : 1,
                  }}
                >
                  {isMutating && <span className="adminSpinner" aria-hidden="true" />}
                  <span>{activeActionUser.user_status === 'suspended' ? t('admin.users.confirmReactivation') : t('admin.users.confirmSuspension')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Resetar Senha */}
      {activeModalType === 'reset_password' && activeActionUser && (
        <div className="adminOverlay">
          <div
            className="adminOverlayMask"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={el => el?.focus()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isMutating) {
                e.stopPropagation()
                e.nativeEvent?.stopImmediatePropagation?.()
                closeModal()
              }
            }}
            className="adminDialog"
          >
            <div className="adminDialogHeader">
              <h3 className="adminDialogTitle">{t('admin.users.sendResetTitle')}</h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="adminDialogClose"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ color: 'var(--cm-muted-foreground)', margin: 0 }}>
                {t('admin.users.resetDescription')}
              </p>

              <div style={{ padding: '12px', borderRadius: 'var(--cm-radius-md)', border: '1px solid var(--cm-border)', background: 'var(--cm-background)' }}>
                <div style={{ color: 'var(--cm-muted-foreground)', fontSize: '11px' }}>{t('admin.users.recipient')}</div>
                <div style={{ color: 'var(--cm-foreground)', fontWeight: 500, marginTop: '2px', fontSize: '13px' }}>{activeActionUser.full_name || t('admin.common.noName')}</div>
                <div style={{ color: 'var(--cm-primary)', fontFamily: 'monospace', fontSize: '11px', marginTop: '2px' }}>{activeActionUser.email}</div>
              </div>

              {modalFeedback && (
                <div className={`adminNotice ${modalFeedback.type === 'success' ? 'adminNoticeSuccess' : 'adminNoticeError'}`}>
                  {modalFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="adminButton adminButtonSecondary"
                  style={{ flex: 1, opacity: isMutating ? 0.5 : 1 }}
                >
                  {t('admin.common.cancelAction')}
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={isMutating}
                  className="adminButton"
                  style={{ flex: 1, gap: '8px', opacity: isMutating ? 0.4 : 1 }}
                >
                  {isMutating && <span className="adminSpinner" aria-hidden="true" />}
                  <span>{t('admin.users.sendEmail')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
