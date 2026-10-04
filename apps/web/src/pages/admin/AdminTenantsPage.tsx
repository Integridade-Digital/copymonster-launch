import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase/client'

interface Tenant {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended' | 'deleted'
  created_at: string
  subscription_status?: string
}

export function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')

  useEffect(() => {
    loadTenants()
  }, [])

  async function loadTenants() {
    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setTenants(data || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSuspendTenant(tenantId: string) {
    if (!confirm('Tem certeza que deseja suspender este tenant?')) return

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: 'suspended' })
        .eq('id', tenantId)

      if (error) throw error
      loadTenants()
    } catch (err: unknown) {
      alert('Erro ao suspender tenant: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function handleActivateTenant(tenantId: string) {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: 'active' })
        .eq('id', tenantId)

      if (error) throw error
      loadTenants()
    } catch (err: unknown) {
      alert('Erro ao ativar tenant: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const kpis = useMemo(() => {
    const total = tenants.length
    const active = tenants.filter(t => t.status === 'active').length
    const suspended = tenants.filter(t => t.status === 'suspended').length
    const trial = tenants.filter(t => (t.subscription_status || 'trial').toLowerCase().includes('trial')).length
    return { total, active, suspended, trial }
  }, [tenants])

  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      const matchesSearch =
        !searchTerm ||
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.slug.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [tenants, searchTerm, statusFilter])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--cm-primary)]"></div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', color: 'var(--cm-foreground)' }}>
      {/* Cabeçalho da Seção */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-sm font-semibold text-[var(--cm-foreground)]">Gestão de Tenants</h3>
          <p className="text-xs text-[var(--cm-muted-foreground)] mt-1">
            Organizações registradas, planos ativos e controle de status de acesso.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="adminButton inline-flex items-center justify-center h-8 px-4 bg-[var(--cm-primary)] hover:bg-[var(--cm-primary)] text-[var(--cm-primary-foreground)] font-semibold text-xs rounded-md shadow-sm transition-colors cursor-pointer"
        >
          Novo Tenant
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 rounded-lg text-xs">
          {error}
        </div>
      )}

      {/* Grid de KPIs no padrão Overview */}
      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">Total de Tenants</div>
          <div className="adminCardValue">{kpis.total}</div>
          <div className="adminCardSub">Cadastrados</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Ativos</div>
          <div className="adminCardValue text-emerald-400">{kpis.active}</div>
          <div className="adminCardSub">Operação normal</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Suspensos</div>
          <div className="adminCardValue text-amber-400">{kpis.suspended}</div>
          <div className="adminCardSub">Acesso bloqueado</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Em Trial</div>
          <div className="adminCardValue text-blue-400">{kpis.trial}</div>
          <div className="adminCardSub">Período de testes</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar tenant por nome ou slug..."
          className="adminInput h-8 px-3 text-xs bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-md text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)] focus:outline-none focus:border-[var(--cm-primary)] min-w-[240px]"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="adminInput h-8 px-3 text-xs bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-md text-[var(--cm-foreground)] focus:outline-none focus:border-[var(--cm-primary)]"
        >
          <option value="all">Todos os Status</option>
          <option value="active">Apenas Ativos</option>
          <option value="suspended">Apenas Suspensos</option>
        </select>
        {(searchTerm || statusFilter !== 'all') && (
          <button
            onClick={() => {
              setSearchTerm('')
              setStatusFilter('all')
            }}
            className="text-xs text-[var(--cm-muted-foreground)] hover:text-[var(--cm-foreground)] px-2 py-1 underline cursor-pointer"
          >
            Limpar Filtros
          </button>
        )}
      </div>

      {/* Tabela envelopada em .adminCard */}
      <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="adminTable w-full text-left border-collapse text-xs">
          <thead className="bg-[var(--cm-card)] text-[var(--cm-muted-foreground)] uppercase font-semibold text-[11px] border-b border-[var(--cm-border)]">
            <tr>
              <th className="py-2.5 px-3">Nome</th>
              <th className="py-2.5 px-3">Slug</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Assinatura</th>
              <th className="py-2.5 px-3">Criado Em</th>
              <th className="py-2.5 px-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cm-border)]">
            {filteredTenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[var(--cm-muted-foreground)]">
                  Nenhum tenant encontrado.
                </td>
              </tr>
            ) : (
              filteredTenants.map(tenant => (
                <tr key={tenant.id} className="hover:bg-[var(--cm-muted)] transition-colors">
                  <td className="py-2.5 px-3 font-medium text-[var(--cm-foreground)]">{tenant.name}</td>
                  <td className="py-2.5 px-3 text-[var(--cm-muted-foreground)] font-mono text-[11px]">{tenant.slug}</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 inline-flex text-[10px] font-semibold rounded border ${
                      tenant.status === 'active'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : tenant.status === 'suspended'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    }`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[var(--cm-foreground)] font-mono text-[11px] capitalize">
                    {tenant.subscription_status || 'trial'}
                  </td>
                  <td className="py-2.5 px-3 text-[var(--cm-muted-foreground)] text-[11px]">
                    {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {tenant.status === 'active' ? (
                      <button
                        onClick={() => handleSuspendTenant(tenant.id)}
                        className="text-amber-400 hover:text-amber-300 text-xs font-medium cursor-pointer"
                      >
                        Suspender
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivateTenant(tenant.id)}
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium cursor-pointer"
                      >
                        Ativar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <CreateTenantModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            loadTenants()
          }}
        />
      )}
    </div>
  )
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsCreating(true)

    try {
      const { error } = await supabase.from('tenants').insert([{ name, slug }])
      if (error) throw error
      onCreated()
    } catch (err: unknown) {
      alert('Erro ao criar tenant: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="relative p-6 border border-[var(--cm-border)] w-full max-w-md shadow-2xl rounded-xl bg-[var(--cm-card)] text-[var(--cm-foreground)]">
        <div className="flex justify-between items-center mb-5 pb-3 border-b border-[var(--cm-border)]">
          <h3 className="text-sm font-semibold text-white">Criar Novo Tenant</h3>
          <button
            onClick={onClose}
            className="text-[var(--cm-muted-foreground)] hover:text-white text-lg font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--cm-muted-foreground)] mb-1.5">Nome</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Agência Alpha"
              className="adminInput w-full h-8 px-3 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-md text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)] text-xs focus:outline-none focus:border-[var(--cm-primary)]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--cm-muted-foreground)] mb-1.5">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="ex: agencia-alpha"
              className="adminInput w-full h-8 px-3 bg-[var(--cm-background)] border border-[var(--cm-border)] rounded-md text-[var(--cm-foreground)] placeholder-[var(--cm-muted-foreground)] text-xs font-mono focus:outline-none focus:border-[var(--cm-primary)]"
              required
            />
          </div>
          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 border border-[var(--cm-border)] rounded-md text-xs text-[var(--cm-muted-foreground)] hover:text-white hover:bg-[var(--cm-secondary)] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="h-8 px-4 bg-[var(--cm-primary)] hover:bg-[var(--cm-primary)] text-[var(--cm-primary-foreground)] font-semibold text-xs rounded-md disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isCreating ? 'Criando...' : 'Criar Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
