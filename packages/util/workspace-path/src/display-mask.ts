/**
 * Display masking for absolute workspace paths. Model-facing text replays a
 * workspace directory verbatim in prompts, tool arguments, and results, so a
 * view hides the recorded spelling before it reaches the screen.
 * @module @deepseek-ai/dsh-util-workspace-path/display-mask
 */

/** Replacement shown wherever a workspace path was recorded. */
export const HIDDEN_WORKSPACE_PATH = '[Workspace path hidden]'

/**
 * Build the text mask for one Session's workspace.
 * @param cwd - the Session's workspace directory, when the list knows it.
 * @returns a function replacing every recorded spelling of that directory.
 */
export function workspaceMask(cwd: string | undefined): (text: string) => string {
  if (cwd === undefined) return text => text
  // A recorded path may use either separator, and may carry a trailing one.
  const spellings = new Set<string>([
    cwd,
    cwd.replace(/\/+$/u, ''),
    cwd.replace(/\\/gu, '/'),
    cwd.replace(/\//gu, '\\'),
  ])
  const ordered = [...spellings].filter(spelling => spelling !== '').sort((a, b) => b.length - a.length)
  if (ordered.length === 0) return text => text
  return (text) => {
    let masked = text
    for (const spelling of ordered) masked = masked.split(spelling).join(HIDDEN_WORKSPACE_PATH)
    return masked
  }
}

/** Host roots whose absolute paths identify the server rather than the workspace. */
const SERVER_ROOT = /(^|[^\w.-])\/(?:var|home|root|opt|srv|usr|etc|tmp)\/[\w.\-/@+]*/gu

/**
 * Build a mask for server-side absolute paths reported inside a workspace path.
 *
 * A tenant's workspace already sits under one of these roots, so the
 * workspace mask covers it. Paths outside that workspace (another tenant's
 * data directory, a host log file) still name the server layout, so their
 * root segment is replaced.
 * @param cwd - the Session's workspace directory, when the list knows it.
 * @returns a function masking both the workspace directory and server roots.
 */
export function serverPathMask(cwd: string | undefined): (text: string) => string {
  const workspace = workspaceMask(cwd)
  return text => workspace(text).replace(
    SERVER_ROOT,
    (_match, leading: string) => `${leading}${HIDDEN_WORKSPACE_PATH}`,
  )
}
