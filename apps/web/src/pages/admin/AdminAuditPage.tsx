import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase/client'

interface AuditLog {
  id: string
  tenant_id: string | null
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  old_value: unknown
  new_value: unknown
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

function AuditValueBlock({ label, value }: { label: string; value: unknown }) {
  const json = value === null || value === undefined ? '' : JSON.stringify(value, null, 2)
  if (!json) return null
  return (
    <div>
      <h4 className="font-semibold text-[#8b949e] mb-1 text-xs uppercase tracking-wider">{label}</h4>
      <pre className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg text-emerald-400 overflow-x-auto text-xs font-mono">{json}</pre>
    </div>
  )
}

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<string>('')
  const [resourceFilter, setResourceFilter] = useState<string>('')
  const [page, setPage] = useState(0)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const pageSize = 25

  useEffect(() => {
    loadAuditLogs()
  }, [actionFilter, page])

  async function loadAuditLogs() {
    try {
      setIsLoading(true)
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (actionFilter) {
        query = query.eq('action', actionFilter)
      }

      const { data, error } = await query
      if (error) throw error
      setLogs(data || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const kpis = useMemo(() => {
    const total = logs.length
    const create = logs.filter(l => l.action.toLowerCase().includes('create') || l.action.toLowerCase().includes('insert')).length
    const update = logs.filter(l => l.action.toLowerCase().includes('update')).length
    const del = logs.filter(l => l.action.toLowerCase().includes('delete') || l.action.toLowerCase().includes('archive')).length
    const auth = logs.filter(l => l.action.toLowerCase().includes('login') || l.action.toLowerCase().includes('auth')).length
    return { total, create, update, del, auth }
  }, [logs])

  const filteredLogs = useMemo(() => {
    if (!resourceFilter) return logs
    return logs.filter(l => (l.resource_type || '').toLowerCase().includes(resourceFilter.toLowerCase()))
  }, [logs, resourceFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', color: '#f0f6fc' }}>
      {/* Cabeçalho */}
      <div>
        <h3 className="text-sm font-semibold text-[#f0f6fc]">Trilha de Auditoria</h3>
        <p className="text-xs text-[#8b949e] mt-1">
          Registro imutável de mutações, operações de segurança e logs de sistema.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 rounded-lg text-xs">
          {error}
        </div>
      )}

      {/* Grid de KPIs no padrão Overview */}
      <div className="adminGrid">
        <div className="adminCard">
          <div className="adminCardLabel">Total de Eventos (Página)</div>
          <div className="adminCardValue">{kpis.total}</div>
          <div className="adminCardSub">Registros carregados</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Criações</div>
          <div className="adminCardValue text-emerald-400">{kpis.create}</div>
          <div className="adminCardSub">INSERT / CREATE</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Atualizações</div>
          <div className="adminCardValue text-blue-400">{kpis.update}</div>
          <div className="adminCardSub">UPDATE / MODIFY</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Exclusões / Arquivamentos</div>
          <div className="adminCardValue text-rose-400">{kpis.del}</div>
          <div className="adminCardSub">DELETE / ARCHIVE</div>
        </div>
        <div className="adminCard">
          <div className="adminCardLabel">Segurança / Auth</div>
          <div className="adminCardValue text-amber-400">{kpis.auth}</div>
          <div className="adminCardSub">Sessões e credenciais</div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={resourceFilter}
          onChange={e => setResourceFilter(e.target.value)}
          placeholder="Filtrar por recurso (ex: tenants, users)..."
          className="adminInput h-8 px-3 text-xs bg-[#0d1117] border border-[#30363d] rounded-md text-[#f0f6fc] placeholder-[#8b949e] focus:outline-none focus:border-[#E7BF73] min-w-[220px]"
        />
        <select
          value={actionFilter}
          onChange={e => {
            setActionFilter(e.target.value)
            setPage(0)
          }}
          className="adminInput h-8 px-3 text-xs bg-[#0d1117] border border-[#30363d] rounded-md text-[#f0f6fc] focus:outline-none focus:border-[#E7BF73]"
        >
          <option value="">Todas as Ações</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
          <option value="login">login</option>
        </select>
        {(actionFilter || resourceFilter) && (
          <button
            onClick={() => {
              setActionFilter('')
              setResourceFilter('')
              setPage(0)
            }}
            className="text-xs text-[#8b949e] hover:text-[#f0f6fc] px-2 py-1 underline cursor-pointer"
          >
            Limpar Filtros
          </button>
        )}
      </div>

      {/* Tabela envelopada em .adminCard */}
      <div className="adminCard" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="adminTable w-full text-left border-collapse text-xs">
          <thead className="bg-[#161b22] text-[#8b949e] uppercase font-semibold text-[11px] border-b border-[#30363d]">
            <tr>
              <th className="py-2.5 px-3">Data/Hora</th>
              <th className="py-2.5 px-3">Ação</th>
              <th className="py-2.5 px-3">Recurso</th>
              <th className="py-2.5 px-3">ID Recurso</th>
              <th className="py-2.5 px-3">IP</th>
              <th className="py-2.5 px-3 text-right">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[#8b949e]">
                  Carregando trilha de auditoria...
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[#8b949e]">
                  Nenhum log encontrado.
                </td>
              </tr>
            ) : (
              filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-[#1f242c] transition-colors">
                  <td className="py-2.5 px-3 text-[#8b949e] font-mono text-[11px]">
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 inline-flex text-[10px] font-semibold rounded bg-[#21262d] text-[#c9d1d9] border border-[#30363d]">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[#f0f6fc] font-medium">{log.resource_type || '-'}</td>
                  <td className="py-2.5 px-3 text-[#8b949e] font-mono text-[11px]">{log.resource_id ? log.resource_id.slice(0, 8) + '...' : '-'}</td>
                  <td className="py-2.5 px-3 text-[#8b949e] font-mono text-[11px]">{log.ip_address || '-'}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-[#E7BF73] hover:text-[#D8AE5F] text-xs font-medium cursor-pointer"
                    >
                      Ver Payload
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Paginação */}
        <div className="flex justify-between items-center p-3 border-t border-[#30363d] bg-[#161b22] text-xs text-[#8b949e]">
          <div>Página {page + 1}</div>
          <div className="space-x-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}
              className="px-2.5 py-1 border border-[#30363d] rounded text-xs text-[#c9d1d9] disabled:opacity-40 hover:bg-[#21262d] cursor-pointer"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={logs.length < pageSize || isLoading}
              className="px-2.5 py-1 border border-[#30363d] rounded text-xs text-[#c9d1d9] disabled:opacity-40 hover:bg-[#21262d] cursor-pointer"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Detalhes do Log */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="relative p-6 border border-[#30363d] w-full max-w-2xl shadow-2xl rounded-xl bg-[#161b22] text-[#f0f6fc] max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-[#30363d]">
              <h3 className="text-sm font-semibold text-white">
                Log de Auditoria: <span className="text-[#E7BF73] font-mono">{selectedLog.action}</span>
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-[#8b949e] hover:text-white text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[#8b949e]">Recurso:</span> {selectedLog.resource_type || '-'}
              </div>
              <div>
                <span className="text-[#8b949e]">ID Recurso:</span>{' '}
                <span className="font-mono text-[11px]">{selectedLog.resource_id || '-'}</span>
              </div>
              <div>
                <span className="text-[#8b949e]">Usuário:</span>{' '}
                <span className="font-mono text-[11px]">{selectedLog.user_id || 'Anônimo / Sistema'}</span>
              </div>
              <div>
                <span className="text-[#8b949e]">Data/Hora:</span>{' '}
                {new Date(selectedLog.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <AuditValueBlock label="Valor Anterior (Old)" value={selectedLog.old_value} />
              <AuditValueBlock label="Novo Valor (New)" value={selectedLog.new_value} />
            </div>
            <div className="flex justify-end pt-3 border-t border-[#30363d]">
              <button
                onClick={() => setSelectedLog(null)}
                className="h-8 px-4 bg-[#21262d] border border-[#30363d] rounded text-xs text-[#c9d1d9] hover:text-white cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
