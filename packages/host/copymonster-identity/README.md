# @deepseek-ai/dsh-host-copymonster-identity

## Summary

Prepends an immutable CopyMonster identity block to every agent system prompt in the CopyMonster deployment. A global `system-prompt/assemble` listener (`global: true`) observes the assembling scope, so the block reaches main-chat sessions on any agent preset, subagents, and Agent Team members without editing `packages/core`.

The plugin contributes one prompt section named `copymonster:identity`. A unique name keeps it clear of preset personas, which shadow only their own `deployment:persona-*` names.

## Use this package

Mount it once in the host composition (the CopyMonster bundle inserts the row):

```yaml
- id: copymonster-identity
  name: '@deepseek-ai/dsh-host-copymonster-identity'
```

## Understand the implementation

`apply` registers `system-prompt/assemble` with `{ global: true, prepend: true }` and prepends `{ name: 'copymonster:identity', text: IDENTITY_TEXT }` to the assembly returned by `next()`. The listener stays on the root, while the prompt registry dispatches the waterfall on the assembling scope, so every agent's assembly is covered.

## Model Experience

The model receives the identity block as the first prompt section of every request, above the preset persona and all other guidance. The block fixes the assistant's self-identity as CopyMonster and forbids naming the underlying model, provider, or infrastructure. It adds a fixed token cost to every request.

## Known Limitations and Deferred Work

- **`complete: true` personas are not covered.** The prompt registry replaces the assembled sections with a `complete` section after the waterfall, so the shipped `minimal` preset (whose persona is its whole prompt) drops this watermark. Covering it would require a change in `packages/core/system-prompt`; the deployment accepted that trade-off to avoid core debt.
- The identity text is fixed in source, not configurable from `cordis.yml`.
