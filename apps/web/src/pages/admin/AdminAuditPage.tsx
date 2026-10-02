import { useState, useEffect } from 'react'
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

/** Render one audit payload as indented JSON, or nothing when the column is empty. */
function AuditValueBlock({ label, value }: { label: string; value: unknown }) {
  const json = value === null || value === undefined ? '' : JSON.stringify(value, null, 2)
  if (!json) return null
  return (
    <div>
      <h4 className="font-semibold text-gray-300 mb-1.5 text-xs uppercase tracking-wider">{label}</h4>
      <pre className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg text-emerald-400 overflow-x-auto text-xs font-mono">{json}</pre>
    </div>
  )
}

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<string>('')
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

      if (actionFilter.trim()) {
        query = query.ilike('action', `%${actionFilter.trim()}%`)
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

  function getActionBadgeClass(action: string) {
    const act = action.toUpperCase()
    if (act.includes('DELETE') || act.includes('REMOVE') || act.includes('SUSPEND')) {
      return 'bg-rose-950/70 border border-rose-700/50 text-rose-300'
    }
    if (act.includes('CREATE') || act.includes('INSERT') || act.includes('ACTIVATE')) {
      return 'bg-emerald-950/70 border border-emerald-700/50 text-emerald-300'
    }
    if (act.includes('UPDATE') || act.includes('CHANGE')) {
      return 'bg-amber-950/70 border border-amber-700/50 text-amber-300'
    }
    return 'bg-indigo-950/70 border border-indigo-700/50 text-indigo-300'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto text-[#f0f6fc]">


      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Audit Logs</h1>
          <p className="text-sm text-gray-400 mt-1">
            Rastreamento de operações administrativas, eventos de segurança e alterações de estado.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filtrar por ação (ex: CREATE)..."
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value)
              setPage(0)
            }}
            className="px-3.5 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-white placeholder-gray-500 shadow-sm focus:outline-none focus:border-[#E7BF73] focus:ring-1 focus:ring-[#E7BF73] transition-colors"
          />
          <button
            onClick={() => loadAuditLogs()}
            className="px-4 py-2 bg-[#21262d] text-gray-200 border border-[#30363d] rounded-lg hover:bg-[#30363d] text-sm font-medium transition-colors cursor-pointer"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-950/60 border border-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#E7BF73]"></div>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl p-8 text-center text-gray-400">
          No audit records found.
        </div>
      ) : (
        <div className="bg-[#161b22] border border-[#30363d] shadow-xl overflow-hidden rounded-xl">
          <table className="min-w-full divide-y divide-[#30363d] text-left">
            <thead className="bg-[#0d1117]">
              <tr>
                <th className="px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Data / Hora
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Ação
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Recurso
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Tenant / Usuário
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Origem (IP)
                </th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Detalhes
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#161b22] divide-y divide-[#30363d] text-sm">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-[#1f242c] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300 font-mono text-xs">
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${getActionBadgeClass(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-200">
                    <div>{log.resource_type || '-'}</div>
                    {log.resource_id && (
                      <div className="text-xs text-gray-400 font-mono truncate max-w-[120px]">{log.resource_id}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400 font-mono">
                    <div>Tenant: {log.tenant_id ? log.tenant_id.slice(0, 8) + '...' : '-'}</div>
                    <div>User: {log.user_id ? log.user_id.slice(0, 8) + '...' : '-'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">
                    <div>{log.ip_address || '-'}</div>
                    {log.user_agent && (
                      <div className="text-gray-400 truncate max-w-[150px]" title={log.user_agent}>{log.user_agent}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    {(log.old_value || log.new_value) ? (
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-[#E7BF73] hover:text-[#fbf0da] font-medium text-xs bg-[#21262d] border border-[#30363d] hover:border-[#E7BF73]/40 px-2.5 py-1 rounded transition-colors cursor-pointer"
                      >
                        Ver Carga
                      </button>
                    ) : (
                      <span className="text-gray-500 text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div className="px-6 py-4 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-[#30363d] rounded text-sm text-gray-300 bg-[#161b22] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#21262d] transition-colors cursor-pointer"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-400">Página {page + 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={logs.length < pageSize}
              className="px-3 py-1.5 border border-[#30363d] rounded text-sm text-gray-300 bg-[#161b22] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#21262d] transition-colors cursor-pointer"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* Payload Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-lg font-bold text-gray-900">Detalhes do Evento: {selectedLog.action}</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>
            <div className="space-y-4 text-xs font-mono">
              <AuditValueBlock label="Estado Anterior (old_value):" value={selectedLog.old_value} />
              <AuditValueBlock label="Novo Estado (new_value):" value={selectedLog.new_value} />
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium"
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
