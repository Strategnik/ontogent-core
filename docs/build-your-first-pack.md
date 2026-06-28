# Build Your First Pack

A pack is a directory of YAML files that describes domain context without changing the engine. The smallest useful pack has:

- `pack.yaml` for identity and version
- `rules.yaml` for constraints or guidance
- optional fixtures under `fixtures/` so other people can run it

## 1. Copy the Reference Pack

```bash
cp -R packs/reference /tmp/my-pack
```

Change `pack.yaml` first:

```yaml
id: my/company-context
version: 0.1.0
name: My Company Context
```

## 2. Add One Rule

Rules should be specific enough for an agent to act on. Prefer this:

```yaml
- id: rule-cite-claims
  severity: soft
  directive: should
  text: Every factual claim should cite a source.
```

over this:

```yaml
- id: rule-be-good
  severity: soft
  directive: should
  text: Make the output high quality.
```

## 3. Validate

```bash
bun run validate /tmp/my-pack
```

## 4. Resolve Against a Fixture

```bash
bun run resolve /tmp/my-pack \
  --pcg /tmp/my-pack/fixtures/example.yaml \
  --task "review this launch email"
```

## 5. Decide Severity

Use `hard` or `locked` only when the consuming agent must never ignore the guidance. Use `soft` or `info` for context that should compete for attention.

That distinction is the whole point of Shield -> Rank: guardrails are enforced first, useful context is ranked second.
