import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase/client'

interface AdminUserRow {
  membership_id: string | null
  user_id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  last_login_at: string | null
  user_status: 'active' | 'suspended'
  tenant_id: string | null
  tenant_name: string
  tenant_slug: string | null
  role: string
  total_count: number
}

interface TenantOption {
  id: string
  name: string
}

interface UserKPIs {
  total: number
  active: number
  suspended: number
}

export function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [kpis, setKpis] = useState<UserKPIs>({ total: 0, active: 0, suspended: 0 })
  const [totalCount, setTotalCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [selectedTenant, setSelectedTenant] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')

  const [pageSize, setPageSize] = useState<number>(25)
  const [currentPage, setCurrentPage] = useState<number>(1)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
      setCurrentPage(1)
    }, 350)
    return () => clearTimeout(handler)
  }, [searchTerm])

  const loadTenants = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name')
        .order('name', { ascending: true })

      if (!error && data) {
        setTenants(data as TenantOption[])
      }
    } catch {
      // silencioso
    }
  }, [])

  const loadKPIs = useCallback(async () => {
    try {
      const { data, error: rpcError } = await (supabase.rpc as any)('get_admin_users_kpis')
      if (!rpcError && data) {
        const row = data[0]
        setKpis({
          total: Number(row?.total_users ?? 0),
          active: Number(row?.active_users ?? 0),
          suspended: Number(row?.suspended_users ?? 0),
        })
      }
    } catch {
      // silencioso
    }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const offset = (currentPage - 1) * pageSize
      const params = {
        p_search: debouncedSearch.length > 0 ? debouncedSearch : null,
        p_role: selectedRole.length > 0 ? selectedRole : null,
        p_tenant_id: selectedTenant.length > 0 ? selectedTenant : null,
        p_status: selectedStatus.length > 0 ? selectedStatus : null,
        p_limit: pageSize,
        p_offset: offset,
      }

      const { data, error: rpcError } = await (supabase.rpc as any)('get_admin_users', params)

      if (rpcError) throw rpcError

      const rows: AdminUserRow[] = (data || []).map((r: any) => ({
        ...r,
        total_count: Number(r.total_count ?? 0),
      }))

      setUsers(rows)
      setTotalCount(rows[0]?.total_count ?? 0)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [currentPage, pageSize, debouncedSearch, selectedRole, selectedTenant, selectedStatus])

  useEffect(() => {
    loadTenants()
    loadKPIs()
  }, [loadTenants, loadKPIs])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalCount / pageSize))
  }, [totalCount, pageSize])

  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedRole('')
    setSelectedTenant('')
    setSelectedStatus('')
    setCurrentPage(1)
  }

  const hasActiveFilters = searchTerm !== '' || selectedRole !== '' || selectedTenant !== '' || selectedStatus !== ''

  const getInitials = (name: string | null, email: string) => {
    if (name && name.trim().length > 0) {
      const parts = name.trim().split(' ')
      const p0 = parts[0]
      const p1 = parts[1]
      if (p0 && p1 && p0[0] && p1[0]) {
        return (p0[0] + p1[0]).toUpperCase()
      }
      return name.slice(0, 2).toUpperCase()
    }
    return email.slice(0, 2).toUpperCase()
  }

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return isoString
    }
  }

  return (
    <div className="space-y-6 text-[#f0f6fc]">
      {/* Header & Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#f0f6fc]">Gestão de Usuários</h2>
          <p className="text-xs text-[#8b949e] mt-1">
            Administração global de contas, papéis e acessos vinculados aos tenants.
          </p>
        </div>

        <button
          onClick={() => {
            loadKPIs()
            loadUsers()
          }}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[#e7bf73]/30 bg-[#161b22] hover:bg-[#e7bf73]/10 text-[#f0f6fc] transition disabled:opacity-50 self-start sm:self-auto"
        >
          <svg
            className={`w-3.5 h-3.5 text-[#e7bf73] ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Atualizar
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <span className="text-xs font-medium text-[#8b949e]">Total de Usuários</span>
          <div className="mt-2 text-2xl font-bold text-[#f0f6fc]">{kpis.total}</div>
        </div>

        <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <span className="text-xs font-medium text-emerald-400">Usuários Ativos</span>
          <div className="mt-2 text-2xl font-bold text-emerald-400">{kpis.active}</div>
        </div>

        <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/70">
          <span className="text-xs font-medium text-rose-400">Usuários Suspensos</span>
          <div className="mt-2 text-2xl font-bold text-rose-400">{kpis.suspended}</div>
        </div>
      </div>

      {/* Filtros e Busca */}
      <div className="p-4 rounded-xl border border-[#30363d] bg-[#161b22]/50 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, email ou tenant..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] placeholder-[#8b949e] focus:outline-none focus:border-[#e7bf73] transition"
            />
            <svg
              className="w-4 h-4 text-[#8b949e] absolute left-2.5 top-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <div>
            <select
              value={selectedRole}
              onChange={(e) => {
                setSelectedRole(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">Todos os Papéis</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </div>

          <div>
            <select
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">Todos os Tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value)
                setCurrentPage(1)
              }}
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition"
            >
              <option value="">Todos os Status</option>
              <option value="active">Ativo</option>
              <option value="suspended">Suspenso</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#30363d]/50 text-[#8b949e] hover:text-[#f0f6fc] transition"
                title="Limpar todos os filtros"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="font-semibold">Erro ao carregar usuários:</span> {error}
          </div>
          <button
            onClick={() => loadUsers()}
            className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 rounded-md transition text-xs font-medium self-start"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="border border-[#30363d] rounded-xl bg-[#161b22]/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0d1117]/80 text-[#8b949e] uppercase font-medium border-b border-[#30363d]">
              <tr>
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">Tenant</th>
                <th className="py-3 px-4">Papel (Role)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Data Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]/50">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#8b949e]">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-6 h-6 rounded-full border-2 border-[#e7bf73] border-t-transparent animate-spin" />
                      <span>Carregando usuários...</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#8b949e]">
                    {hasActiveFilters ? (
                      <div className="space-y-2">
                        <p className="text-[#f0f6fc]">Nenhum usuário corresponde aos filtros aplicados.</p>
                        <button
                          onClick={handleClearFilters}
                          className="text-xs text-[#e7bf73] hover:underline"
                        >
                          Limpar filtros
                        </button>
                      </div>
                    ) : (
                      <p>Nenhum usuário cadastrado no sistema.</p>
                    )}
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const rowKey = user.membership_id ?? `${user.user_id}-${user.tenant_id ?? 'root'}`
                  return (
                    <tr key={rowKey} className="hover:bg-[#161b22] transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {user.avatar_url ? (
                            <img
                              src={user.avatar_url}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover border border-[#30363d]"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#e7bf73]/15 border border-[#e7bf73]/30 text-[#e7bf73] flex items-center justify-center font-bold text-xs">
                              {getInitials(user.full_name, user.email)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-[#f0f6fc] truncate">
                              {user.full_name || 'Sem nome'}
                            </div>
                            <div className="text-[11px] text-[#8b949e] truncate">
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-[#f0f6fc]">
                        <span className="truncate block max-w-[180px] font-medium" title={user.tenant_name}>
                          {user.tenant_name}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {user.role === 'owner' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-[#e7bf73]/15 text-[#e7bf73] border border-[#e7bf73]/30">
                            Owner
                          </span>
                        )}
                        {user.role === 'admin' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            Admin
                          </span>
                        )}
                        {user.role === 'member' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#30363d]/50 text-[#8b949e] border border-[#30363d]">
                            Member
                          </span>
                        )}
                        {user.role !== 'owner' && user.role !== 'admin' && user.role !== 'member' && (
                          <span className="text-[#8b949e]">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {user.user_status === 'suspended' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                            Suspenso
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Ativo
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-[#8b949e]">
                        {formatDate(user.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-[#0d1117]/60 border-t border-[#30363d] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#8b949e]">
          <div className="flex items-center gap-2">
            <span>Linhas por página:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-2 py-1 rounded border border-[#30363d] bg-[#161b22] text-[#f0f6fc] focus:outline-none focus:border-[#e7bf73] transition text-xs"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="ml-2">
              Mostrando {users.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} a{' '}
              {Math.min(currentPage * pageSize, totalCount)} de {totalCount} vínculos
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1 || isLoading}
              className="px-2.5 py-1 rounded border border-[#30363d] bg-[#161b22] text-[#f0f6fc] hover:bg-[#30363d]/50 disabled:opacity-40 transition text-xs font-medium"
            >
              Anterior
            </button>
            <span>
              Página {currentPage} de {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isLoading}
              className="px-2.5 py-1 rounded border border-[#30363d] bg-[#161b22] text-[#f0f6fc] hover:bg-[#30363d]/50 disabled:opacity-40 transition text-xs font-medium"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
