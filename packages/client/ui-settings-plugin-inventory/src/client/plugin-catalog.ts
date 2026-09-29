import type { PluginInventoryLocaleKey } from './locales.ts'

export interface FriendlyPluginCopy {
  readonly title: PluginInventoryLocaleKey
  readonly desc: PluginInventoryLocaleKey
}

export const FRIENDLY_PLUGINS: Record<string, FriendlyPluginCopy> = {
  'hmr': { title: 'pluginHmrTitle', desc: 'pluginHmrDesc' },
  'llm': { title: 'pluginLlmTitle', desc: 'pluginLlmDesc' },
  'llm-deepseek': { title: 'pluginLlmDeepseekTitle', desc: 'pluginLlmDeepseekDesc' },
  'llm-pi-ai': { title: 'pluginLlmPiAiTitle', desc: 'pluginLlmPiAiDesc' },
  'session': { title: 'pluginSessionTitle', desc: 'pluginSessionDesc' },
  'session-persistence-jsonl': { title: 'pluginSessionPersistenceTitle', desc: 'pluginSessionPersistenceDesc' },
  'session-stats': { title: 'pluginSessionStatsTitle', desc: 'pluginSessionStatsDesc' },
  'session-turn-outline': { title: 'pluginSessionOutlineTitle', desc: 'pluginSessionOutlineDesc' },
  'session-query-sqlite': { title: 'pluginSessionQueryTitle', desc: 'pluginSessionQueryDesc' },
  'tool-bash': { title: 'pluginBashTitle', desc: 'pluginBashDesc' },
  'bash-sandbox': { title: 'pluginBashTitle', desc: 'pluginBashDesc' },
  'terminal-controller': { title: 'pluginTerminalTitle', desc: 'pluginTerminalDesc' },
  'tool-fs': { title: 'pluginFsTitle', desc: 'pluginFsDesc' },
  'tool-fs-search': { title: 'pluginFsSearchTitle', desc: 'pluginFsSearchDesc' },
  'fs-sandbox': { title: 'pluginFsTitle', desc: 'pluginFsDesc' },
  'workspace-files': { title: 'pluginWorkspaceFilesTitle', desc: 'pluginWorkspaceFilesDesc' },
  'workspace': { title: 'pluginWorkspaceTitle', desc: 'pluginWorkspaceDesc' },
  'workspace-controller': { title: 'pluginWorkspaceControllerTitle', desc: 'pluginWorkspaceControllerDesc' },
  'agent-loop': { title: 'pluginAgentLoopTitle', desc: 'pluginAgentLoopDesc' },
  'agent': { title: 'pluginAgentTitle', desc: 'pluginAgentDesc' },
  'agent-default-model': { title: 'pluginAgentDefaultModelTitle', desc: 'pluginAgentDefaultModelDesc' },
  'tool-web': { title: 'pluginWebTitle', desc: 'pluginWebDesc' },
  'web-search-deepseek': { title: 'pluginWebSearchTitle', desc: 'pluginWebSearchDesc' },
  'web': { title: 'pluginWebTitle', desc: 'pluginWebDesc' },
  'tool-subagent': { title: 'pluginSubagentTitle', desc: 'pluginSubagentDesc' },
  'tool-subagent-control': { title: 'pluginSubagentTitle', desc: 'pluginSubagentDesc' },
  'subagent': { title: 'pluginSubagentCoreTitle', desc: 'pluginSubagentCoreDesc' },
  'auth-context': { title: 'pluginAuthContextTitle', desc: 'pluginAuthContextDesc' },
  'auth-http': { title: 'pluginAuthHttpTitle', desc: 'pluginAuthHttpDesc' },
  'tool-todo': { title: 'pluginTodoTitle', desc: 'pluginTodoDesc' },
  'tool-skill': { title: 'pluginSkillTitle', desc: 'pluginSkillDesc' },
  'skill': { title: 'pluginSkillTitle', desc: 'pluginSkillDesc' },
  'tool-goal': { title: 'pluginGoalTitle', desc: 'pluginGoalDesc' },
  'goal': { title: 'pluginGoalTitle', desc: 'pluginGoalDesc' },
  'tool-jobs': { title: 'pluginJobsTitle', desc: 'pluginJobsDesc' },
  'jobs': { title: 'pluginJobsTitle', desc: 'pluginJobsDesc' },
  'system-prompt': { title: 'pluginSystemPromptTitle', desc: 'pluginSystemPromptDesc' },
  'credentials': { title: 'pluginCredentialsTitle', desc: 'pluginCredentialsDesc' },
  'credentials-local': { title: 'pluginCredentialsTitle', desc: 'pluginCredentialsDesc' },
  'permission-presets': { title: 'pluginPermissionTitle', desc: 'pluginPermissionDesc' },
  'permission': { title: 'pluginPermissionTitle', desc: 'pluginPermissionDesc' },
  'timer': { title: 'pluginTimerTitle', desc: 'pluginTimerDesc' },
  'token-meter': { title: 'pluginTokenMeterTitle', desc: 'pluginTokenMeterDesc' },
  'tools': { title: 'pluginToolsTitle', desc: 'pluginToolsDesc' },
}

export function resolvePluginCopy(
  _moduleName: string,
  entryId: string | null,
  shortName: string,
  t: (key: PluginInventoryLocaleKey) => string,
): { title: string; description?: string } {
  const match = FRIENDLY_PLUGINS[shortName]
    ?? (entryId !== null ? FRIENDLY_PLUGINS[entryId.replace(/^include:/, '')] : undefined)

  if (match !== undefined) {
    return {
      title: t(match.title),
      description: t(match.desc),
    }
  }
  return { title: shortName }
}
