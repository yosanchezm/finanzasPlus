```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3ee49fa6022c680d05660442fadd36189e4bd51332b4ac44672e5d1b461cea65
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 44/44
scenarios: 106/106
test_command: npm test -- --maxWorkers=4
test_exit_code: 0
test_output_hash: sha256:3f3074aa431bfc9b53daee4d2243953c66e99586629927bb9e22e68ac237f70a
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:27fa985bfe7e4f35c775406476c46c175e32a7c3d645fa308dd7abcf951df973
```

## Verification Report

**Change**: nia-debt-guide
**Version**: N/A (6 delta specs: debt-explanations, debt-ledger, credit-card-debt, debt-web-management, nia-debt-advisor, nia-debt-assistant)
**Mode**: Strict TDD (Vitest, `npm test`)
**Scope**: `git diff 72964af^..master` (HEAD `8a081c74dafa60256de95b23476452fb76678c9f`): 49 commits, 137 files, +14,972 / -223
**Artifact store**: openspec (Engram not available)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 100 |
| Tasks complete | 95 |
| Tasks incomplete | 5 |

The 5 unchecked tasks are all owner or operator actions that are not automatable: `G.3` (operator packages without the override and uploads the tarball), `S4.CP` (owner deploys web and Nia together, owner action 4), `S5.CP` (owner action 5), `S6.CP` (owner action 6, after the S4 web is live), `S7.CP` (owner action 7: web, then Nia tarball). All five are documented in `tasks.md` ("Owner actions", gate table) and in `docs/deploy.md`. Their test, build and package steps were run green by this verification. They are not CRITICAL.

### Build & Tests Execution

**Tests**: PASS. `npm test -- --maxWorkers=4` exit 0: **157 files, 2,829 tests passed, 0 failed, 0 skipped** (114.75 s). No `App.test.jsx` jsdom timeout occurred, so no re-run was needed.
Changed-file subset (57 test files created or modified by this change, run separately with the JSON reporter): 1,453 tests passed, 0 failed, 0 pending.

**Build**: PASS. `npm run build` exit 0. It now runs `node scripts/check-explain-copy.mjs` first ("Explain copy check passed: 14 keys are reviewed.") and then `vite build` (2,648 modules). Only the pre-existing chunk-size warning was printed.

**Package**: PASS. Plain `npm run package:nia` (no `NIA_ALLOW_UNREVIEWED`; the variable was confirmed unset) exit 0, `functions/nia.tar.gz` written. The tarball is git-ignored (`functions/*.tar.gz`). Output hash sha256:65bdc5e371f50495aff1e995109d1a1f783cf06732f86608c2f61abb4cfe1218.

**Gate behaviour proven at runtime (scratch copy, source untouched)**: a copy of `scripts/` and `packages/finance-core/` in the scratchpad with one character of the `legal.gmf` text changed gave: `check-explain-copy.mjs` exit 1 listing `unreviewed (1): legal.gmf`; `package-nia.mjs` exit 1 with the same message (no tarball); the same check with `NIA_ALLOW_UNREVIEWED=1` exit 0 with a visible `WARNING`. This proves the hash un-reviews a silent edit, and that packaging and (by the `&&` in the `build` script) the web build refuse unreviewed copy.

**Coverage**: Not available (no coverage provider installed). **Linter**: not available. **Type checker**: not available (no `tsconfig`/`jsconfig`). None of these is a failure.

**Hygiene**: no `Co-Authored-By` or AI attribution in any commit body since 72964af (`git log 72964af^..master --format=%B | grep -i co-authored` is empty); no secret-like literal in the added diff lines; no tracked `*.tar.gz`/`*.tgz` and nothing tracked under `node_modules/`; no Appwrite migration or schema file touched (`debt_events.kind` stays `string(24)`). Untracked and not part of the change: `.claude/` and `scripts/spike-transactions.mjs`.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Pass | "TDD Cycle Evidence" tables exist in every apply-progress batch (S0, S1, S2, S3, S4, Gate G, S5a+b, S5c, S6, S6x, S7) |
| All tasks have tests | Pass | every RED task names an existing test file; docs-only tasks (S0b.9, S7b.2 docs) are explicitly "no test" |
| RED confirmed (tests exist) | Pass | all referenced test files exist and are part of the 57 files re-run |
| GREEN confirmed (tests pass) | Pass | 1,453/1,453 in the changed files; 2,829/2,829 in the full suite |
| Triangulation adequate | Pass (with note) | triangulation is listed per batch in prose (goldens plus seeded property tests plus many edge cases); the table has no dedicated "Triangulate" column |
| Safety Net for modified files | Warn | there is no "Safety Net" column; the batches state that existing suites ran unchanged and list which old tests were edited and why (S0a.4 guard cap, S1b fallback case, S2 `copy.shape`, Gate G expectations). Not a per-task table |

**TDD Compliance**: 5/6 checks fully met, 1 met in substance but not in the prescribed column layout (WARNING W9).

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit (core and Nia pure modules, models) | 953 | 43 | Vitest (`// @vitest-environment node` in the core) |
| Integration (RTL views and dialogs, `world()` handler flows, entry point `index.test.js` with faked Appwrite, Telegram, Gemini) | 470 | 12 | Vitest + jsdom + Testing Library |
| Scripts (check and packaging) | 30 | 2 | Vitest, child processes |
| E2E | 0 | 0 | not installed |
| **Total** | **1,453** | **57** | |

### Assertion Quality
- Tautologies (`expect(true).toBe(true)` and similar): none found.
- Ghost loops: the only loops over collections that contain assertions iterate non-empty fixed lists (`EXPLAIN_TOPICS` minus two, `Object.values(spies)`); none can be empty.
- `toEqual([])` assertions (write logs, empty issue lists) are negative checks that sit next to non-empty companions in the same files (writes happen in the Confirm tests, issues appear in the rejection tests).
- Type-only assertions: the `not.toBeNull()` checks in `guard.test.js` (about 7) and `propose.test.js` (3) assert that a faithful paraphrase or a draft is accepted without asserting its value. They are paired with value-asserting rejection tests, so they are weak but not trivial (SUGGESTION S2).
- Mock-heavy: `vi.mock` appears only in `index.test.js` (2), `DebtDetailContainer.test.jsx` (1) and `DebtDetailContainer.card.test.jsx` (1); none exceeds 2x its assertions.
- Property tests (`render.property.test.js`, seeded `mulberry32`) were mutation-checked by the apply phase (a literal digit and a spelled number added to a template turned all seeds red).

**Assertion quality**: 0 CRITICAL, 0 WARNING, 1 SUGGESTION.

### Spec Compliance Matrix

Totals counted from the spec files: **44 requirements, 106 scenarios** (debt-explanations 13/24, debt-ledger 6/16, credit-card-debt 2/6, debt-web-management 4/11, nia-debt-advisor 9/17, nia-debt-assistant 10/32). Every scenario has a covering test that passed at runtime in the full run (2,829/2,829). A scenario is shown as compliant only with a named covering test.

#### debt-explanations (13 requirements, 24 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| DE1 Closed topic catalogue | Unknown topic; Topic not applicable | `explain/topics.test.js` ("closed catalogue of nine topics, in order", "rejects an unknown topic with the valid topics", "answers not applicable with no figures"); `flow.test.js` applicability replies | COMPLIANT 2/2 |
| DE2 Facts from code | Property of rendered numbers; No debt | `render.property.test.js` (4 seeds x 7 topics x debts x dates; every number in `allowedTexts`, no `NUMBER_WORDS`, parts <= 1,200, guard accepts); `facts.mora/usury/charges` generic cases | COMPLIANT 2/2 |
| DE3 Source line and disclaimer | Footer present; Estimate labelled | `render.test.js` goldens (exact footer and disclaimer, aproximado on card mora and what-if); `popoverModel.test.js` pins the web disclaimer to the Nia one | COMPLIANT 2/2 |
| DE4 Reviewed constants and gate | Missing review date; Reviewed constant | `topics.test.js` (missing key, no hash, edited text or source all unreviewed), `copy.shape.test.js`, `copy.release.test.js` (16 tests, `releasedTopics()` is the full catalogue), `scripts/check-explain-copy.test.mjs` (13), handler and flow released and under-review cases; runtime scratch simulation above | COMPLIANT 2/2 |
| DE5 Rate conventions | NAMV; Monthly rate | `facts.rates.test.js` (25.2 % NAMV -> 2.1 % MV -> 28.32 % EA; stated 2.1 % MV -> 28.32 %) + render golden | COMPLIANT 2/2 |
| DE6 Usury and IBC | Stale cap; Mortgage | `facts.usury.test.js` ("carried-forward cap with a stale warning and never blocks", "explains Ley 546 for a mortgage without computing anything"), IBC 19.06 -> 28.59 golden | COMPLIANT 2/2 |
| DE7 Mora | Loan mora; Card mora | `facts.mora.test.js` (199,505 x 10 days = 1,375; card 125,000 x 10 days = 861 approximate) + render goldens | COMPLIANT 2/2 |
| DE8 Payment allocation | Short payment; Payment with mora | `facts.allocation.test.js` (10,000 / 90,000 / 0; 10,000 / 1,375 / 88,625 / 0; full installment 10,000 / 1,375 / 180,876 / 198,130) | COMPLIANT 2/2 |
| DE9 Charges | Fee and IVA; GMF | `facts.charges.test.js` (IVA 8,550; GMF 400,000 -> 1,600; generic IVA 1,900), `chargePresets.test.js` | COMPLIANT 2/2 |
| DE10 Card topics | Revolving; Paid in full | `facts.card.test.js` (300,000 revolving; paid in full base 0; 10,392 -> 9,526; what-if 475,000 / 9,873), `card/card.base.test.js` | COMPLIANT 2/2 |
| DE11 Restructure and prepayment | Restructure what-if; Prepayment | `facts.restructure.test.js` (391,756 / 390,381), `facts.prepayment.test.js` (8 x 100,000 vs 11 x about 72,727; Ley 1555 threshold 1,540,796,400) | COMPLIANT 2/2 |
| DE12 Length and splitting | Long topic | `render.test.js` splitter (2,500 characters, parts <= 1,200, no number cut), `flow.test.js` paging | COMPLIANT 1/1 (see W2: footer on every part) |
| DE13 Optional paraphrase | Paraphrase rejected | `paraphrase.test.js` (16: flag off makes no call, faithful, invented 42 %, 28.32 -> 28.23, spelled number, over cap, Gemini failure and timeout) | COMPLIANT 1/1 |

#### debt-ledger (6 requirements, 16 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| DL1 Terms correction event | Valid card correction; Field not applicable; Unsupported field; No change | `ledger/correction.test.js` (day 15 -> 20 accepted; loan + statement day refused; six unsupported fields; `no_change`; empty and out-of-range; payload fits limit) | COMPLIANT 4/4 |
| DL2 Retroactive replay | Rate convention corrected; Later rate change intact; Two corrections | `project.correction.test.js` ("replays as if the corrected rate held from the first installment, whatever the event date", "keeps a rate_change recorded before the correction: still 22 % EA", second wins and void restores first, shuffled storage order); `correction.test.js` (25.2 % NAMV = 2.1 % per month, EA about 28.32 %) | COMPLIANT 3/3 |
| DL3 Preview | Preview equals saved result; Impacted past costs | `ledger/preview.test.js` ("equals the projection after the event is saved (card and loan)", "lists a payment recorded under the wrong minimum with its cost before and after") | COMPLIANT 2/2 |
| DL4 Void, reconcile, summary | Void restores; Summary | `project.correction.test.js` (void equals pre-correction projection, deep-equal), `eventSummary.test.js`, `DebtDetailContainer.test.jsx` (reconcile after void) | COMPLIANT 2/2 |
| DL5 Older bundles skip | Old core | `events.forward.test.js` (characterization: a reader that hides the kind projects on original terms with `unknown_event_kind`, void has no effect; loan and card) | COMPLIANT 1/1 (simulated, see W10) |
| DL6 Append-only (MODIFIED) | Correction by void; Family loan without plan; Late policy append-only; Terms correction append-only | pre-existing `events.test.js`, `project.test.js`, `project.late.test.js` (unchanged and green) + `project.correction.test.js` (second correction appends, first unchanged) | COMPLIANT 4/4 |

#### credit-card-debt (2 requirements, 6 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| CC1 Revolving and excluded base | Revolving balance; Paid in full; Additive only | `card/card.base.test.js` (300,000 revolving; 800,000 paid in full gives revolving 0, excluded 800,000, interest 0; F3 fixture keeps every old field; non-negative integers over random cards) | COMPLIANT 3/3 (see W3: equality is within 1 minor unit) |
| CC2 Corrected card terms | Corrected statement day; Corrected minimum rule; Correction voided | `project.correction.test.js` (re-cuts and clamps at month end; 5 % -> 3 % recomputes minimums, past-due and mora; void equals pre-correction) | COMPLIANT 3/3 |

#### debt-web-management (4 requirements, 11 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| WM1 Correct data dialog | Card correction preview; Loan fields; No change; Double submit; Save error | `TermsCorrectionDialog.test.jsx` (12), `termsCorrectionModel.test.js` (17), `DebtDetailContainer.test.jsx` ("creates one terms_correction when the save button is tapped twice") | COMPLIANT 5/5 |
| WM2 History, void, reconcile | Summary; Void with reconcile | `eventSummary.test.js` (exact summary line for day 15 -> 20 and minimum 5 % -> 3 %), `EventHistory.test.jsx`, `DebtDetailContainer.test.jsx` ("voids it after confirming, reconciles ... and reports that two rows were updated") | COMPLIANT 2/2 |
| WM3 Explain popovers | Open popover; Unreviewed topic | `WhatIsThis.test.jsx` (Enter, Space, Escape, focus return), `popoverModel.test.js` (mora with disclaimer, hidden for unreleased), `DebtDetail.test.jsx`, `DebtDetail.card.test.jsx` and `DebtDetailContainer.test.jsx` explain blocks (port spies: no writes) | COMPLIANT 2/2 |
| WM4 More-actions menu (MODIFIED) | Loan menu; Card menu | `MoreActionsMenu.test.jsx` (five actions with Corregir datos before Reestructurar; card omits Reestructurar) | COMPLIANT 2/2 |

#### nia-debt-advisor (9 requirements, 17 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| ADV1 Proposal read-only and complete | Proposal without writes; Open question | `advisor/propose.test.js` (pure, frozen inputs), `handler.test.js` "setup: the proposal (read-only)" (15; zero writes, no Confirm keyboard while a blocking question is open) | COMPLIANT 2/2 |
| ADV2 Charge presets | Fee plus IVA; Missing amount; GMF | `chargePresets.test.js` (22), `propose.test.js` (IVA 8,550 `pctOfCharge` 19 linked, `amount:life` question and no draft, GMF 1,600) | COMPLIANT 3/3 |
| ADV3 Convention echo and mora default | Echo; Missing convention; Mora default | `propose.test.js` (about 28.32 % EA echo, a bare monthly rate asks the convention before any preview, `mora_default_usury` assumption) | COMPLIANT 3/3 |
| ADV4 Card proposal | Bancolombia card; Unknown statement day | `propose.test.js`, `cardTerms.test.js`, `handler.test.js` (asks statement day, due day and rule; unknown after one ask blocks and names the missing data) | COMPLIANT 2/2 (see W4, W5) |
| ADV5 Exactly one write | Card creation | `handler.test.js` "commit a described setup" (8) and the index golden: Confirm twice leaves one `debts` row `db{id}`, no event, second reply says already recorded; a loan writes row plus `disbursement` only | COMPLIANT 1/1 |
| ADV6 Adjustment checklist | Wrong statement day; Real rate drop | `propose.test.js` adjust (12): "it was always the 20th" gives `terms_correction`, "the rate dropped last month" gives `rate_change`, ambiguous asks `nia:adj:fix` or `nia:adj:change` | COMPLIANT 2/2 (see W7) |
| ADV7 Sequential chain | Two steps; Cancel mid-chain | `advisor/chain.test.js` (8), `handler.test.js` chain cases (fresh pending id and `dedupeKey` per step, `nia:confirm:<id>`, a double tap is answered as already recorded, failed step stops and reports, cancel at step 2 of 3 reports 1 done and 2 not run, each pending <= 1.5 KB) | COMPLIANT 2/2 |
| ADV8 Unsupported fields | Card limit | `advisor/unsupported.test.js`, `propose.test.js` (limit, advance rate, `prepaymentPenaltyPct`, `allocationOrder`, mora base: not supported yet, nothing written, `limitMinor` never extracted) | COMPLIANT 1/1 |
| ADV9 No extra model calls | Call budget | `handler.test.js`, `index.test.js` (prompt count <= 2 on every advisor turn; `nia:other:new` and `keep` make no call) | COMPLIANT 1/1 |

#### nia-debt-assistant (10 requirements, 32 scenarios)
| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| NA1 Explain action and topic selection | Stated topic; No topic | `extract.test.js` (closed `topic` enum, unknown gives no topic), `handler.test.js` (menu with one button per topic, zero writes; stated 25.2 % NAMV) | COMPLIANT 2/2 |
| NA2 Glossary router | Override; Payment kept; Non-debt glossary | `router.test.js` (47), `index.test.js` (a mora question classified as `conversation` is handled as explain `mora`; a payment of the mora stays a payment; a stock-market question stays chat); also probed live in this verification | COMPLIANT 3/3 (see S1) |
| NA3 Explain read-only and session-safe | Pending survives; No writes | `handler.test.js` "keeps a pending payment: the same pending is saved and the later Confirm writes once", "keeps the pending that was waiting"; zero `createRow`, `updateRow`, `deleteRow` spies; at most 2 Gemini calls | COMPLIANT 2/2 |
| NA4 Stateless buttons and marker | Longest callback; Stale or foreign button; Follow-up | `pending.test.js` (`card_interest_drop` + 36-character id <= 64 bytes, page form drops the id to `-`), `handler.test.js` (deleted debt, debt of another member personal scope, unknown topic: short safe reply, zero writes; marker written in the last assistant entry only; example follow-up reuses the marker) | COMPLIANT 3/3 |
| NA5 Card creation and presets in extraction | Card create; Dangling reference | `extract.test.js` (setup and card create, `pctOfCharge` + `refLabel`, nulls never defaulted), `propose.test.js` (dangling `refLabel` rejected), commit tests (one debt) | COMPLIANT 2/2 |
| NA6 Terms correction action | Statement day; Unchanged value | `functions/nia/debt/correction.test.js` (15 -> 20, retroactive note, impacted note, rebuilt at Confirm; unchanged value says nothing changes and refuses) + handler commit cases | COMPLIANT 2/2 |
| NA7 Debt intent, extraction only (MODIFIED) | Pay request; Invalid extraction; New action needs confirmation; Explain needs no confirmation | pre-existing `extract.test.js` and `handler.test.js` pay and invalid cases (green) + new `terms_correction`, `setup`, `explain` cases; `index.test.js` /ayuda lists the capabilities | COMPLIANT 4/4 |
| NA8 Rate and charge change actions (MODIFIED) | Rate change with mode; Remove a charge; Add a charge; Add fee with IVA; Backdated note | pre-existing rate and remove cases (green); `planChange.test.js` (add preset or explicit, one `charge_change`, IVA 8,550 linked, backdated note) | COMPLIANT 5/5 |
| NA9 Conversation callbacks (MODIFIED) | Convention on rate change; Stale button; Explain button without pending | `handler.test.js` and `index.test.js` (`nia:conv` through `CONVENTION_NEXT`, stale `nia:mode`, `nia:min`, `nia:adj`, `nia:other` ignored with no write, `nia:exp` routed before the stage check) | COMPLIANT 3/3 |
| NA10 Paraphrase guardrail (MODIFIED) | Invented number; Changed digit; Spelled-out number; Over-long; Faithful; Gemini failure | `guard.test.js` (35), `paraphrase.test.js`, `replies.advice.test.js`; also probed live (28,23 rejected; cuatro por mil, veintiocho, un millon, doble rejected; 1,201 rejected and 1,200 accepted; un and una accepted) | COMPLIANT 6/6 |

**Compliance summary**: 106/106 scenarios compliant (0 untested, 0 failing). 44/44 requirements implemented.

### Correctness (Static Evidence)
| Area | Status | Notes |
|---|---|---|
| Explain is read-only | Implemented | `sendExplain` only reads (`loadEvents`, `explainFacts`) and calls `say`, which saves the session with `pending: ctx.previous`; no `createRow`, `updateRow` or `deleteRow` in `functions/nia/debt/explain/` |
| Glossary interception | Implemented | `index.js` L1085-1091: router runs only for `conversation` or `analysis`, no attachment; write-verb veto; marker rule |
| Stateless `nia:exp` buttons | Implemented | routed before the stage check (`index.js` L1193); `button()` asserts 64 bytes; marker read from the last assistant entry only |
| Hardened guard | Implemented | `NUMBER_WORDS`, `MAX_REPLY = 1200`, applied to all paraphrases |
| Copy gate | Implemented | missing key counts as unreviewed; `copyHash` over text and sources; `checkExplainCopy` in `package-nia.mjs` (L99) and as first step of `build`; override documented in `docs/deploy.md` and `functions/nia/README.md` |
| Shared facts and presets | Implemented | web popovers import `explainFacts` from `@finance-core`; no legal wording in `popoverModel.js` or `WhatIsThis.jsx`; `chargePresets.js` is used by the web wizard (`cardCharges`) and by Nia |
| Advisor create and adjust never auto-apply | Implemented | every path ends in a pending and `nia:confirm`; no Confirm while a blocking question is open |
| Exactly-once | Implemented | `writeNewDebt`: a card writes only the debt row `db{id}` (409 means duplicate); a loan writes the row plus a `disbursement` keyed by `debt:{pendingId}` |
| Chain | Implemented | per-step fresh pending id, `nia:confirm:<id>`, stop-and-report on failure or cancel |
| `terms_correction` | Implemented | version-bound (`appliesTo`), folded in `project.js` and `tail.js`, stripped from the projector input, skipped with a notice by older bundles, voidable, previewed with `corrected`, `impacted`, `statements` |
| Card exposure | Implemented | `revolvingBaseMinor`, `excludedBaseMinor`, `lateExcludedBaseMinor` additive in `closeCycle` |
| Node16 safety | Implemented | core: `node16.test.js` source scan lists every new core file and no forbidden API appears in `packages/finance-core/src` or `functions/nia/debt` (grep clean); Nia: `package:nia` bundle scan plus `scanSourceDirs` on `explain` and `advisor` |
| Docker | Implemented | `.dockerignore` excludes only `functions`, `docs`, `Dockerfile`, `.dockerignore` (keeps `packages/` and `scripts/`), pinned by a test in `src/test/financeCoreAlias.test.js`; the `Dockerfile` copies `.` before `npm run build` |

### Coherence (Design)
| Decision | Followed? | Notes |
|---|---|---|
| G1 facts and copy in the core, templates in Nia | Yes | web renders its own short JSX over the same facts |
| G2/G3 routing, extraction wins over the hint | Yes | `handler.test.js` "lets a write action of the extraction win over the explain hint (G3)" |
| G4 marker in history | Yes | `lastExplain` reads only the last entry; also carries `stated` and `amountMinor` (additive) |
| G5 stateless buttons | Yes | |
| G6 length and splitting | Yes, with a deviation | footer on every part (W2) |
| G7 hardened guard | Yes | |
| G8 copy gate | Yes | the hash is `copyHash(entry)` (text, newline, label and url lines), not literally `text + sources`; it matches what the gate verifies |
| G9-G11 correction semantics, strip, strict writer | Yes | plus `correction_target_missing` and a tolerant `readEvents` for payloads written by a newer build |
| G12 presets | Yes | |
| G13 extraction-first advisor | Yes, extended by S6x | the "Es otra deuda?" follow-up is an owner decision that changes G13 for a different lender, stated kind or `debtRef` |
| G14 chain | Yes | |
| G15 card creation | Yes | |
| Migration | Yes | no schema change |

### Known deviations: classification
| # | Deviation | Class | Reason |
|---|---|---|---|
| 1 | Footer on every part (spec DE12: footer on the last part) | acceptable-documented | design G6 and tasks S1b.2 prescribe it; only one part is sent per message, so each message ends with the source and disclaimer. Reconcile the spec wording at archive (W2) |
| 2 | `revolving x rate` may differ from the interest by at most 1 minor unit | acceptable-documented | `lateExcludedBaseMinor` is rounded to whole units while the statement interest stays unrounded so existing values do not change (spec: existing values MUST NOT change); the seeded property asserts the bound (W3) |
| 3 | Pct minimum with no stated pct defaults to 5 % and is listed as `min_pct_5` | acceptable-documented, owner to acknowledge | the minimum rule itself is never defaulted and Confirm is blocked until it is answered; the 5 % is shown in the assumptions before any write (W4) |
| 4 | Card opening balance of zero (`opening_zero` assumption) | acceptable-documented | mirrors the web, which never asks for a card opening balance (W5) |
| 5 | `answersOpenSetup` backstop in `index.js` (up to 160 characters, a digit or "no se", classified chat or analysis, no attachment, not a glossary question) | acceptable-documented | the classifier is a model, the backstop makes short answers deterministic; it can only route into the advisor, which never writes without Confirm (W6) |
| 6 | Adjust mode depends on the model setting `setup.adjust` and `debtRef` | acceptable-documented | a miss yields a duplicate proposal that still needs its own Confirm; no code guard (W7) |
| 7 | `setup.kindStated` depends on the model | acceptable-documented | a wrong value only causes or skips the "Es otra deuda?" question (W7) |
| 8 | New web and modality wording is outside the copy gate | needs owner action (not a code fix) | the modality names (Consumo, Bajo monto, Productivo, ...), popover titles and short templates are UI wording, not legal copy; the owner should read them before the S4 and S7 deploys (W8) |
| 9 | `buildDebtDetail` runs up to four `explainFacts` per render | acceptable, unmeasured | each call re-projects the debt; the container memoises the detail (S3) |

### Issues Found

**CRITICAL**: None.

**WARNING**:
- W1. The package-level refusal has no regression test any more. After G.2 the shipped copy is reviewed, so the test "package:nia runs the check before building the tarball" now just packages successfully; it still passes if the `checkExplainCopy()` call in `scripts/package-nia.mjs` (L99-101) were deleted. `scripts/package-nia.test.js` L55-56 also still says the copy "is not reviewed yet" and always sets `NIA_ALLOW_UNREVIEWED=1`. The refusal was verified here by a scratch simulation (exit 1), and the unit tests of `checkExplainCopy` and the `build` script string remain, but the design G8 guarantee "package refuses when unreviewed" is guarded only by inspection. Fix: add a test that drives the packaging entry point with an injected unreviewed copy (or an env-pointed copy module) and expects a non-zero exit with no tarball, and refresh the stale comment.
- W2. Spec text for the footer (last part) does not match the delivered and design-approved behaviour (footer on every part). Update `debt-explanations` DE12 at archive, or keep the deviation recorded.
- W3. Spec CC1 says the statement interest MUST equal the rate applied to the revolving base; the delivered contract is within 1 minor unit. Update the spec sentence at archive or accept the recorded gap.
- W4. Owner to confirm the `min_pct_5` default: ADV4 says no provisional values may be saved. It is saved only after Confirm and is visible in the assumptions, but it is a default for a part of the minimum rule.
- W5. Owner to confirm that a new card starting at a zero balance is the intended behaviour (assumption `opening_zero`).
- W6. The `answersOpenSetup` heuristic is a code backstop for a model decision; watch it in the first owner test (short numeric messages while a setup is open).
- W7. Adjust mode (`setup.adjust`, `debtRef`) and `kindStated` rely on model output with no code check. The failure mode is a duplicate proposal or an extra question, never a silent write.
- W8. Owner must read the new web and modality wording before deploying S4 and S7 (outside the copy gate).
- W9. TDD evidence tables lack the Triangulate and Safety Net columns of the strict protocol (the information is in prose).
- W10. DL5 (older bundles skip the correction) is proven by a characterization test that hides the kind from the reader, not against a real older bundle. The release-order rule (deploy web and Nia together) is the real protection and is documented (owner action 4).
- W11. No browser or visual check of the popovers was performed (trigger size, popover width on a phone); no E2E tool is installed.

**SUGGESTION**:
- S1. The router keywords (seguro, cargo, comision, interes) can pull non-debt glossary questions such as "que es un seguro de salud" into the `charges` explanation (the keyword list comes from the design). Consider requiring a debt context for those words, or accept the cheap, read-only false positive.
- S2. In `guard.test.js` and `propose.test.js` replace `not.toBeNull()` positives with exact-value assertions on the accepted reply.
- S3. `buildDebtDetail` (up to four `explainFacts` per render): measure on a long history, or compute a popover lazily when it opens.
- S4. `docs/deploy.md` still says S1 to S3 and S4 to S6 are packaged with the override until G.2, and that without the override the package is rejected as expected until the review. G.2 has landed, so both lines now describe the past; the override-rule paragraph below them is correct.
- S5. `popoverOf` in `popoverModel.js` swallows every error with a bare catch that returns null, which hides a real defect as a missing popover. Consider logging in development.
- S6. The core emits `terms_correction_skipped` but the web has no copy for it (ignored by `LateNotices`), and the statement drift warning counts `adjustment` events only up to the reference day (both recorded by apply).
- S7. Coverage, lint and type-check tools are not installed; adding a coverage provider would let future verifies report changed-file coverage.

### Verdict
**PASS WITH WARNINGS**

All 44 requirements and 106 scenarios have passing covering tests, all gates and goldens are present, the build and the plain package pass, and no CRITICAL issue was found; the five open tasks are owner deploys. Archive is allowed. Before the owner deploys, handle W1 (cheap test), W8 (read the new wording) and W4/W5 (acknowledge two defaults), and sync the two spec sentences (W2, W3) at archive.
