import React, { useState, useEffect } from 'react'
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#E7BF73]"></div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto text-[#f0f6fc]">


      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Gestão de Tenants</h1>
          <p className="text-sm text-gray-400 mt-1">
            Controle de organizações cadastradas, planos ativos e estado de acesso.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 bg-[#E7BF73] hover:bg-[#D8AE5F] text-[#0f1115] font-semibold text-sm rounded-lg shadow-md transition-all duration-150 cursor-pointer"
        >
          Novo Tenant
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-950/60 border border-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-[#161b22] border border-[#30363d] shadow-xl overflow-hidden rounded-xl">
        <table className="min-w-full divide-y divide-[#30363d]">
          <thead className="bg-[#0d1117]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Slug
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Assinatura
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Criado Em
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="bg-[#161b22] divide-y divide-[#30363d]">
            {tenants.map(tenant => (
              <tr key={tenant.id} className="hover:bg-[#1f242c] transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-white">{tenant.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-xs text-gray-400 font-mono">{tenant.slug}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full border ${
                    tenant.status === 'active'
                      ? 'bg-emerald-950/70 border-emerald-700/50 text-emerald-300'
                      : tenant.status === 'suspended'
                        ? 'bg-amber-950/70 border-amber-700/50 text-amber-300'
                        : 'bg-rose-950/70 border-rose-700/50 text-rose-300'
                  }`}>
                    {tenant.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-xs text-gray-300 font-mono capitalize">
                    {tenant.subscription_status || 'trial'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">
                  {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {tenant.status === 'active' ? (
                    <button
                      onClick={() => handleSuspendTenant(tenant.id)}
                      className="text-amber-400 hover:text-amber-300 mr-3 cursor-pointer text-xs font-medium transition-colors"
                    >
                      Suspender
                    </button>
                  ) : (
                    <button
                      onClick={() => handleActivateTenant(tenant.id)}
                      className="text-emerald-400 hover:text-emerald-300 mr-3 cursor-pointer text-xs font-medium transition-colors"
                    >
                      Ativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
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
      <div className="relative p-6 border border-[#30363d] w-full max-w-md shadow-2xl rounded-xl bg-[#161b22] text-[#f0f6fc]">
        <div className="flex justify-between items-center mb-5 pb-3 border-b border-[#30363d]">
          <h3 className="text-lg font-bold text-white">Criar Novo Tenant</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Agência Alpha"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#E7BF73] focus:ring-1 focus:ring-[#E7BF73] transition-colors"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="ex: agencia-alpha"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-500 text-sm font-mono focus:outline-none focus:border-[#E7BF73] focus:ring-1 focus:ring-[#E7BF73] transition-colors"
              required
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#30363d] rounded-lg text-sm text-gray-300 hover:bg-[#21262d] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 bg-[#E7BF73] hover:bg-[#D8AE5F] text-[#0f1115] font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isCreating ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
