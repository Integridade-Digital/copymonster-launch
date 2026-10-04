import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase/client'

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
    supabase.auth.getUser().then(({ data }: any) => {
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
      const { data, error } = await (supabase.rpc as any)('get_admin_users_kpis')
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
      const params: Record<string, unknown> = {
        p_limit: pageSize,
        p_offset: offset,
      }

      if (debouncedSearch) {
        params.p_search = debouncedSearch
      }
      if (selectedRole) {
        params.p_role = selectedRole
      }
      if (selectedStatus) {
        params.p_status = selectedStatus
      }
      if (selectedTenant) {
        params.p_tenant_id = selectedTenant
      }

      const { data, error: rpcError } = await (supabase.rpc as any)('get_admin_users', params)

      if (rpcError) throw rpcError

      const list: AdminUserRow[] = (data || []).map((row: any) => ({
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
      const count = data && data.length > 0 ? Number(data[0].total_count ?? 0) : 0
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
      const { error: rpcError } = await (supabase.rpc as any)('admin_update_user_role', {
        p_membership_id: activeActionUser.membership_id,
        p_new_role: selectedNewRole,
      })

      if (rpcError) throw rpcError

      setModalFeedback({ type: 'success', message: 'Papel do usuário atualizado com sucesso!' })
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
      const { error: rpcError } = await (supabase.rpc as any)('admin_toggle_user_status', {
        p_user_id: activeActionUser.user_id,
        p_new_status: nextStatus,
      })

      if (rpcError) throw rpcError

      setModalFeedback({
        type: 'success',
        message: nextStatus === 'suspended' ? 'Usuário suspenso com sucesso!' : 'Usuário reativado com sucesso!',
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
        message: `Instruções de redefinição de senha enviadas para ${activeActionUser.email}.`,
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
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', color: 'var(--cm-foreground)' }}>
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--cm-border)]">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--cm-foreground)] flex items-center gap-2">
            <span>Users & Members</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--cm-primary)]/20 text-[var(--cm-primary)] border border-[var(--cm-primary)]/30">
              {totalCount} total
            </span>
          </h2>
          <p className="text-sm text-[var(--cm-muted-foreground)] mt-1">
            Gestão de identidades, papéis (roles) e status de acesso nos tenants da plataforma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              loadUsers()
              loadKPIs()
            }}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-xs font-medium text-[var(--cm-foreground)] transition flex items-center gap-1.5 disabled:opacity-50"
            title="Atualizar lista"
          >
            <svg width="14" height="14"
              className={`w-3.5 h-3.5 text-[var(--cm-muted-foreground)] ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas / KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium">Total de Users</div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{kpis ? kpis.total : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-primary)]" />
            <span>Owners</span>
          </div>
          <div className="text-xl font-bold text-[var(--cm-primary)] mt-1">{kpis ? kpis.owners : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-primary)]" />
            <span>Admins</span>
          </div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{kpis ? kpis.admins : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--cm-muted-foreground)]" />
            <span>Members</span>
          </div>
          <div className="text-xl font-bold text-[var(--cm-foreground)] mt-1">{kpis ? kpis.members : '-'}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/70 col-span-2 sm:col-span-1">
          <div className="text-xs text-[var(--cm-muted-foreground)] font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Suspensos</span>
          </div>
          <div className="text-xl font-bold text-rose-400 mt-1">{kpis ? kpis.suspended : '-'}</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="p-4 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-card)]/40 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Busca por texto */}
          <div className="sm:col-span-5 relative">
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search by e-mail ou nome..."
              className="w-full px-3 py-2 pl-9 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            />
            <svg width="14" height="14"
              className="w-4 h-4 text-[var(--cm-muted-foreground)] absolute left-2.5 top-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Filtro Role */}
          <div className="sm:col-span-2">
            <select
              value={selectedRole}
              onChange={(e) => {
                setSelectedRole(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="">Todas as Roles</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </div>

          {/* Filtro Status */}
          <div className="sm:col-span-2">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition"
            >
              <option value="">Todos Status</option>
              <option value="active">Ativo</option>
              <option value="suspended">Suspenso</option>
            </select>
          </div>

          {/* Filtro Tenant */}
          <div className="sm:col-span-3">
            <select
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)] transition truncate"
            >
              <option value="">Todos os Tenants</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-[var(--cm-muted-foreground)]">Filtros ativos aplicados</span>
            <button
              onClick={handleClearFilters}
              className="text-[var(--cm-primary)] hover:text-[var(--cm-primary)] underline transition"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>

      {/* Estado de Error */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadUsers()}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 transition"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Tabela de Users */}
      <div className="border border-[var(--cm-border)] rounded-xl overflow-hidden bg-[var(--cm-background)]/60">
        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--cm-border)] bg-[var(--cm-card)]/90 text-[var(--cm-muted-foreground)] uppercase font-semibold tracking-wider">
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">Tenant</th>
                <th className="py-3 px-4">Papel (Role)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Data Cadastro</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cm-border)]/50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[var(--cm-muted-foreground)]">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-6 h-6 rounded-full border-2 border-[var(--cm-primary)] border-t-transparent animate-spin" />
                      <span>Carregando usuários...</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[var(--cm-muted-foreground)]">
                    {hasActiveFilters ? (
                      <div className="space-y-2">
                        <p className="text-[var(--cm-foreground)]">Nenhum usuário corresponde aos filtros aplicados.</p>
                        <button
                          onClick={handleClearFilters}
                          className="text-[var(--cm-primary)] hover:text-[var(--cm-primary)] underline transition"
                        >
                          Limpar filtros
                        </button>
                      </div>
                    ) : (
                      <span>Nenhum usuário cadastrado.</span>
                    )}
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const rowKey = user.membership_id ?? `${user.user_id}-${user.tenant_id ?? 'root'}`
                  const isMenuOpen = actionMenuOpenRow === rowKey

                  return (
                    <tr key={rowKey} className="hover:bg-[var(--cm-card)] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-[var(--cm-foreground)]">{user.full_name || 'Sem nome'}</div>
                        <div className="text-[var(--cm-muted-foreground)] font-mono text-[11px]">{user.email}</div>
                      </td>

                      <td className="py-3 px-4">
                        {user.tenant_name ? (
                          <div>
                            <span className="text-[var(--cm-foreground)] font-medium">{user.tenant_name}</span>
                            {user.tenant_slug && (
                              <span className="text-[10px] text-[var(--cm-muted-foreground)] block font-mono">
                                /{user.tenant_slug}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--cm-muted-foreground)] italic">Sem tenant</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {user.role ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium uppercase border ${
                              user.role === 'owner'
                                ? 'bg-[var(--cm-primary)]/15 text-[var(--cm-primary)] border-[var(--cm-primary)]/30'
                                : user.role === 'admin'
                                  ? 'bg-[var(--cm-primary)]/15 text-[var(--cm-primary)] border-[var(--cm-primary)]/30'
                                  : 'bg-[var(--cm-secondary)]/50 text-[var(--cm-muted-foreground)] border-[var(--cm-border)]'
                            }`}
                          >
                            {user.role}
                          </span>
                        ) : (
                          <span className="text-[var(--cm-muted-foreground)]">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            user.user_status === 'suspended'
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              user.user_status === 'suspended' ? 'bg-rose-400' : 'bg-emerald-400'
                            }`}
                          />
                          <span>{user.user_status === 'suspended' ? 'Suspenso' : 'Ativo'}</span>
                        </span>
                      </td>

                      <td className="py-3 px-4 text-[var(--cm-muted-foreground)]">
                        {formatDate(user.created_at)}
                      </td>

                      <td className="py-3 px-4 text-right relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActionMenuOpenRow(isMenuOpen ? null : rowKey)
                          }}
                          className="p-1.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/60 text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition"
                          title="Actions do usuário"
                        >
                          <svg width="14" height="14" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            className="absolute right-4 mt-1 w-44 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] shadow-2xl z-30 py-1 text-left text-xs text-[var(--cm-foreground)]"
                          >
                            <button
                              onClick={() => {
                                setActionMenuOpenRow(null)
                                openRoleModal(user)
                              }}
                              disabled={!user.membership_id}
                              className="w-full px-3 py-2 hover:bg-[var(--cm-secondary)]/40 flex items-center gap-2 text-left transition disabled:opacity-40"
                            >
                              <svg width="14" height="14" className="w-3.5 h-3.5 text-[var(--cm-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span>Alterar Role</span>
                            </button>

                            <button
                              onClick={() => {
                                setActionMenuOpenRow(null)
                                openStatusModal(user)
                              }}
                              className={`w-full px-3 py-2 hover:bg-[var(--cm-secondary)]/40 flex items-center gap-2 text-left transition ${
                                user.user_status === 'suspended' ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {user.user_status === 'suspended' ? (
                                <>
                                  <svg width="14" height="14" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span>Reativar Conta</span>
                                </>
                              ) : (
                                <>
                                  <svg width="14" height="14" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                  </svg>
                                  <span>Suspender Conta</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => {
                                setActionMenuOpenRow(null)
                                openResetPasswordModal(user)
                              }}
                              className="w-full px-3 py-2 hover:bg-[var(--cm-secondary)]/40 flex items-center gap-2 text-left transition text-[var(--cm-foreground)]"
                            >
                              <svg width="14" height="14" className="w-3.5 h-3.5 text-[var(--cm-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                              </svg>
                              <span>Resetar Senha</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="p-4 border-t border-[var(--cm-border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-[var(--cm-card)]/30">
          <div className="flex items-center gap-2 text-[var(--cm-muted-foreground)]">
            <span>Exibindo</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-2 py-1 rounded border border-[var(--cm-border)] bg-[var(--cm-background)] text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)]"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>de {totalCount} registros</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[var(--cm-muted-foreground)]">
              Página {currentPage} de {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage <= 1 || isLoading}
                className="px-2.5 py-1 rounded border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-[var(--cm-foreground)] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Anterior
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage >= totalPages || isLoading}
                className="px-2.5 py-1 rounded border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-[var(--cm-foreground)] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================== */}
      {/* MODAIS NO PADRÃO SETTINGS (Estado Local + Fixed Overlay + Escape + X)   */}
      {/* ====================================================================== */}

      {/* Modal 1: Alterar Role (Role) */}
      {activeModalType === 'role' && activeActionUser && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--cm-background)]/80 backdrop-blur-sm" onClick={closeModal} />
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
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--cm-primary)]/25 bg-[var(--cm-card)] p-6 shadow-2xl space-y-5 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--cm-border)]">
              <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">Alterar Role de Usuário</h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] p-1 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-[var(--cm-muted-foreground)] block mb-1">Usuário:</span>
                <div className="p-2.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)]">
                  <div className="text-[var(--cm-foreground)] font-medium">{activeActionUser.full_name || 'Sem nome'}</div>
                  <div className="text-[var(--cm-muted-foreground)] font-mono text-[11px]">{activeActionUser.email}</div>
                </div>
              </div>

              <div>
                <span className="text-[var(--cm-muted-foreground)] block mb-1">Tenant vinculado:</span>
                <div className="text-[var(--cm-foreground)] font-medium p-2.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)]">
                  {activeActionUser.tenant_name || 'Nenhum'}
                </div>
              </div>

              <div>
                <label className="text-[var(--cm-muted-foreground)] block mb-1">Selecione o novo papel:</label>
                <select
                  value={selectedNewRole}
                  onChange={e => setSelectedNewRole(e.target.value as 'owner' | 'admin' | 'member')}
                  disabled={isMutating}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] text-xs text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)]"
                >
                  {(['owner', 'admin', 'member'] as const).map((r) => {
                    const isCurrent = activeActionUser.role === r
                    const isOptionDisabled = (isSelf && r !== activeActionUser.role) || (isLastOwner && r !== 'owner')

                    return (
                      <option key={r} value={r} disabled={isOptionDisabled}>
                        {r.toUpperCase()} {isCurrent ? '(atual)' : ''}
                        {isSelf && !isCurrent ? ' - Não permitido alterar própria função' : ''}
                        {isLastOwner && !isCurrent ? ' - Único owner' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {isSelf && (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px]">
                  ⚠️ Segurança: Você não pode alterar sua própria função de acesso.
                </div>
              )}

              {isLastOwner && selectedNewRole !== 'owner' && (
                <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-[11px]">
                  ⛔ Não é permitido rebaixar o único proprietário (owner) deste tenant.
                </div>
              )}

              {modalFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    modalFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {modalFeedback.message}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateRole}
                  disabled={
                    isMutating ||
                    selectedNewRole === activeActionUser.role ||
                    (isSelf && selectedNewRole !== activeActionUser.role) ||
                    (isLastOwner && selectedNewRole !== 'owner')
                  }
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[var(--cm-primary)]/30 bg-[var(--cm-primary)] hover:bg-[var(--cm-primary)] text-[var(--cm-primary-foreground)] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMutating && <div className="w-3.5 h-3.5 border-2 border-[var(--cm-primary-foreground)] border-t-transparent rounded-full animate-spin" />}
                  <span>Salvar Alteração</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Suspender / Reativar Conta */}
      {activeModalType === 'status' && activeActionUser && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--cm-background)]/80 backdrop-blur-sm" onClick={closeModal} />
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
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--cm-primary)]/25 bg-[var(--cm-card)] p-6 shadow-2xl space-y-5 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--cm-border)]">
              <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">
                {activeActionUser.user_status === 'suspended' ? 'Reativar Usuário' : 'Suspender Usuário'}
              </h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] p-1 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-[var(--cm-muted-foreground)]">
                {activeActionUser.user_status === 'suspended' ? (
                  <>Tem certeza de que deseja restabelecer o acesso à plataforma para o usuário abaixo?</>
                ) : (
                  <>
                    Tem certeza de que deseja suspender a conta deste usuário? Ele ficará temporariamente
                    impedido de acessar a plataforma.
                  </>
                )}
              </p>

              <div className="p-3 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)] space-y-1">
                <div className="text-[var(--cm-foreground)] font-medium">{activeActionUser.full_name || 'Sem nome'}</div>
                <div className="text-[var(--cm-muted-foreground)] font-mono text-[11px]">{activeActionUser.email}</div>
                <div className="text-[11px] pt-1">
                  Status atual:{' '}
                  <span className={activeActionUser.user_status === 'suspended' ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                    {activeActionUser.user_status === 'suspended' ? 'Suspenso' : 'Ativo'}
                  </span>
                </div>
              </div>

              {isSelf && (
                <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-[11px]">
                  ⛔ Segurança: Você não pode suspender sua própria conta.
                </div>
              )}

              {modalFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    modalFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {modalFeedback.message}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggleStatus}
                  disabled={isMutating || isSelf}
                  className={`w-1/2 px-4 py-2.5 rounded-lg font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                    activeActionUser.user_status === 'suspended'
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-[var(--cm-primary-foreground)]'
                      : 'bg-rose-500 hover:bg-rose-600 text-white'
                  }`}
                >
                  {isMutating && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                  <span>{activeActionUser.user_status === 'suspended' ? 'Confirm Reativação' : 'Confirm Suspensão'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Resetar Senha */}
      {activeModalType === 'reset_password' && activeActionUser && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--cm-background)]/80 backdrop-blur-sm" onClick={closeModal} />
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
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--cm-primary)]/25 bg-[var(--cm-card)] p-6 shadow-2xl space-y-5 focus:outline-none"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--cm-border)]">
              <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">Enviar Reset de Senha</h3>
              <button
                onClick={closeModal}
                disabled={isMutating}
                className="text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] p-1 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-[var(--cm-muted-foreground)]">
                Um e-mail de redefinição de senha seguro será enviado diretamente ao endereço do usuário cadastrado no Supabase Auth.
              </p>

              <div className="p-3 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-background)]">
                <div className="text-[var(--cm-muted-foreground)] text-[11px]">Destinatário:</div>
                <div className="text-[var(--cm-foreground)] font-medium mt-0.5">{activeActionUser.full_name || 'Sem nome'}</div>
                <div className="text-[var(--cm-primary)] font-mono text-[11px] mt-0.5">{activeActionUser.email}</div>
              </div>

              {modalFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    modalFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {modalFeedback.message}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={closeModal}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-card)] hover:bg-[var(--cm-secondary)]/50 text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] transition font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={isMutating}
                  className="w-1/2 px-4 py-2.5 rounded-lg border border-[var(--cm-primary)]/30 bg-[var(--cm-primary)] hover:bg-[var(--cm-primary)] text-[var(--cm-primary-foreground)] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMutating && <div className="w-3.5 h-3.5 border-2 border-[var(--cm-primary-foreground)] border-t-transparent rounded-full animate-spin" />}
                  <span>Enviar E-mail</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
