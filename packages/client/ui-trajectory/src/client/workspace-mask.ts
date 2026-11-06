/**
 * Workspace-path masking for the Trajectory view. The ledger replays model-
 * facing text verbatim, so an absolute workspace path recorded in a prompt,
 * tool argument, or result would otherwise reach the screen. Masking happens
 * on the derived display strings, leaving the Session log untouched.
 */

/** Replacement shown wherever the workspace path was recorded. */
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
  return text => {
    let masked = text
    for (const spelling of ordered) masked = masked.split(spelling).join(HIDDEN_WORKSPACE_PATH)
    return masked
  }
}
