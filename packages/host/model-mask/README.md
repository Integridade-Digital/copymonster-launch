# @deepseek-ai/dsh-host-model-mask

Masks the real LLM provider/model route behind a single virtual CopyMonster model for tenants, resolving the alias automatically against whichever provider and model are active in the live catalog.

## Model experience

Tenants see exactly one selectable model — `copy-monster-default` / "Model CopyMonster" — in the browser model catalog. The underlying provider and model id never reach the client payload, error messages, session log, or wire. The alias is admitted by `modelAvailable()` and resolved privately at model-request time, so the Agent turn executes on a real provider without exposing it.

The alias is **not** a real selectable model: it never appears in the administrator's model picker and carries no provider or key of its own. It is a presentation alias the runtime resolves automatically.

Platform administrators (`isAdmin === true`) keep the full, real provider catalog — every provider and model the `Settings > Models` document configures. The mask applies only to tenant callers.

## Route selection

An administrator may pin the primary route and the contingency route from the Admin provider manager (`PlatformRoutingCard` in `Settings > Models`), which writes four volatile fields: `primaryProvider`/`primaryModel` and `fallbackProvider`/`fallbackModel`. At each request the adapter rebuilds the route chain from those pins and the live `ctx.llm` registry:

1. Every provider from `ctx.llm.listProviders()` is asked for its models through `ctx.llm.listModels()`. A provider whose lookup fails is skipped.
2. The pinned primary pair leads the chain when the catalog advertises it. Without a usable pin, the deployment default from `ctx.agentDefaultModel.currentSelection()` is primary when it matches an available model; otherwise the first available model in registry order is primary.
3. Next comes the pinned contingency pair when the catalog advertises it, then every other available model in registry order.
4. `fallbackPolicy.maxAttempts` bounds how many routes in that chain a single turn may try.

An empty pin means the mask follows the live catalog, so a newly added provider in `Settings > Models` takes effect on the next request without any administrator configuration. A pin naming a provider or model the catalog does not advertise is ignored, so a removed provider cannot leave tenants without a route. The chain is rebuilt when the alias policy reloads (`loader/volatile-update`), when settings change (`settings/document-updated`), and when the LLM registry changes (`llm/adapters-updated`).

Streaming failover rules:

- A route that fails **before** any chunk is emitted, with an eligible transient failure (429, 5xx, timeout, transport, or a rejected key), advances to the next route in the chain.
- Once any chunk has been emitted to the client, failover is strictly forbidden: the failure surfaces instead of mixing two generations.
- 400 and 403 fail fast — they describe the request or its permissions, not the route.
- `fallbackPolicy.enabled: false` restricts a turn to the primary route alone.

## Registration

Mounted through the CopyMonster bundle patch (`cordis.patch.yml`) like the sibling host plugins (`copymonster-identity`, `positioning-injection`, `llm-fallback`).

```yaml
- id: model-mask
  name: '@deepseek-ai/dsh-host-model-mask'
  config:
    virtualProvider: copymonster
    virtualModel: copy-monster-default
    virtualModelName: Model CopyMonster
    fallbackPolicy:
      enabled: true
      maxAttempts: 3
      timeoutMs: 30000
    applyToTenantsOnly: true
```

The plugin injects `llm` and `agentDefaultModel`; it reads providers and models on demand. The pinned routes are optional config fields the Admin card writes through the settings service.

## Known Limitations and Deferred Work

A deployment with no available model at all resolves the alias to a sentinel route that fails clearly on the first turn; the mask does not synthesize a fallback provider. Health-based route ranking (preferring a probe-passing provider over registry order) is deferred.

## Package metadata

- Name: `@deepseek-ai/dsh-host-model-mask`
- Kind: Host plugin (Cordis)
- Private: true
