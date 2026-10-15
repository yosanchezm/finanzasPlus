# Apply progress: nia-debt-guide

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. Branch: `feat/ndg-s0-explain-plumbing` (from master 72964af).

## Batch S0 (explain plumbing): COMPLETE (18/18 tasks)

### Tasks

- [x] S0a.1 to S0a.8 (core catalogue and copy gate, hardened guard, glossary router, `explain` extraction)
- [x] S0b.1 to S0b.6 (`explainButton`/`parseExplainCallback`, read-only flow, marker, `index.js` routing)
- [x] S0b.7 to S0b.9 (copy check script, `package:nia` gate, source scan, `docs/deploy.md`)
- [x] S0.CP checkpoint (tests, build, package with the override, plain package refuses). The Nia deploy is an owner action.

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 13ad431 `feat(explain): add the closed topic catalogue and the reviewed-copy release gate to the core` | S0a (1/2) | 7 files, 382 insertions |
| fcfafa7 `feat(nia): harden the paraphrase guard and add the glossary router and the explain extraction` | S0a (2/2) | 8 files, 357 insertions, 15 deletions |
| 2357432 `feat(nia): answer explain requests read-only with stateless buttons and a session marker` | S0b (1/3) | 7 files, 605 insertions, 8 deletions |
| 7883ca1 `feat(nia): route glossary questions and nia:exp buttons to the explain flow` | S0b (2/3) | 2 files, 172 insertions, 3 deletions |
| c8139a7 `feat(nia): gate packaging on the reviewed explain copy and document the S0 deploy` | S0b (3/3) | 5 files, 293 insertions, 3 deletions |

Code total vs master before the bookkeeping commit: 28 files, 1,809 insertions, 29 deletions = 1,838 changed lines (budget 2,000; each group at most 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| S0a.1/2 | `topics.test.js` and the barrel/node16 lists fail: modules `src/explain/*` missing, barrel keys differ | 27/27 | None needed |
| S0a.3/4 | `guard.test.js`: 18 of 35 failed (number words, 1,200 cap, `maxChars`) | 35/35; `replies.advice.test.js` adjusted for the fixed word «tres meses», handler fallback cases added | None needed |
| S0a.5/6 | `router.test.js` written against a missing module | 47/47 | None needed |
| S0a.7/8 | `extract.test.js`: 14 new cases failed (no `explain` action or payload) | 80/80 | None needed |
| S0b.1/2 | `pending.test.js`: 7 failed (`explainButton is not a function`) | 31/31 | None needed |
| S0b.3/4 | `handler.test.js` explain block: 20 failed; `flow.test.js` against missing `flow.js`/`render.js` | 605/605 in `functions/nia/debt` | `TOPIC_KINDS` not exported: the render keys off `facts.debt.kind` |
| S0b.5/6 | `index.test.js`: 8 of 11 new cases failed; the other 3 are regression guards (payment kept, non-debt glossary, stale `nia:mode`) | 639/639 in `functions/nia` | None needed |
| S0b.7/8 | `check-explain-copy.test.mjs`: module missing, then 1 failing gate test | 12/12; `package-nia.test.js` 17/17 | The test helper moved to `spawnSync` to read stderr on success |
| S0b.9 | Docs: no test | Read back | None |

Triangulation: guard (15 rejected words, 5 accepted look-alikes), router (positives, negatives, vetoes, marker rules), buttons (all 9 topics with a 36-character id, page form), flow (every topic, several debts, foreign scope).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core functions/nia scripts` exit 0: 56 files, 1,308 tests passed (core explain 27 tests with node16, router 47, guard 35, extract 80, pending 31, handler explain 20, index explain 11, check script 12) |
| Runtime harness | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` exit 0 (14 keys listed in the warning, `functions/nia.tar.gz` written); plain `npm run package:nia` exit 1 listing the 14 missing keys, no tarball built |
| Full suite and build | `npm test -- --maxWorkers=4`: 129 files, 2,204 tests passed (no jsdom timeout this run); `npm run build` exit 0 |
| Rollback boundary | core `src/explain/` plus its barrel lines; Nia `debt/explain/`, `guard.js`, `extract.js`, `pending.js`, `handler.js` explain hooks, `index.js` router call and `nia:exp` dispatch; `scripts/check-explain-copy.*`, the `package-nia.mjs` gate and `docs/deploy.md`. Read-only feature, no data written |

### Deviations from design

- `glossaryTopic(text, { marker, hasAttachment })` drops the `released` option: unreleased topics route the same, so the list is not needed. A marker match returns `{ topic, fromMarker: true }` so the flow can take the marker debt.
- `ACTIONS` gains only `explain` (as the task says); `setup` and `terms_correction` wait for S5a and S6a.
- `topic` enum is rendered into the extraction schema and prompt from `EXPLAIN_TOPICS`, so the prompt and the catalogue cannot drift.
- `TOPIC_KINDS` and `topicCopyKeys` are not on the barrel (the design list does not name them); the check script imports `src/explain/copy.js` directly.
- Size rule: the slice crossed 1,500 lines (1,542) before its last group. It continued because the orchestrator's budget is 2,000 and the last group was estimated to fit; reported for the size review.

### Issues found

- The existing advise template says «últimos tres meses»; the hardened guard rejects number words in model replies, so the existing numeric-guard test now neutralises that fixed word. Advise paraphrases that spell a number now fall back to the template (accepted in the design).
- The shipped copy has 14 missing keys, so every topic answers «Este tema está en revisión» until gate G.

### Remaining

S1 to S7 and gate G.
