# Architecture

Ontogent Context Core is the open engine. It knows how to load, validate, resolve, and deliver context packs. It does not contain the domain knowledge that makes a pack valuable.

## Boundary

Open here:

- pack format
- YAML loader
- schema validation
- constrained condition evaluator
- relationship breach checks
- Shield -> Rank resolver
- agent-facing rendering
- CLI and MCP delivery

Closed or hosted elsewhere:

- premium domain packs
- learned rerankers
- persistence
- auth and tenancy
- product analytics

That boundary is deliberate. The engine should be inspectable infrastructure; the durable value is the authored, authority-weighted content and the accumulating context graph.

## Resolve Flow

1. Load a pack directory.
2. Validate pack metadata, rules, relationships, archetypes, playbooks, and benchmarks.
3. Load a PCG fixture or runtime context document.
4. Evaluate each rule's condition with the constrained CEL profile.
5. Split active context into Shield and Rank.
6. Treat hard and locked constraints as Shield output. Ranking never suppresses them.
7. Score soft and info context for task relevance.
8. Apply diversity so one class of guidance does not crowd out the rest.
9. Render the final context for a consuming agent over CLI or MCP.

## Shield -> Rank

The important design choice is that severity controls the stage. A hard constraint is a guardrail. A soft constraint is ranked context. That means a highly relevant suggestion cannot override a hard constraint, and a soft `must` is still droppable if it falls below the delivery threshold.

Indeterminate conditions are conservative for hard rules and quiet for soft rules:

- hard: active and logged
- soft: inactive and logged

That failure mode prevents missing guardrails because the current context is incomplete.

## MCP Surface

The MCP server intentionally exposes only two tools:

- `validate_pack({ packDir })`
- `resolve_context({ packDir, pcgPath, task })`

The small surface is easier to trust and easier to wire into editors. More domain-specific behavior belongs in packs, not in the engine API.

## Production Shape

The open engine keeps the interfaces stable while hosted deployments can swap stronger implementations behind them:

- cross-encoder ranking behind the same resolver boundary
- persistent graph state
- audit trails for context activations
- pack-level eval reports
- organization and user-level authorization
