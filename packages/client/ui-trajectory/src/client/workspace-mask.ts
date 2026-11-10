/**
 * Workspace-path masking for the Trajectory view. The ledger replays model-
 * facing text verbatim, so an absolute workspace path recorded in a prompt,
 * tool argument, or result would otherwise reach the screen. Masking happens
 * on the derived display strings, leaving the Session log untouched.
 */

export { HIDDEN_WORKSPACE_PATH, workspaceMask } from '@deepseek-ai/dsh-util-workspace-path'
