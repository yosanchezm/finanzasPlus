# Apply progress: nia-debt-guide

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. S0 branch: `feat/ndg-s0-explain-plumbing` (from master 72964af). S1 branch: `feat/ndg-s1-loan-topics` (from master faef26b). S2 branch: `feat/ndg-s2-card-topics` (from master ef5b37f). S4 branch: `feat/ndg-s4-terms-correction` (from master 0cad81b).

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

## Batch S2 (card topics): COMPLETE (6/6 tasks and the checkpoint)

S2 branch: `feat/ndg-s2-card-topics` (from master ef5b37f).

### Tasks

- [x] S2a.1 to S2a.2 (core: `revolvingBaseMinor`, `excludedBaseMinor` and `lateExcludedBaseMinor` on every statement row of the card projection, additive)
- [x] S2a.3 to S2a.4 (core facts `card_statement` and `card_interest_drop` with the minimum-only what-if, the card paths of `mora`, `payment_allocation` and `charges`, two draft copy samples)
- [x] S2b.1 to S2b.2 (card templates with «aproximado» labels, follow-ups, card applicability in the pick, property test with card fixtures)
- [x] S2.CP checkpoint (tests, build, package with the override, plain package still refuses). Not deployed until gate G.

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 0dc216d `feat(card): expose the revolving, excluded and mora-excluded base of each statement` | S2a (1/2) | 2 files, 160 insertions (the projector change is 10 lines) |
| ba19deb `feat(explain): build the card statement, interest-drop and minimum-only what-if facts from the core projection` | S2a (2/2) | 12 files, 510 insertions, 29 deletions |
| 9e67dbc `feat(nia): render the card topics with aproximado labels and offer a card topic only the cards` | S2b | 8 files, 408 insertions, 22 deletions |

Code total vs master before the bookkeeping commit: 21 files, 1,076 insertions, 49 deletions = 1,125 changed lines (budget 2,000; each commit at most 538; below the 1,500 size-review trigger). The slice came to 1,125 against 900 estimated (1.25x).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| S2a.1/2 | `card.base.test.js` written first: 8 of 9 failed (the three fields missing); the 9th is the additive characterization of the F3 fixture rows 1 and 2 (captured from the code before the change), which passes before and after on purpose | 58/58 in `test/card`; 1,892/1,892 in core + `src/features/debts` + `functions/nia` (no deep-equal golden moved) | None needed |
| S2a.3/4 | `facts.card.test.js` (10 cases), the card cases added to `facts.mora/allocation/charges.test.js` and the node16 source list: 20 failed | 760/760 core + scripts. Only the 9,526 interest, the 41,667 excluded capital and the 475,000/9,873 what-if were checked against the fixture, and all matched on the first run; `copy.shape.test.js` listed the exact key set, so it was updated for the two S2 keys | None needed |
| S2b.1/2 | card goldens in `render.test.js`, the card fixtures in `render.property.test.js`, the applicability and paging cases in `flow.test.js` and four card cases in `handler.test.js`: 24 failed (2 characterization cases passed) | 1,461/1,461 in `functions/nia` + core + scripts; the longest callbacks stay at 63 and 64 bytes | The statement sample was shortened so the whole statement fits one message. Mutation check: a literal digit and a spelled number added to two card templates turned all 4 seeds of the property red; restored |

Triangulation: bases (first statement, 300,000 unpaid, 800,000 paid in full, clamped due day, mora with and without grace, 40 seeded random cards), statement (two rules plus the default, partial payment, past due, no statement yet), interest drop (first cycle, paid in full, partly paid, mora, no mora, no statement, generic, payments after the statement ignored), card mora (billed, partial payment, example, no statement), allocation (stated, minimum, no statement), charges (lines, year, no charges, no statement), render (11 goldens), property (7 topics x 11 debts x 6 dates x 4 seeds, with a card paid in full and a card partly paid), applicability (one card, several cards, none, a named loan).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run functions/nia packages/finance-core scripts` exit 0: 67 files, 1,461 tests passed (card base 9, card facts 10 plus the card cases of mora, allocation and charges, render card goldens 11, property 4 seeds, flow and handler card cases) |
| Runtime harness | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` exit 0 (14 keys listed: 10 draft unreviewed, 4 missing; `functions/nia.tar.gz` written); plain `npm run package:nia` exit 1 listing the same 14 keys |
| Full suite and build | `npm test -- --maxWorkers=4`: 140 files, 2,357 tests (the first run had 2 `App.test.jsx` jsdom timeouts, known; the file passes alone, 8/8); `npm run build` exit 0 |
| Rollback boundary | core `card/card.js` (`closedBilled`, the `bases` of a cycle and three plan-row fields), `explain/facts/card.js`, the card paths of `facts/{mora,allocation,charges}.js`, the two card builders in `explain.js`, the two card entries of `copy.js`; Nia `render.js` card templates, `flow.js` `applicableDebts`/`cardOnly`, the card branch of `startExplain` in `handler.js`. Read-only feature, no data written |

### Deviations from design

- `closedBilled` starts at the opening balance, so the first statement counts the opening balance as already billed (the documented first-cycle approximation): a payment made before the first close shows as excluded base. The facts mark the first statement `first_cycle` and its figures «aproximado».
- `lateExcludedBaseMinor` is rounded to whole units (`Math.round`) so the three fields are integers, and `revolvingBaseMinor = base - lateExcluded`. The statement interest is still computed from the unrounded exclusion, as before (existing values must not change), so `revolving x rate` can differ from the interest by at most 1 minor unit (the seeded property asserts that bound). The spec text says «equal»; this is the only gap.
- The card mora rule («el capital del mínimo sin pagar») is a template paragraph, not a copy key: `topicCopyKeys('mora')` is fixed by `topics.test.js` as `['legal.mora', 'mora.sample']`. The owner reads it in the render goldens, not in `--print`.
- The what-if drops the payments recorded after the last statement and adds one synthetic payment on its due date, then reads the next statement of the same projection (design: «with `project` and a synthetic payment»). A real payment after the statement is therefore not mixed into a hypothetical.
- The card example of the mora topic shows the days the mora really runs until the next close (`lateDays`), not a fixed 10, because the card mora stops at the close. The loan example is unchanged.
- Beyond the task text, `flow.js` exports `applicableDebts` and `cardOnly`, and `startExplain` sends a card topic to the only card (or a pick among cards, or «No encuentro una tarjeta...»), because with a loan and a card and no name the generic answer would hide the card. A marker follow-up still keeps the marker debt.
- Three S1 tests changed: the «card gets the generic answer until S2» cases of charges and mora (now the card paths), the `flow.test.js` fallback case (now `restructure_whatif`, the next topic with no template) and the exact key list of `copy.shape.test.js` (two S2 keys).

### Issues found

- Verify W4 (card revolving exclusion prorated `baseDays / cycleDays`) is labelled «aproximado» in every figure that depends on it (`lateExcluded`, `revolving`, the interest without mora and their difference).
- Quirk, not fixed: when the due date clamps onto the statement day, a payment made after that close and before the next one counts as «excluded» base because the base is the balance at the close (the existing core rule).

## Batch S3 (restructure, prepayment, Ley 1555/546, optional paraphrase): COMPLETE (7/7 tasks and the checkpoint)

S3 branch: `feat/ndg-s3-whatif-topics` (from master d5d59d8). The slice was paused by the owner after the S3a commits and resumed for S3b; the S3a evidence below is read back from its commits and tests.

### Tasks

- [x] S3a.1 to S3a.2 (core facts `restructure_whatif` and `prepayment` with `restructureCarry` with and without the waived mora, the two-strategy comparison, the Ley 1555 notice with the unverified-scope caveat, the Ley 546 notice for a mortgage, the `legal.ley546`, `legal.ley1555`, `restructure_whatif.sample` and `prepayment.sample` draft copy with `reviewedOn: null`)
- [x] S3a.3 to S3a.4 (the two Nia templates, their follow-ups, the Ley 546 sentence in `usury_ibc` for a mortgage, goldens and the property test with mortgage and 0 % fixtures)
- [x] S3b.1 to S3b.2 (`explain/paraphrase.js`, `explainReplyParaphrased` in `flow.js`, `sendExplain` in `handler.js` uses it, `config.explainParaphrase` from `NIA_EXPLAIN_PARAPHRASE`, default off)
- [x] S3.CP checkpoint (tests, build, package with the override, plain package still refuses). Not deployed until gate G.

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| f44d66c `feat(explain): build the restructure and prepayment facts and the Ley 546 and Ley 1555 draft copy from core results` | S3a (1/2) | 10 files, 486 insertions, 11 deletions |
| 0fa25e0 `feat(nia): render the restructure and prepayment topics and the Ley 546 note for mortgages` | S3a (2/2) | 4 files, 239 insertions, 8 deletions |
| 42191a4 `feat(nia): add the optional guarded explain paraphrase, off by default` | S3b | 7 files, 347 insertions, 3 deletions |

Code total vs master before the bookkeeping commit: 21 files, 1,072 insertions, 22 deletions = 1,094 changed lines (budget 2,000; each commit at most 497; below the 1,500 size-review trigger). The slice came to 1,094 against 800 estimated (1.37x).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| S3a.1/2 | `facts.restructure.test.js`, `facts.prepayment.test.js` and the mortgage case of `facts.usury.test.js` written first, with the spec numbers (390,381 unpaid 10 days at 28.59 % EA gives 391,756 carried or 390,381 waiving mora; 1,200,000 at 0 %, 12 installments, 1 paid, extra 300,000 gives 8 installments reduce term and 11 reduce installment) | core `test/explain` green, `copy.shape.test.js` and the node16 source list updated for the new keys and files | None needed |
| S3a.3/4 | goldens for both topics and the mortgage and 0 % fixtures added to `render.property.test.js` | `functions/nia/debt/explain` green; `flow.test.js` fallback case moved to the next topic with no template | None needed |
| S3b.1/2 | `paraphrase.test.js` (16 cases) written first; run: the suite failed to load (`./paraphrase.js` missing), the right reason | after `paraphrase.js`, `flow.js` and `handler.js`: 15 of 16 passed; the 16th exposed a wrong test expectation (see deviations); 16/16 after the fix. `functions/nia` 733/733, full suite 2,420/2,420 | None needed |

Triangulation: flag parsing (5 on spellings, 9 off values), flag off (missing, false, the string `'true'`) makes no call, faithful reply keeps the exact footer, the prompt carries `text` and never `numbers` or the footer, invented 42 %, 28,32 changed to 28,23, three spelled-out numbers, the 1,200 cap at the exact boundary (fits, one over, 1,300), Gemini throw, timeout and six unusable answers, aproximado dropped and kept, generic, under review and not applicable send no call, and the handler path (default one call, on two calls, rejected, throwing and hanging all send the flag-off text byte for byte).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/explain functions/nia/debt/explain` exit 0: 16 files, 279 tests passed (`paraphrase.test.js` 16) |
| Runtime harness | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` exit 0 (14 keys listed as unreviewed; `functions/nia.tar.gz` written); plain `npm run package:nia` exit 1 listing the same 14 keys. `node scripts/check-explain-copy.mjs --print` exit 0 prints the 14 draft entries for gate G.1 |
| Full suite and build | `npm test -- --maxWorkers=4`: 143 files, 2,420 tests passed; `npm run build` exit 0 |
| Rollback boundary | core `explain/facts/{restructure,prepayment}.js`, their two builders in `explain.js` and the S3 entries of `copy.js`; Nia `render.js` two templates and the Ley 546 sentence; `explain/paraphrase.js`, `explainReplyParaphrased` in `flow.js`, the one call in `sendExplain` (`handler.js`), `explainParaphrase` in `index.js` and its README row. Read-only feature, no data written. Reverting only S3b restores the template-only reply |

### Deviations from design

- The guard also accepts the figures of the rendered template body (law numbers such as 1555, 546, 880, 2012 and 1999 come from the reviewed copy, not from `facts`), because otherwise a faithful paraphrase of the Ley 1555 text would always be rejected. The figures of the debt name are allowed too. Number words stay rejected.
- The S3b.1 test expected `28,32 % efectiva anual` to be accepted unlabelled, but the core marks that rate conversion `approximate: ['ea']` and the spec says estimated figures MUST be labelled aproximado. The rule is now: if a reply states a figure whose key is in `facts.approximate` it must carry the word aproximado; the test reply was changed to `... (aproximado).` and still proves that 28,32 changed to 28,23 is rejected.
- The paraphrase works on one rendered part at a time (so Ver mas pages are reworded separately and keep the same buttons) and only for `status: 'ok'`. The reply cap is 1,200 minus the footer (source line and disclaimer, kept byte for byte), so the whole message never passes 1,200 characters.
- The design names `guardParaphrase`; it is called directly with `maxChars = 1200 - footer - 2`, so there is no new wrapper.
- The environment variable is `NIA_EXPLAIN_PARAPHRASE` (the design only names `config.explainParaphrase`); only `true`, `1`, `on` and `yes` enable it. `paraphraseExplain` requires the boolean `true` in the config, so a stray string never turns it on.
- The new `index.test.js` case (flag on, under-review topic, still two prompts) is a characterization test and passed before the wiring: the entry point does not pass `explainCopy` yet (gate G), so every topic is under review there and the flag cannot be observed end to end until then. The flag path is proven in `paraphrase.test.js` through `handleDebt`.

### Issues found

- Enabling the flag adds a third Gemini call per explanation (NA3 forbids it by default), so it ships off and enabling it is the owner decision after gate G.
- Gate G.1 is open: the owner reviews the 14 draft entries (`node scripts/check-explain-copy.mjs --print`) and sends back the approved keys. The paraphrase prompt asks for 800 characters, which is only a hint: the guard enforces the cap.

### Remaining

S4 to S7 and gate G (owner copy review G.1 to G.3 blocks the first deploy of S1 to S3).

## Batch S4 (terms_correction: core event, replay, preview, web Corregir datos): COMPLETE (15/15 tasks; the checkpoint S4.CP is the owner deploy and stays open)

S4 branch: `feat/ndg-s4-terms-correction` (from master 0cad81b). S4 has no dependency on S1 to S3; it was applied after S3 as planned.

### Tasks

- [x] S4a.1 to S4a.2 (`ledger/correction.js` with `applyCorrection`, `buildCorrection`, `versionTermsAt`, `checkCorrection`; kind `terms_correction` and the strict writer in `events.js`; barrel and node16 list)
- [x] S4a.3 to S4a.4 (`project.js` folds the opening corrections into the base terms, strips them and adds `projection.corrections` only when non-empty; `tail.js` `applyRestructure` folds the bound ones; `terms_correction_skipped` notices)
- [x] S4a.5 (characterization: a bundle that does not know the kind projects on the original terms with `unknown_event_kind`, and a void of the correction has no effect)
- [x] S4a.6 to S4a.7 (`previewChange` accepts `terms_correction`: `corrected`, `impacted`, `statements`; `planCommit` applies the correction before projecting)
- [x] S4b1.1 to S4b1.2 (`termsCorrectionModel.js`: prefill from the terms version, validation messages, draft through `buildCorrection`, rows, EA echo, impacted, statement warning)
- [x] S4b1.3 to S4b1.4 (`eventSummary.js` summary, `debtDetailModel.js` `VOIDABLE` and `PLAN_CHANGE_KINDS`, `EventHistory.jsx` label, `VoidDialog.jsx` confirmation)
- [x] S4b2.1 to S4b2.2 (`TermsCorrectionDialog.jsx` through `useCommitDialog`)
- [x] S4b2.3 to S4b2.4 (menu item, `DebtDetail.jsx` prop, `DebtDetailContainer.jsx` save and void with `afterSave: reconcileAfter`)
- [ ] S4.CP checkpoint: tests, build and package are green (below); the owner deploys the web build and the Nia tarball together (action 4). Not done here.

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| e446969 `feat(ledger): add the terms_correction event and buildCorrection with typed errors` | S4a (1/2) | 8 files, 502 insertions, 2 deletions |
| 89c187a `feat(ledger): replay terms corrections retroactively and preview them with the impacted costs` | S4a (2/2) | 7 files, 421 insertions, 26 deletions |
| 64db2e7 `feat(debts): model the Corregir datos form and summarize and void terms corrections in the history` | S4b1 | 13 files, 462 insertions, 7 deletions |
| 2e76c0a `feat(debts): add the Corregir datos dialog and wire it with reconcile and void to the debt detail` | S4b2 | 10 files, 433 insertions, 19 deletions |

Code total vs master before the bookkeeping commit: 35 files, 1,817 insertions, 53 deletions = 1,870 changed lines (budget 2,000; each group at most 504; the size-review trigger of 1,500 was crossed only by the last group, which was the slice's last). The slice came to 1,870 against 1,500 estimated (1.25x). S4a was split in two commits because it measured 944 lines (the group limit is 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| S4a.1/2 | `correction.test.js` (17 cases) and the node16 source list and barrel exact keys written first: the suite failed to load (`correction.js` missing) and both node16 tests failed | 17/17 after `correction.js`, `events.js`, `terms.js`, `commit.js` and the barrel (one assertion about the projection moved to the replay test, where it belongs) | `normalizeCorrectionFields` kept in `events.js` and `termsOfDebt` moved to `terms.js` to avoid an import cycle |
| S4a.3/4 | `project.correction.test.js`: 13 of 18 failed (the 5 that passed are the no-correction and voided baselines) | 16/18, then the restructure-bound case exposed a real bug (normalizing an event again drops the `corrections` field), fixed with `attachBound` after the sort; the other two failures were wrong expectations in my tests (a restructure tail depends on the carried interest; card mora needs a late policy in the fixture). 19/19, all core suites 755/755 with `project.parity` and `project.test` untouched | None needed |
| S4a.5 | characterization written against a mocked reader that hides the kind: passes on arrival by design | 16/16 in `events.forward.test.js` | None needed |
| S4a.6/7 | 7 of 8 new `previewChange: terms_correction` cases failed (kind refused) | 7/8, the last failed on a wrong assumption about `nextDueOn` of a card; compared with a natively built debt instead. Core 766/766 | None needed |
| S4b1.1/2 | `termsCorrectionModel.test.js` (17 cases): module missing | 17/17 first run | None needed |
| S4b1.3/4 | 10 cases failed across `eventSummary`, `debtDetailModel`, `EventHistory` | 66/66 in the three files plus `VoidDialog` | None needed |
| S4b2.1/2 | `TermsCorrectionDialog.test.jsx` (12 cases): module missing | 12/12 first run | `BackdatedNotice` got optional `title` and `intro` instead of a copy |
| S4b2.3/4 | 16 cases failed (menu lists, flows in both containers) | 13 passed after the wiring; the 3 left were test fixes (arrow-key wrap now ends on index 4, a region hidden by the open modal, the rate text is `24 % E.A.`). `src/features/debts` 595/595 | None needed |

Triangulation: opening and restructure-bound corrections, two corrections and a void of the second, void restores the pre-correction projection (loan and card, deep-equal), 30 and 20 seeded shuffles, a void dated after `asOf`, a stored correction on the wrong kind, a stored correction with a field a newer build added, corrected statement day 20, 30 and 31 with month-end clamps, minimum pct 5 to 3 with past-due flag and mora, no-change per field and for the whole draft, six unsupported fields, three empty shapes, out-of-range days, NAMV against EA, modality, impacted rows against natively built debts, preview against `planCommit` snapshot for a card and a loan, statements drift 2/0/none, form prefill from the version and not from a later rate change, loan without card fields, double submit, write failure with retry, reconcile failure.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/ledger packages/finance-core/test/node16.test.js src/features/debts` exit 0 (core 766 tests in 48 files; `src/features/debts` 595 tests in 41 files) |
| Runtime harness | `npm run build` exit 0; `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` exit 0 (14 draft keys listed, `functions/nia.tar.gz` written with the S4 core inside, so the tarball reads corrections). The mocked-port container tests write through the real `planCommit`/`commitPlan`/`saveDebtEvent` path |
| Full suite | `npm test -- --maxWorkers=4`: 147 files, 2,516 tests passed |
| Rollback boundary | core `ledger/correction.js`, the `terms_correction` kind and `normalizeCorrectionFields` in `events.js`, the fold hooks in `project.js` and `tail.js`, the kind in `preview.js` and `commit.js`, `termsOfDebt` in `terms.js`, the two barrel exports; web `termsCorrectionModel.js`, `TermsCorrectionDialog.jsx`, the menu item and the container hook, the `terms_correction` entries of `debtDetailModel.js`, `eventSummary.js`, `EventHistory.jsx`, `VoidDialog.jsx`, `debtLabels.js`. Before reverting, void any correction whose old values must not reappear silently |

### Deviations from design

- The barrel exports `versionTermsAt` as well as `buildCorrection`. The dialog has to prefill from the terms version in force (a loan's `projection.terms` carries later rate changes), and the design says to compare with version terms, so the web needs that getter. The exact-keys list was changed RED-first.
- `normalizeCorrectionFields` lives in `events.js` (internal export) and `termsOfDebt` moved to `terms.js`, so `events.js`, `correction.js` and `project.js` have no import cycle.
- Restructure-bound corrections are attached to their restructure event after the sort (`attachBound`), because normalizing an event again drops fields it does not know. `applyRestructure` folds `event.corrections` as designed. They are validated against the restructure terms before they are attached.
- `readEvents` tolerates a `terms_correction` row whose payload does not validate (a newer build may add correctable fields): it is set aside with the validation code as `reason` and `project` reports `terms_correction_skipped {eventId, reason}`. Writers stay strict. Other skip reasons are `invalid` (the fold fails) and `restructure_voided`.
- Beyond the four typed errors of the task, a draft bound to a restructure that does not exist or was voided throws `correction_target_missing`.
- `planCommit` does not reject `no_change` (only `buildCorrection` does), so re-planning a request that was already saved stays idempotent.
- The preview also returns `statements: { recorded, drifted }` (the recorded card statements and those whose drift the correction changes) for the warning.
- In the web, `terms_correction` is also in `BLOCKS_RESTRUCTURE_VOID`: a restructure cannot be voided while an active correction sorts after it, because voiding it would orphan the correction. The void dialog names it («la corrección de datos»).
- The modality names shown in the dialog («Consumo», «Bajo monto», «Productivo»...) are new copy: the web had no labels for the legal modalities. Review the wording before the deploy.
- `BackdatedNotice` takes optional `title` and `intro` so the dialog can say it in its own words.

### Issues found

- Nia is not touched in S4 (its preview of a correction is S6). A Nia tarball packaged now already reads corrections because it bundles the core; the deploy of the web build and the tarball together (owner action 4) is still open.
- The `terms_correction_skipped` notice is produced by the core but the web has no copy for it yet (it is ignored by `LateNotices`).
- The statement warning counts `adjustment` events dated up to the reference day only.

### Remaining

S5 to S7 and gate G. S4.CP (owner deploy of web and Nia together) is not part of this batch.
