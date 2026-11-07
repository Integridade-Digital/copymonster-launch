# @deepseek-ai/dsh-host-model-mask

Masks the real LLM provider/model route behind a single virtual CopyMonster model for tenants, while resolving the alias privately to the configured primary route.

## Model experience

Tenants see exactly one selectable model — `copy-monster-default` / "Model CopyMonster" — in the browser model catalog. The underlying provider and model id never reach the client payload, error messages, session log, or wire. The alias is admitted by `modelAvailable()` and resolved privately to the primary route at model-request time, so the Agent turn executes on the configured real provider without exposing it.

Platform administrators (`isAdmin === true`) keep the full, real provider catalog for auditing and management in the Admin Modal.

## Registration

Mounted through the CopyMonster bundle patch (`cordis.patch.yml`) like the sibling host plugins (`copymonster-identity`, `positioning-injection`, `llm-fallback`).

```yaml
- id: model-mask
  name: '@deepseek-ai/dsh-host-model-mask'
  config:
    virtualProvider: copymonster
    virtualModel: copy-monster-default
    virtualModelName: Model CopyMonster
    primaryProvider: deepseek-official
    primaryModel: deepseek-chat
    applyToTenantsOnly: true
```

## Known Limitations and Deferred Work

The primary route is a static plugin `Config` field. Reading it from the central `llm.central_routing` store (maintained by `dsh-server-login`) is deferred to a follow-up that wires a cross-service settings read.

## Package metadata

- Name: `@deepseek-ai/dsh-host-model-mask`
- Kind: Host plugin (Cordis)
- Private: true
