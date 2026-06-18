# Distill — Working Plan

Single source of truth for where Distill is, what's been done, and what's next.
For the strategic bet (why "write/refactor" not "read/context"), see `CLAUDE.md`.

---

## 1. What Distill is (scope / pitch)

**Give an AI agent safe *hands* to refactor code, not just a *map* to read it.**

Codebases rot into "god files" (1,000-line `utils.ts`). Every AI coding tool competes
on *reading* code better (context/retrieval). Almost nobody owns the *writing* side:
restructuring code without breaking the build. That's Distill's lane.

Three-command loop:
1. **`distill suggest`** — *find the mess.* Builds a per-file symbol graph, clusters
   symbols into independent "responsibility" groups (union-find connected components),
   ranks the worst god-files. Score = `lines × (clusters − 1) + coupling`.
2. **`distill analyze`** — *inspect.* Lists extractable functions in a file.
3. **`distill extract`** — *fix it safely.* Pulls a function (+ its transitive in-file
   deps) into its own module, rewrites every importer project-wide, runs `tsc --noEmit`,
   and **auto-rolls-back** on failure.

Defensibility: real compiler-grade module resolution (ts-morph, not name heuristics);
fail-safe by construction (validate → rollback); agent-native (`--json` + MCP server).

One-liner: *GrapeRoot maps the codebase for the AI; Distill lets the AI safely act on it.*

---

## 2. Current state (as of this plan)

- Builds clean, **44 unit/integration tests green**.
- README cleaned to match reality (no fake npm/badges); **MIT LICENSE added**.
- **Validated end-to-end on 2 real OSS repos:**
  - `gvergnaud/ts-pattern` (12k★, jest, 453 tests) — suggest + extract, 453/453 still pass.
  - `unjs/ufo` (vitest, 489 tests) — suggest + extract, 489/489 still pass.
- Guardrails empirically verified: `node_modules/`, `dist/`, `*.test.ts`, `*.spec.ts`
  excluded from both ranking and mutation. New files written next to source, never `dist/`.
- Safety net proven: a failed extraction rolled back leaving the repo **pristine** and
  tests still green.

### Bugs found & fixed (committed)
1. **export-after-comments** — `getFullText()` includes leading comments, so prepending
   `export ` produced invalid `export // comment\nexport const x` and forced rollback on
   nearly any commented symbol. Fixed: insert `export` after leading comments, never
   double-export. (`tests/extractor.test.ts`)
2. **tsc-unavailable false rollback** — a project without typescript installed made
   `npx tsc` fail, misread as a type error → valid extraction silently discarded. Fixed:
   prefer local `node_modules/.bin/tsc`; distinguish real `error TS####` (rollback) from
   "tsc couldn't run" (keep change + warn loudly).

---

## 3. Known issues / open work

- **P0 — shared-dep duplication.** Co-extracted transitive deps are *copied* into the new
  file rather than *imported*. A symbol used elsewhere ends up defined in two places.
  Compiles + tests pass, but inflates LOC/tokens and can double-define exported symbols.
  **Must fix before publishing any "cleaner code" numbers.**
- Idempotency: re-running `extract` should no-op; `suggest` on a split result should show
  a lower god-file score. Not yet verified.
- Default / namespace / aliased export handling needs hardening + tests.
- `--undo` not wired (manifests are already written to `.distill/`; just consume them).
- TypeScript-only (by design for now).

---

## 4. Roadmap to a credible `0.2.0` npm release (~2–3 focused weeks)

| Phase | Work | Effort |
|---|---|---|
| **A — De-risk core** | Fix shared-dep duplication (import, don't copy); idempotency; default/namespace/aliased exports | ~3–5 days |
| **B — Corpus testing** | Batch harness (below); run 30–50 diverse repos; triage rollback patterns | ~3–4 days |
| **C — Release hygiene** | Wire `--undo`; CI (Actions running the suite); CHANGELOG; freeze MCP surface | ~2–3 days |
| **D — Publish** | `npm publish` 0.2.0; real badges | ~0.5 day |

Recommended order: **A (fix duplication) → B (measure at scale) → C → D.**
The whole pitch is "safe hands"; one viral "it duplicated my code" example undoes that.

---

## 5. Testing strategy (2 repos → a corpus)

Build a **batch harness** (script, ~100 LOC). Per repo:

```
clone → install → baseline test (record green/red)
  → distill suggest --json (capture top N targets)
  → for each target: extract → test → record outcome → revert
```

Track **rates**, not anecdotes:
- success rate (extracted + tests green)
- safe-rollback rate (rolled back, repo pristine) — target ~100%
- false-rollback rate (valid change discarded) — target ~0 (fixed today)
- **damage rate (tests broke and stayed broken) — must be 0; any non-zero is P0**

Choose for **diversity, not count**: different test runners (jest/vitest/ava/node:test),
path aliases (`@/…`), decorators (NestJS), React/TSX, monorepos/workspaces, barrel-heavy
packages, and repos that exclude tests from tsconfig (where the barrel re-export is
load-bearing). Starter set: `zod`, `trpc`, `type-fest`, `nest`, `remeda`, `valibot`,
`hono`, `ky`, `date-fns`, an Nx monorepo.

---

## 6. Metrics — beyond "tests pass"

"Tests pass" only proves *behavior unchanged*. Two separate questions:

### A. Did it split correctly? (safety)
- **Public API unchanged** — diff `tsc --declaration` (or api-extractor) `.d.ts` before/after.
- **No new import cycles** — `madge --circular` / `dependency-cruiser` before/after.
- **Emit equivalence** — compile both, diff normalized emitted JS.
- **Idempotency** — re-`suggest` score drops; second identical extract no-ops.

### B. Is the code "cleaner"? (value) — report before/after deltas
| Metric | Tool | Shows |
|---|---|---|
| Max/avg file LOC, # files > N lines | `cloc`, ts-morph | god-file reduction (headline) |
| Independent clusters per file | *Distill's own `suggest`* | cohesion (8 clusters → 8 single-cluster files) |
| Coupling Ca/Ce, instability `I=Ce/(Ca+Ce)` | `dependency-cruiser` | module coupling |
| Cyclomatic complexity, Maintainability Index | `typhonjs-escomplex`, `ts-complex` | per-file complexity drop |
| Dependency cycles | `madge --circular` | structural health |
| **Context/token footprint** | tokenizer (see §7) | the AI-agent pitch — **measure, never assert** |

Honesty flag: until shared-dep duplication is fixed, LOC/token metrics can look *worse*.
Fix dedup before publishing numbers.

---

## 7. AI-agent angle — free validation (do now)

Goal: prove "Distill shrinks the context an agent needs to work on a symbol" without
paying. Two layers:

1. **Deterministic context-footprint (no model needed, fully reproducible — the headline):**
   - Task: "work on function X."
   - Baseline = tokens of the whole god-file containing X.
   - Distilled = tokens of X's new module (+ transitive deps).
   - Delta = token savings. Compute with a tokenizer only. Free, deterministic.
2. **Model-in-the-loop (free models — shows smaller context still answers correctly):**
   - Run the same task on Ollama (local) or Gemini free, once with the whole god-file and
     once with the distilled module. Compare tokens used, answer correctness, latency.

### Monitoring token usage (free)
- **Gemini free (AI Studio key):** every `generateContent` response has `usageMetadata`
  (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`). Standalone
  `models.countTokens` endpoint counts before sending. Free.
- **Ollama (local, offline):** response JSON has `prompt_eval_count` (input) and
  `eval_count` (output) tokens + durations. Free.
- **opencode:** open-source coding agent; point it at Ollama/Gemini; shows per-session
  token usage.
- **Provider-agnostic prompt counting:** local tokenizer (`js-tiktoken`) or Gemini
  `countTokens`. Always report *which* tokenizer (models differ).

### Token cost depends on BOTH the model and the harness — don't conflate them
Token cost has two independent axes; a benchmark that mixes them measures nothing.

- **Model axis → count-per-text and cost-per-token.** The *same* text becomes a *different*
  number of tokens per model (Claude/Gemini/GPT use different tokenizers). Price also
  varies by model and token type (input vs output, cached vs uncached); prompt caching can
  cut cost without changing the count.
- **Harness axis → what text gets fed in at all (usually dominant).** The agent scaffolding
  (Claude Code vs Codex vs Cursor vs Aider vs opencode) decides the actual payload:
  - retrieval granularity (grep-matching-lines vs read-whole-file vs semantic retrieval —
    e.g. a `Read` that pulls ~2000 lines loads a 1,400-line god-file *whole*);
  - over-fetch (surrounding lines, neighbor files, eagerly-read imports);
  - history accumulation (multi-turn loops re-include earlier tool dumps);
  - fixed per-turn overhead (system prompt + tool schemas);
  - write-back strategy (re-emit whole file vs emit a diff → output tokens scale with file size).

  ⇒ Same model + same task, different harness = wildly different token bills. This is the
  grep-100-lines-vs-200-lines effect.

**Benchmark rules that follow:**
1. **Layer-1 footprint is harness-independent** — it's a property of *the code* (god-file
   tokens vs module tokens). This is the number to defend unconditionally.
2. **Layer-2 (real agent): hold harness AND model constant**, vary only god-file vs
   distilled module. Never compare harness-A-on-god-file vs harness-B-on-module — that
   measures the harnesses, not Distill.
3. **Frame the claim honestly:** Distill's benefit is largest for file-granularity harnesses
   (read/re-emit whole files) and smaller for fine-grained retrieval — but even the latter
   gains, because a grep hit lands in a tight relevant module instead of a 1,400-line
   grab-bag (less noise per match, cheaper write-backs). So the pitch is: *"Distill lowers
   the floor of context any agent needs to safely touch a symbol; how much each harness
   captures depends on its retrieval/edit strategy."* Report the floor as the headline;
   show one or two real (harness, model) pairs as corroboration.

### Extrapolating to paid cost (without paying)
Measure tokens free now; multiply by published $/token of paid models later. This sets up
the "long-term refactoring cost reduction" proof without spending anything today.

---

## 8. Immediate next actions
- [ ] (b) Fix shared-dep duplication (import shared deps instead of copying). **P0.**
- [ ] (a) Build the batch-testing harness.
- [ ] (c) Add a `distill metrics` / `--report` mode emitting before/after deltas.
- [ ] Set up free token-usage measurement (§7) and record the first footprint deltas.
