# @deepseek-ai/dsh-host-positioning-injection

Prepends the creator's Brand DNA — the canonical `POSITIONING CONTEXT (Your Brand DNA)` block — to the system prompt of sessions created with a `positioningMappingId`.

## Use this package

Mount it in a host composition where sessions can carry a positioning mapping (the CopyMonster bundle inserts it before `copymonster-identity`, so the immutable identity stays above the DNA block). The plugin registers one global `system-prompt/assemble` waterfall listener:

1. The assembling scope's Agent carries the Session; the session-controller's `sessionTenantMap` holds its `positioningMappingId` (written by `session.create` when the request names one, preserved across prompt-path rewrites).
2. No session, no map entry, or no `positioningMappingId` — the assembly passes through unchanged: the model runs DNA-free.
3. The mapping is fetched once per Session over the service-role client (`get_positioning_mapping(p_mapping_id, p_user_id)`), confined to the session's user; a later turn with the same id serves the cache. A session switching ids refetches; a service restart empties the cache with the process.
4. Only a `completed` mapping injects. The section is emitted with `interpolate: false`, so the creator's block content stays verbatim.

Failures never block the turn: an unreadable or absent mapping reads as DNA-free. Only failure reasons are logged — mapping content never reaches host logs.

## Model Experience

The injected block adds roughly 350–700 tokens up front, varying with the mapped content. It is emitted once per system prompt (not per turn) and does not affect tool schemas or the tool catalog. Sessions without a positioning mapping observe no change at all: no extra tokens, no extra section.

## Known Limitations and Deferred Work

- A mapping edited while a session that already fetched it stays open re-injects only for new sessions (or after a restart); the cache does not observe `updated_at`. Refine flows open new sessions, which fetch fresh.
- A preset persona declared `complete: true` (the shipped `minimal` preset) replaces the assembled sections after the waterfall, so the DNA block — like the CopyMonster identity — is deliberately dropped there.
- Subagent scopes carry their own sessions and inherit nothing; only sessions created with `positioningMappingId` inject.
