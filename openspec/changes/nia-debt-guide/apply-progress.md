# Apply progress: nia-debt-guide

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. S0 branch: `feat/ndg-s0-explain-plumbing` (from master 72964af). S1 branch: `feat/ndg-s1-loan-topics` (from master faef26b).

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

## Batch S1 (loan topics): COMPLETE (13/13 tasks and the checkpoint)

### Tasks

- [x] S1a.1 to S1a.6 (core facts builders for `rate_conventions`, `usury_ibc`, `mora`, `payment_allocation`, `charges`; `allowedTexts`; draft copy)
- [x] S1b.1 to S1b.5 (Spanish templates, source footer, «aproximado», paragraph splitter, golden and property tests)
- [x] S1b.6 to S1b.7 (`explainReply` paging: «Ver más», related topics, 64-byte page callback, marker write)
- [x] S1.CP checkpoint (tests, build, package with the override, plain package still refuses). Not deployed until gate G.

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 54d1506 `feat(explain): build the rate-convention and usury facts from core results` | S1a (1/3) | 8 files, 331 insertions, 8 deletions |
| 8cbf454 `feat(explain): build the mora and payment-allocation facts from the core projection` | S1a (2/3) | 7 files, 271 insertions, 1 deletion |
| 3238ecc `feat(explain): add the charges facts, allowedTexts and the draft copy of the loan topics` | S1a (3/3) | 9 files, 342 insertions, 2 deletions |
| e3f488e `feat(nia): render the five loan topics with source footer, aproximado labels and a paragraph splitter` | S1b (1/2) | 6 files, 575 insertions, 9 deletions |
| 5f1245d `feat(nia): page long explanations with Ver mas and related topics, keeping what the user stated in the marker` | S1b (2/2) | 4 files, 174 insertions, 11 deletions |

Code total vs master before the bookkeeping commit: 27 files, 1,690 insertions, 28 deletions = 1,718 changed lines (budget 2,000; each commit at most 575). S1a came to 951 lines against about 700 estimated; the slice crossed 1,500 lines inside its last group (S1b), so no size stop applied.

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| S1a.1/2 | `facts.rates.test.js`, `facts.usury.test.js` (16 failed: no builders) and the node16 source list | 44/44 in `packages/finance-core/test/explain` + node16 | Approximate flags simplified to one `exact` lookup |
| S1a.3/4 | `facts.mora.test.js`, `facts.allocation.test.js` written before the builders | 63/63; two expectations corrected against core truth (an overpayment carries into the next installment charges; "next due" is the upcoming row) | Unused `today` removed from the example |
| S1a.5/6 | `facts.charges.test.js`, `allowed.test.js`, `copy.shape.test.js` and the barrel exact-keys (`allowedTexts`) | 792/792 core + scripts + explain | None needed |
| S1b.1/2/3 | `render.test.js` goldens and splitter written before the templates | 177/177; `flow.test.js` S0 fallback case moved to `card_statement` (mora now has a template) | Verbose usury sentence assembly cleaned |
| S1b.4/5 | `render.property.test.js` (4 seeds, 140+ renders per seed over 5 topics x 7 debts x 4 dates x random legal tables, stated rates and amounts) | Passed first run; mutation check (a literal digit and a spelled number added to a template) turned all 4 seeds red, then restored | The property surfaced nothing to fix |
| S1b.6/7 | `flow.test.js` paging cases (5 failed) and `handler.test.js` released-topic cases (4 failed) | 680/680 in `functions/nia` | None needed |

Triangulation: rates (NAMV, MV, EA, 0 %, debt with a rate change, stated over debt), usury (IBC, derived IBC, stale, unverified, unknown, above and below cap, 0 %, generic), mora (10 and 30 days, example, none, fixed, notices, card), allocation (three goldens, partial earlier payment, overpayment, paid-off, generic), charges (fee + IVA, subtotal basis, none, many lines, generic, card), paging (first, last, clamp, single part, 36-character id, no debt).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core functions/nia scripts` exit 0: 65 files, 1,407 tests passed (core explain facts for 5 builders, `allowedTexts`, copy shape, node16; Nia `render` goldens and splitter, property 4 seeds, `flow`, `handler` released topics) |
| Runtime harness | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` exit 0 (14 keys listed: 8 draft unreviewed, 6 missing; `functions/nia.tar.gz` written); plain `npm run package:nia` exit 1 listing the same 14 keys |
| Full suite and build | `npm test -- --maxWorkers=4`: 138 files, 2,304 tests passed; `npm run build` exit 0 |
| Rollback boundary | core `src/explain/{allowed,format}.js`, `src/explain/facts/`, the S1 entries of `copy.js`, the `explain.js` builder wiring, the `allowedTexts` barrel line and test lists; Nia `debt/explain/render.js` templates, `flow.js` paging, the marker fields and `page` pass-through in `handler.js`. Read-only feature, no data written |

### Deviations from design

- `allowedTexts(facts)` takes no `copy` argument: the copy texts are already in `facts.copy`. It also returns the debt name, because the footer prints it.
- Facts gain additive fields: `copyKeys` (parallel to `copy`, so templates pick a text by key), and `sources` is now the de-duplicated union of every key's sources (it was the first key's).
- The marker (G4) carries `stated` and `amountMinor` when the user gave them. «Ver más» only has the topic, the debt id and the page, so without them it would re-render a different explanation. They are reused only for the same topic and debt, and expire with the marker.
- The footer is on every part (tasks and design G6); the spec text says "on the last part".
- A card gets the policy only in `mora` and the generic answer in `payment_allocation` and `charges` until S2 adds the card paths. `usury_ibc` for a mortgage reports "no cap known" and does not explain Ley 546 (S3a), so `usury_ibc` cannot be released before S3 adds `legal.ley546`.
- Generic `usury_ibc` shows the public consumer cap (a legal constant, no debt figure); generic `charges` shows the GMF and IVA examples, both computed with `evaluateCharges`.
- The copy is a DRAFT for gate G: sources and the URL come from the explore notes (Superfinanciera IBC publication, C.Co. arts. 884 and 886, C.C. art. 1653, E.T. arts. 870 to 881). No `reviewedOn` or hash is set.
- Test helpers added: `test/helpers/explainCopy.js` (signs the shipped draft copy for tests only) and `test/helpers/lateGolden.js`.

### Issues found

- The mora golden fixture covers all of 2026, so the stale-cap case needs a 2027 date.
- `planCommit` spreads an overpayment over the next installments (charges first); `surplus` only appears once the whole debt is covered.

### Remaining

S2 to S7 and gate G (owner copy review G.1 to G.3 blocks the first deploy of S1 to S3).
