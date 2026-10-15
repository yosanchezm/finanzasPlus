# Tasks: Nia debt guide (explain and configure)

Strict TDD: in every group the `RED` task (failing Vitest test) precedes its `GREEN` task, then `REFACTOR` if needed. Core test files carry `// @vitest-environment node`. The node16 source list (`packages/finance-core/test/node16.test.js`) and the barrel exact-keys test change RED-first in S0a, S1a, S2a, S4a and S5a. Node16 rules for core files: no `Object.hasOwn`, `.at(`, `findLast`, `toSorted`, `toReversed`, `structuredClone`, `groupBy`. Nia files (`functions/nia/`) are plain files tracked by this repository; commit them like any other path.

Requirement codes (used in every task and in the traceability table): DE = `debt-explanations`, DL = `debt-ledger`, CC = `credit-card-debt`, WM = `debt-web-management`, ADV = `nia-debt-advisor`, NA = `nia-debt-assistant`. The numbering follows the order of the requirements in each spec file.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (design, incl. tests) | about 9,650; realistic range 6,800 to 19,300 (past forecasts ran 0.7x to 2x) |
| Per slice (design / worst case at 2x) | S0 1,300/2,600 · S1 1,300/2,600 · S2 900/1,800 · S3 800/1,600 · S4 1,500/3,000 · S5 1,700/3,400 · S6 1,300/2,600 · S7 850/1,700 |
| Slices that can pass 2,000 at 1.5x or more | S0, S1, S4, S5, S6 (see "Size rule") |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 8 stacked slices S0..S7 (18 commit groups plus the gate commit, each at most 800 lines), fast-forwarded into `master` in order by the owner |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: High

Why no decision is needed: `auto-chain` plus `stacked-to-main` are already chosen by the owner, the work unit limit is 2,000 and the commit group limit is 800. The open owner questions (correction semantics, advise paraphrase fallback, stale usury table) have standing assumptions in the design. Three items are not blocking but need attention during apply: (1) the copy gate G needs the owner's time before the first deploy of S1 to S3 (start the review as soon as S3 is committed; S4 can proceed meanwhile), (2) the optional paraphrase of S3b adds a third Gemini call when enabled, which is ruled out by NA3 for explain, so it ships OFF and its enablement is a separate owner decision, (3) from S7a, `npm run build` runs the copy check, so the S7 checkpoint and deploy need gate G done or `NIA_ALLOW_UNREVIEWED=1`.

### Size rule (applies to every slice)

- After each commit group run `git diff --stat`. Every RED+GREEN pair is a valid split point. If a group reaches 800 lines, commit the finished pairs and start the next lettered group.
- If a slice reaches 1,500 lines before its last group, stop and report to the orchestrator for a size review before the next group. Pre-agreed fallback splits: S0 into S0a | S0b; S1 into S1a | S1b; S4 into S4a | S4b; S5 into S5a+S5b | S5c; S6 into S6a | S6b.
- The valve is per group, so no group should exceed 800 even at 1.2x: groups are estimated at 250 to 700 lines.

### Packaging and deploy notes (S0 override)

- Packaging fails by construction until the owner copy review is done, because missing `EXPLAIN_COPY` keys count as unreviewed (design G8).
- **S0 is packaged with the explicit override** `NIA_ALLOW_UNREVIEWED=1`. PowerShell: `$env:NIA_ALLOW_UNREVIEWED='1'; npm run package:nia`. Bash: `NIA_ALLOW_UNREVIEWED=1 npm run package:nia`. S0 releases no topic, so the router answers «Este tema está en revisión» to glossary questions.
- The same override is used by the S1 to S3 and S4 to S6 checkpoints until gate G.2 lands. After G.2 the check passes without the override and the override is never needed again.
- This note is written into `docs/deploy.md` by S0b.9 and repeated in the final docs of S7b.

## Owner actions (never automated)

1. **Copy review (gate G.1).** After S3 is committed, run `node scripts/check-explain-copy.mjs --print`, review every `EXPLAIN_COPY` entry (legal constants plus one sample per topic) and send the approved keys back. Blocks the first deploy of S1 to S3 topics (G.2 and G.3 follow).
2. **Deploy S0.** Nia tarball only, packaged with `NIA_ALLOW_UNREVIEWED=1`. No schema change.
3. **Deploy S1 to S3.** Nia tarball only, after G.2 is committed, packaged without the override.
4. **Deploy S4.** Web build and Nia tarball **together**, always. An older bundle skips `terms_correction` (`unknown_event_kind`) and reads uncorrected terms. If G.2 is not yet done, package with the override.
5. **Deploy S5.** Nia and web together (the preset refactor is behaviour neutral on the web).
6. **Deploy S6.** Nia; it writes corrections, so the S4 web must already be live.
7. **Deploy S7.** Web (needs G.2 done or the override because `build` runs the check); then the Nia tarball again for `/ayuda`.
8. **Appwrite.** No migration, no console change in any slice (`debt_events.kind` is `string(24)`, payload in `payloadJson`). Do NOT run `npm run migrate:appwrite` for this change.
9. **Before rolling back S4**, void any correction whose old values must not reappear silently.
10. **Optional.** Refresh the usury table in Ajustes; with a single row the stale warning in `usury_ibc` and `mora` is frequent.

## Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| S0 | Explain plumbing: catalogue, copy gate, router, buttons, hardened guard | slice 1 | `npx vitest run packages/finance-core/test/explain packages/finance-core/test/node16.test.js functions/nia/debt functions/nia/index.test.js scripts` | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` | core `explain/{topics,copy,hash}.js`, Nia `explain/`, `guard.js`, `extract.js`, `pending.js`, `handler.js`, `index.js` hooks, check script (read-only feature, no data) |
| S1 | Loan topics (rates, usury, mora, allocation, charges) | slice 2 | `npx vitest run packages/finance-core/test/explain functions/nia/debt/explain` | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` | core `explain/facts/*`, `allowed.js`, copy entries, Nia `render.js` |
| S2 | Card topics + additive revolving base | slice 3 | `npx vitest run packages/finance-core/test/card packages/finance-core/test/explain functions/nia/debt/explain` | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` | `card/card.js` additive fields, `facts/card.js`, card templates |
| S3 | Restructure what-if, prepayment, Ley 1555/546, optional paraphrase (off) | slice 4 | `npx vitest run packages/finance-core/test/explain functions/nia/debt/explain` | `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` | `facts/{restructure,prepayment}.js`, `paraphrase.js`, flag |
| Gate | Owner copy review, release test, unreviewed-free package | commit after S3 | `npx vitest run packages/finance-core/test/explain/copy.release.test.js` | `npm run package:nia` (no override) | the reviewed hashes commit only |
| S4 | `terms_correction`: core event, replay, preview, web «Corregir datos», history | slice 5 | `npx vitest run packages/finance-core/test/ledger packages/finance-core/test/card src/features/debts` | `npm run build` + `npm run package:nia` | `ledger/correction.js` + hooks in `events/project/tail/preview/commit`, web dialog/model files, menu item |
| S5 | Advisor create: presets in core, card create, extraction, proposal | slice 6 | `npx vitest run packages/finance-core/test/chargePresets.test.js src/features/debts/wizard functions/nia/debt` | `npm run build` + `npm run package:nia` | `chargePresets.js`, `advisor/{propose,cardTerms,merge}.js`, handler/pending/preview/index hooks |
| S6 | Advisor adjust: charge add, Nia correction, checklist, chain, unsupported | slice 7 | `npx vitest run functions/nia/debt functions/nia/index.test.js` | `npm run package:nia` | `planChange.js` add branch, `correction.js`, `advisor/{chain,unsupported}.js`, `nia:confirm:<id>` routing |
| S7 | Web popovers, `build` check, docs and `/ayuda` | slice 8 | `npx vitest run src/features/debts functions/nia/index.test.js` | `npm run build` (gate G done or override) + `npm run package:nia` | `explain/WhatIsThis.jsx`, `popoverModel.js`, three view hooks, `build` script, docs |

Slice checkpoint (last task of every slice, id `<slice>.CP`): `git diff --stat` (slice at most 2,000, each group at most 800), `npm test -- --maxWorkers=4` (App.test.jsx jsdom timeouts are known environmental flakiness: re-run that file alone before treating it as a failure), `npm run build`, and for Nia slices (S0 to S7 all touch `functions/nia` or the core it bundles) `npm run package:nia` (with `NIA_ALLOW_UNREVIEWED=1` until G.2).

Parallelism: slices are applied sequentially on `master` (single writer). Dependencies: S1 after S0; S2 and S3 after S1 (independent of each other); S4 has no dependency on S1 to S3 and may be applied before them if the owner prefers (it is the only reordering allowed); S5 after S1; S6 after S4 and S5; S7 after S1 to S6. Gate G.1 (owner) runs in parallel with S4 to S6 once S3 is committed. Inside a slice, the `a`/`b` groups are sequential.

---

## Phase S0: Explain plumbing (design 1,300 / worst 2,600) · deps: none

Groups: S0a core catalogue, guard, router, extraction (about 650); S0b flow, buttons, wiring, check script (about 650).

- [x] S0a.1 RED `packages/finance-core/test/explain/topics.test.js`: `EXPLAIN_TOPICS` equals the 9 names exactly and in order; `TOPIC_KINDS` (card-only `card_statement`, `card_interest_drop`; loan-only `restructure_whatif`, `prepayment`); `explainFacts('tax_returns', ...)` throws `ValidationError('unknown_topic', {topics})`; a loan with `card_statement` gives `status: 'not_applicable'` with empty `numbers`; `topicCopyKeys` is stable and returns a sample key per topic; `copyStatus`: a missing key is unreviewed, `reviewedOn` without a matching `reviewedHash` is unreviewed, an edited `text` un-reviews; `releasedTopics` is empty for the empty skeleton and `status: 'under_review'` is returned for an unreleased topic; `fnv1a` known vectors. Barrel exact-keys RED plus node16 list adds `explain/*.js`. Reqs DE1, DE4.
- [x] S0a.2 GREEN core `src/explain/{topics,copy,hash}.js` (catalogue, empty copy skeleton, `copyStatus`, `releasedTopics`, `topicCopyKeys`), `explainFacts` skeleton (unknown, not applicable, under review only), barrel `packages/finance-core/src/index.js`. Done: S0a.1 passes.
- [x] S0a.3 RED `functions/nia/debt/guard.test.js`: changed digit (28.32 to 28.23) rejected; invented 42 % rejected; «cuatro por mil», «veintiocho», «un millón», «doble», «mitad», «cien», «dos mil» rejected; «un», «una», «uno» as articles accepted; 1,201 characters rejected and 1,200 accepted at the default cap; faithful reply accepted; advise paraphrase over 1,200 now falls back to the template. Reqs NA10.
- [x] S0a.4 GREEN `functions/nia/debt/guard.js` (`NUMBER_WORDS`, `maxChars = 1200` default for all paraphrases). Done: S0a.3 passes, existing guard and `replies.advice` tests unchanged or adjusted for the cap only.
- [x] S0a.5 RED `functions/nia/debt/explain/router.test.js`: positives «¿qué es NAMV?», «¿cómo funciona la mora?», «explícame la usura», «¿qué es el 4x1000?»; negatives «pagué la mora», «pagué 200.000 de mora», «abona 500.000 a capital», «registra la cuota de manejo», «qué es una acción en bolsa», «hola»; case and accent folding via `fold()`; write verbs veto; marker rule («¿y con ejemplo?», at most 60 characters, no concept keyword, marker present gives the marker topic); attachment gives null; unreleased topics still route. Reqs NA2, NA4.
- [x] S0a.6 GREEN `functions/nia/debt/explain/router.js` (`glossaryTopic(text, {released, marker})`). Done: S0a.5 passes.
- [x] S0a.7 RED `functions/nia/debt/extract.test.js`: action `explain` with a closed `topic` enum, an unknown or missing topic normalizes to no topic (menu), optional debt selector, `stated` rate and `amountMinor` carried; the payload shape rejects any topic outside the 9. Reqs NA1, NA7.
- [x] S0a.8 GREEN `functions/nia/debt/extract.js` (`ACTIONS += explain`, `topic` enum; `setup` and `terms_correction` are added to `ACTIONS` in S5a and S6a, when their handlers exist). Done: S0a.7 passes.
- [x] S0b.1 RED `functions/nia/debt/pending.test.js`: `explainButton(topic, debtId, page)` is at most 64 bytes for `card_interest_drop` plus a 36-character id (page form drops the id to `-` when it would pass 64); `parseExplainCallback` round trips; an unknown topic returns null; `button()` asserts the limit. Reqs NA4.
- [x] S0b.2 GREEN `functions/nia/debt/pending.js` (`explainButton`, `parseExplainCallback`). Done: S0b.1 passes.
- [x] S0b.3 RED `functions/nia/debt/explain/flow.test.js` and `handler.test.js` (`world()`): no topic gives a menu with one button per topic and zero writes; unreleased topic replies «Este tema está en revisión»; stale, deleted or foreign-scope button (`inScopeFor`) gets a short safe reply with zero writes; a pending payment survives an explanation (`saveSession` receives the same pending, and the later Confirm writes once); zero `createRow`, `updateRow`, `deleteRow`; follow-up «¿y con ejemplo?» renders the marker topic for the marker debt; `turn()` writes the `explain:{topic, debtId}` marker in the last assistant history entry and `lastExplain` reads only the last entry; an extraction write action wins over `explainHint` (G3), a read-only action with the hint becomes `explain`; at most 2 Gemini calls. Reqs NA1, NA3, NA4, DE1.
- [x] S0b.4 GREEN `functions/nia/debt/explain/{flow,render}.js` (menu and «en revisión» only), `functions/nia/debt/handler.js` (`turn` marker, `lastExplain`, `explainHint` route, `startExplain`, `handleExplainCallback`). Done: S0b.3 passes.
- [x] S0b.5 RED `functions/nia/index.test.js` (faked undici fetch): «qué es la mora» classified as `conversation` is handled as `explain` topic `mora`; «pagué la mora» stays a payment; «qué es una acción en bolsa» stays `conversation`; the `nia:exp:` callback is routed before the stage check and works with no pending; a stale `nia:mode` button is still ignored; classifier prompt text mentions `explain`; at most 2 Gemini calls. Reqs NA2, NA7, NA9.
- [x] S0b.6 GREEN `functions/nia/index.js` (router call after `intentFor` for `conversation` or `analysis` with no attachment, `nia:exp` dispatch before `handleDebtCallback`, classifier text). Done: S0b.5 passes.
- [x] S0b.7 RED `scripts/check-explain-copy.test.mjs`: exit non-zero listing unreviewed and missing keys; exit zero with `NIA_ALLOW_UNREVIEWED=1` and a visible warning; `--print` lists every key with text and sources; the `package:nia` flow calls the check before building the tarball (a missing check call fails the test). Reqs DE4.
- [x] S0b.8 GREEN `scripts/check-explain-copy.mjs`; `scripts/package-nia.mjs` (or the `package:nia` entry in `package.json`) runs the check; the packaging scan covers `functions/nia/debt/explain` and `functions/nia/debt/advisor` for node16-forbidden constructs. Done: S0b.7 passes.
- [x] S0b.9 DOCS `docs/deploy.md` (S0 deploy: Nia tarball only, `NIA_ALLOW_UNREVIEWED=1`, gate G rule, deploy order table from the design Migration section). No test (docs).
- [x] S0.CP checkpoint (see slice checkpoint). `NIA_ALLOW_UNREVIEWED=1 npm run package:nia` must succeed. Owner deploys S0 (Nia only).

## Phase S1: Loan topics (design 1,300 / worst 2,600) · deps: S0

Groups: S1a core facts and copy (about 700); S1b render and property (about 600).

- [x] S1a.1 RED `packages/finance-core/test/explain/facts.rates.test.js` and `facts.usury.test.js`: 25.2 % NAMV gives 2.1 % MV and 28.32 % EA; stated 2.1 % MV gives 28.32 % EA; debt rate uses `rateInForce`; `capOn` stale cap shown with `usury_stale` and never blocks; no known cap gives `cap_unknown` and says so; 0 % family loan; no debt and no stated rate gives `status: 'generic'` with no debt figures and an invitation to name a debt; builders do not mutate (frozen inputs). Barrel exact-keys RED (`explainFacts`, `allowedTexts`). Reqs DE2, DE5, DE6.
- [x] S1a.2 GREEN core `src/explain/facts/{rates,usury}.js`, `src/explain/index` wiring in `explainFacts`, barrel. Done: S1a.1 passes.
- [x] S1a.3 RED `facts.mora.test.js` and `facts.allocation.test.js`: 199,505 overdue 10 days at 28.59 % EA gives mora 1,375; payment of 100,000 on charges 10,000 + interest 180,876 + principal 199,505 gives 10,000 / 90,000 / 0; with 10 days overdue gives 10,000 / 1,375 / 88,625 / 0; allocation uses `planCommit` with eventId `'explain'` as a pure preview (no state change). Reqs DE7, DE8.
- [x] S1a.4 GREEN `facts/{mora,allocation}.js`. Done: S1a.3 passes.
- [x] S1a.5 RED `facts.charges.test.js`, `allowed.test.js`, `copy.shape.test.js`: fee 45,000 with IVA 19 % gives 8,550 and the tax line references the fee; GMF base 400,000 at 0.4 % gives 1,600 from the copy constant; yearly sum over the next 12 rows labelled approximate; `allowedTexts(facts)` returns `facts.text` plus copy texts plus source labels; every S1 copy key has non-empty `sources` and `reviewedOn: null` (unreviewed). Reqs DE9, DE4, DE2.
- [x] S1a.6 GREEN `facts/charges.js`, `allowed.js`, `copy.js` entries for GMF, usura/IBC and mora plus one sample key per S1 topic, all `reviewedOn: null`. Done: S1a.5 passes.
- [x] S1b.1 RED `functions/nia/debt/explain/render.test.js` goldens per topic (rate_conventions, usury_ibc, mora, payment_allocation, charges) from real core results; exact footer (`Fuente: <debt name | "tasa que me diste"> · <core family> · <copy source labels>` and `Información educativa con tus datos; no es asesoría financiera.`); «aproximado» labels; generic reply invites naming a debt; not-applicable reply has no figures; stale usury warning shown. Reqs DE2, DE3, DE5, DE6, DE7, DE8, DE9.
- [x] S1b.2 RED same file, splitter: a 2,500-character topic returns `parts[]` each at most 1,200 characters, split on paragraph boundaries, no number cut, footer on every part, at most 2 related follow-ups. Reqs DE12.
- [x] S1b.3 GREEN `functions/nia/debt/explain/render.js` (5 templates, `renderExplain`, splitter, footer, `followUps`). Done: S1b.1 and S1b.2 pass.
- [x] S1b.4 RED `render.property.test.js` (seeded `mulberry32` from `packages/finance-core/test/helpers/prng.js` over fixture debts (loan, mora, mortgage, 0 % family) times the 5 topics times stated rates): every number in a rendered part is in `allowedTexts(facts)` or a template constant, no `NUMBER_WORDS`, every part at most 1,200 characters, `guardParaphrase(part)` is not null. Reqs DE2.
- [x] S1b.5 REFACTOR/GREEN fix whatever the property surfaces in `render.js` or `facts`. Done: property test stable across seeds.
- [x] S1b.6 RED `flow.test.js`: part 1 plus footer and buttons «Ver más» `nia:exp:<topic>:<debtId>:<n>` and related follow-ups; tapping «Ver más» re-renders and sends part n with its own footer; the page callback is at most 64 bytes (id replaced by `-` and the debt resolved from the marker); a released topic is simulated with an injected reviewed `copy` fixture; unreleased real copy still answers «en revisión». Reqs DE12, DE4, NA4.
- [x] S1b.7 GREEN `flow.js` render wiring and marker write. Done: S1b.6 passes.
- [x] S1.CP checkpoint (override packaging). Not deployed until gate G.

## Phase S2: Card topics (design 900 / worst 1,800) · deps: S1

Groups: S2a core (about 450); S2b Nia (about 450).

- [x] S2a.1 RED `packages/finance-core/test/card/card.base.test.js`: the F3 fixture keeps every pre-existing plan-row field with identical values (additive); 300,000 unpaid after the due date at a positive rate gives `revolvingBaseMinor` 300,000 with interest on it; a statement of 800,000 paid in full by its due date gives revolving 0, `excludedBaseMinor` 800,000, interest 0; late-mora exclusion matches F3 (interest 10,392 to 9,526) with `lateExcludedBaseMinor`; the effective base is `interestBase ?? billed` including the clamped due-day case where `interestBase` is `null`; all three fields are non-negative integers. Reqs CC1.
- [x] S2a.2 GREEN `packages/finance-core/src/card/card.js` `closeCycle` (three fields, state keeps `closedBilled`). Done: S2a.1 passes and `card.test.js`, `card.late.test.js`, `card.balance.test.js` unchanged.
- [x] S2a.3 RED `packages/finance-core/test/explain/facts.card.test.js`: `card_statement` shows last statement, minimum and the minimum rule; `card_interest_drop` shows revolving and excluded base from the core (300,000 revolving; paid in full gives base 0), plus the minimum-only what-if built with `project` and a synthetic payment of the minimum on `dueOn` against pay-in-full, measured at the next close and marked approximate; card `mora` figure `lateInterestMinor` marked approximate and explains the unpaid-minimum rule; both card topics on a loan give `not_applicable`; barrel/node16 lists. Reqs DE10, DE7, DE3.
- [x] S2a.4 GREEN `facts/card.js`, card copy entries (sample keys, `reviewedOn: null`), `mora` card path in `facts/mora.js`. Done: S2a.3 passes.
- [x] S2b.1 RED `render.test.js` card goldens (statement, interest drop with what-if, card mora «aproximado»), property test extended with card fixtures, and the longest callback `nia:exp:card_interest_drop:` plus 36-character id at most 64 bytes. Reqs DE10, DE3, DE2, NA4.
- [x] S2b.2 GREEN `render.js` card templates and follow-ups; `flow.js` card applicability replies. Done: S2b.1 passes.
- [x] S2.CP checkpoint (override packaging).

## Phase S3: Restructure, prepayment, Ley 1555/546, optional paraphrase (design 800 / worst 1,600) · deps: S1

Groups: S3a topics (about 500); S3b paraphrase (about 300).

- [x] S3a.1 RED `facts.restructure.test.js`, `facts.prepayment.test.js`, `facts.usury.test.js` (mortgage case): installment 390,381 unpaid 10 days at 28.59 % EA gives carried balance 391,756 or 390,381 waiving mora; 1,200,000 at 0 %, 12 installments, 1 paid, extra 300,000 gives reduce term 8 installments and reduce installment 11; Ley 1555 notice with the unverified-scope caveat; mortgage debt explains Ley 546 and states that no computation is made. Reqs DE11, DE6.
- [x] S3a.2 GREEN `facts/{restructure,prepayment}.js` (`restructureCarry` with and without `waiveLate`, `compareStrategies`, `ley1555Notice`), Ley 1555 and Ley 546 copy entries with sources, `reviewedOn: null`. Done: S3a.1 passes.
- [x] S3a.3 RED `render.test.js` goldens for `restructure_whatif` and `prepayment` and property test extension (mortgage and 0 % fixtures). Reqs DE11, DE2, DE3.
- [x] S3a.4 GREEN `render.js` two templates and follow-ups. Done: S3a.3 passes.
- [x] S3b.1 RED `functions/nia/debt/explain/paraphrase.test.js`: with `config.explainParaphrase` off (default) the template is sent and no extra Gemini call is made (at most 2); with it on, a faithful paraphrase is sent; invented 42 %, changed 28.32 to 28.23, «cuatro por mil», a reply over the cap, and a Gemini failure or timeout each send the template. Reqs DE13, NA10.
- [x] S3b.2 GREEN `explain/paraphrase.js`, `config.explainParaphrase` flag (default false), wiring in `flow.js` via `guardParaphrase`. Done: S3b.1 passes. Note: enabling it adds a third Gemini call, so it stays off until the owner decides.
- [x] S3.CP checkpoint (override packaging).

## Gate G: owner copy review (blocks the first deploy of S1 to S3) · deps: S1, S2, S3

- [x] G.1 OWNER COPY REVIEW (not automated): run `node scripts/check-explain-copy.mjs --print`, review every `EXPLAIN_COPY` entry (legal constants for GMF, usura/IBC, mora, Ley 1555, Ley 546 plus one sample per topic) and approve or amend the text and sources. Done: owner sends the approved keys. Note: approved by the owner on 2026-10-15, all 14 keys, no edits.
- [x] G.2 RED `packages/finance-core/test/explain/copy.release.test.js`: `releasedTopics()` equals the full 9-topic catalogue, so any later unreviewed copy turns the suite red (committed together with G.2 GREEN, because it is red until the hashes are set). Reqs DE4.
- [x] G.2 GREEN one commit sets `reviewedOn` and `reviewedHash` (`fnv1a(text + sources)`) for each approved key in `packages/finance-core/src/explain/copy.js`, with the approved edits. Done: the release test passes and `node scripts/check-explain-copy.mjs` exits 0. Note: no edits were approved, so the texts and sources are unchanged; `reviewedHash` is `copyHash(entry)` (fnv1a over the text, a newline and the `label|url` source lines), the exact value the gate verifies.
- [ ] G.3 OPERATOR (not automated): `npm run package:nia` passes the check without `NIA_ALLOW_UNREVIEWED`, then upload the tarball (deploy of S1 to S3 topics). Done: the owner confirms topics answer with source and disclaimer in Telegram.

## Phase S4: `terms_correction` (design 1,500 / worst 3,000) · deps: none (applied after S3 by default)

Groups: S4a core (about 650); S4b1 web model and summary (about 400); S4b2 dialog and wiring (about 450).

- [x] S4a.1 RED `packages/finance-core/test/ledger/correction.test.js`: valid card correction 15 to 20 accepted; loan + `statementDay` gives `correction_not_applicable` and nothing written; draft with `limitMinor`, advance rate, `prepaymentPenaltyPct`, `allocationOrder` or mora base gives `correction_unsupported_field`; empty draft gives `correction_empty`; value equal to the stored one gives `no_change`; out-of-range day 0 and 32 rejected; payload within the event payload limit; 25.2 % NAMV correction on a debt saved as 28.32 % EA gives 2.1 % MV with EA about 28.32 %; modality change; `previous` and `appliesTo` filled by `buildCorrection`. Barrel exact-keys (`buildCorrection`) and node16 list RED. Reqs DL1, DL2.
- [x] S4a.2 GREEN `packages/finance-core/src/ledger/correction.js` (`versionTermsAt`, `applyCorrection`, `buildCorrection`), `events.js` (kind `terms_correction`, strict `normalizePayload`), barrel. Done: S4a.1 passes.
- [x] S4a.3 RED `packages/finance-core/test/ledger/project.correction.test.js`: retroactive from opening regardless of event date; a `rate_change` to 22 % EA recorded before the correction stays 22 %; two corrections of the statement day (second wins) and voiding the second restores the first; void restores a projection deep-equal to the one before; result independent of storage order (shuffled events); correction bound to a restructure folds in `applyRestructure`; a correction whose restructure was voided is skipped with `terms_correction_skipped {eventId, reason}`; a stored correction that no longer validates is skipped; `projection.corrections` present only when non-empty and existing deep-equal goldens unchanged; corrected statement day clamps at month end for every statement of the version; minimum rule 5 % to 3 % recomputes minimums, past-due flags, mora and allocation; voided correction equals the pre-correction card projection. Reqs DL2, DL6, CC2.
- [x] S4a.4 GREEN `project.js` (fold opening corrections into base terms, strip corrections, `projection.corrections`), `tail.js` (`applyRestructure` folds bound corrections). Done: S4a.3 passes, `project.parity` and `project.test` suites unchanged.
- [x] S4a.5 RED (characterization) `events.forward.test.js`: with the `terms_correction` kind removed from the known kinds, the debt projects on its original terms with `unknown_event_kind`, nothing throws, and a void of the correction has no effect. Reqs DL5.
- [x] S4a.6 RED `packages/finance-core/test/ledger/preview.test.js`: `previewChange` accepts `terms_correction` and returns `corrected: {before, after}` (field values), before/after of the next installment or statement, and `impacted` (a payment recorded under the wrong minimum rule lists cost before and after); the preview `after` equals the projection after saving the event; `planCommit` and `previewChange` apply the correction before projecting and throw on invalid terms; stale statement `adjustment` drift count available for the warning. Reqs DL3, DL4.
- [x] S4a.7 GREEN `preview.js`, `commit.js`, `snapshot.js` if needed. Done: S4a.5 and S4a.6 pass, all core ledger suites green.
- [x] S4b1.1 RED `src/features/debts/termsCorrectionModel.test.js`: fields prefilled with current values (rate as stated with its convention, modality, card day/minimum fields); loan has no card fields; unsupported fields absent; invalid or unchanged values disable save with the inline message; draft built through `buildCorrection`; EA echo, before/after and `impacted` rows from `previewChange`; warning «Tienes N extractos registrados; revisa que coincidan». Reqs WM1.
- [x] S4b1.2 GREEN `src/features/debts/termsCorrectionModel.js`. Done: S4b1.1 passes.
- [x] S4b1.3 RED `eventSummary.test.js`, `EventHistory.test.jsx`, `debtDetailModel.test.js`: summary `Corrección: día de corte 15 → 20 · pago mínimo 5 % → 3 %` (never an amount of 0); history shows both values; `terms_correction` is in `VOIDABLE` and `PLAN_CHANGE_KINDS`; void asks for confirmation. Reqs WM2, DL4.
- [x] S4b1.4 GREEN `eventSummary.js`, `debtDetailModel.js`, `EventHistory.jsx`. Done: S4b1.3 passes.
- [x] S4b2.1 RED `TermsCorrectionDialog.test.jsx` (RTL, mocked port): card day 15 to 20 shows the preview and impacted rows; text states the correction applies from the start of the debt and that a real-world change uses «Cambiar tasa»; loan hides statement day, due day and minimum rule; no change disables save with an inline message; saving twice creates one event; a write failure shows an error with retry and the projection is unchanged. Reqs WM1.
- [x] S4b2.2 GREEN `src/features/debts/TermsCorrectionDialog.jsx` via `useCommitDialog`. Done: S4b2.1 passes.
- [x] S4b2.3 RED `MoreActionsMenu.test.jsx` and `DebtDetailContainer.test.jsx`: loan menu lists five actions («Cambiar tasa», «Cambiar seguros y cargos», «Configurar mora», «Corregir datos», «Reestructurar»); card menu lists four and omits «Reestructurar»; save and void of a correction run `afterSave: reconcileAfter` and a toast reports rows changed (voiding a correction that changed two rows says 2). Reqs WM4, WM2, DL4.
- [x] S4b2.4 GREEN `MoreActionsMenu.jsx`, `DebtDetail.jsx`, `DebtDetailContainer.jsx`. Done: S4b2.3 passes.
- [ ] S4.CP checkpoint. Owner deploys web and Nia together (action 4).

## Phase S5: Advisor create (design 1,700 / worst 3,400) · deps: S1

Groups: S5a presets, web parity and extraction (about 500); S5b propose and card terms (about 650); S5c handler and wiring (about 550).

- [x] S5a.1 RED `packages/finance-core/test/chargePresets.test.js`: `CHARGE_PRESET_SPECS` fix kind, basis, label and cadence for `life`, `insurance`, `fee`, `iva` (`pctOfCharge`, `refId: 'fee'`, `requires: 'fee'`, default 19), `gmf` (0.4); `presetCharges` with fee 45,000 + IVA gives IVA 8,550; with `{card:true}` keeps the ids `mgmt_fee` and `mgmt_iva` and the label «Cuota de manejo»; `addPresetCharge` throws `preset_exists` and `preset_requires_fee`, IVA links to the single existing fee; `addExplicitCharge` resolves `refLabel` by folded label and throws `charge_ref_unknown`; a missing amount is never invented; GMF base 400,000 gives 1,600. Barrel exact-keys and node16 lists RED. Reqs ADV2, NA5.
- [x] S5a.2 GREEN `packages/finance-core/src/chargePresets.js`, barrel. Done: S5a.1 passes.
- [x] S5a.3 RED `src/features/debts/wizard/wizardModel.test.js`: `cardCharges` output is identical to the stored output today (ids, labels, order); `CHARGE_PRESETS` keeps only UI fields and spreads the core spec; existing wizard and card wizard tests unchanged.
- [x] S5a.4 GREEN `src/features/debts/wizard/wizardModel.js` (spreads specs, `cardCharges` via `presetCharges`). Done: S5a.3 passes (behaviour neutral).
- [x] S5a.5 RED `functions/nia/debt/extract.test.js`: `setup` action and card `create` normalize to `request.setup` (kind card, statement day, due day, minimum rule or pct/floor, rate with convention, presets `fee`, `iva`, `ivaIncluded`, `life`, `insurance`, `gmf`); `pctOfCharge` with `refLabel`; a stated card limit becomes mention `card_limit` and `limitMinor` is never extracted; `lateStated` values; missing statement day, due day or minimum rule stay null and are never defaulted. Reqs NA5, ADV9.
- [x] S5a.6 GREEN `functions/nia/debt/extract.js` (`ACTIONS += setup`, `SetupCase` normalization). Done: S5a.5 passes.
- [x] S5b.1 RED `functions/nia/debt/advisor/cardTerms.test.js` and `merge.test.js`: `buildCardTerms` returns validated terms (system `none`, monthly, late default usury, `presetCharges(card)`); an invalid case throws `ValidationError`; `mergeCase` fills nulls with later answers and a stated value overrides; merged case at most 1.5 KB. Reqs ADV4, ADV3.
- [x] S5b.2 GREEN `functions/nia/debt/advisor/{cardTerms,merge}.js`. Done: S5b.1 passes.
- [x] S5b.3 RED `functions/nia/debt/advisor/propose.test.js`: Bancolombia case (2.1 % MV, fee 45,000 + IVA 19 %) echoes about 28.32 % EA, links IVA 8,550 by `pctOfCharge`, sets mora to usury and lists `iva_19` and `mora_default_usury` in `assumptions`, and asks `statementDay`, `dueDay`, `minRule` with `blocking: true`; «2% mensual» gives a convention question before any preview; life insurance without an amount gives `amount:life` and no confirmable draft; `ivaIncluded` computes the fee as `round(stated/1.19)` labelled «aproximado»; GMF base 400,000 gives 1,600; unknown statement or due day after one ask blocks creation and names the missing data; unknown minimum rule blocks with no default; dangling `refLabel` rejected; card limit and mora on the whole installment go to `unsupported`; usury notice never blocks; family loan mora none; `proposeSetup` is pure (frozen inputs, no I/O). Reqs ADV1, ADV2, ADV3, ADV4, ADV8.
- [x] S5b.4 GREEN `functions/nia/debt/advisor/propose.js` (create mode). Done: S5b.3 passes.
- [x] S5c.1 RED `functions/nia/debt/handler.test.js` (`world()`) and `pending.test.js`: `startSetup` replies with assumptions, questions, preview and the disclaimer with zero writes; no Confirm keyboard while a blocking question is open; `nia:min:<rule>` sets `awaiting:'minimum'`; `nia:conv:*` works through `CONVENTION_NEXT.setup`; text answers are merged into the stored case; pending at most 1,500 bytes; terms rebuilt at Confirm; Confirm of a card twice leaves exactly one `debts` row `db{id}` with no event and no `limitMinor`, and the second reply says it was already recorded (409); a loan writes its debt row plus its `disbursement` and nothing else; at most 2 Gemini calls; the old `card_in_web` reply is gone. Reqs ADV1, ADV4, ADV5, ADV9, NA5, NA9.
- [x] S5c.2 GREEN `functions/nia/debt/handler.js` (`startSetup`, answers, `commitSetup`), `pending.js` (`nia:min`), `preview.js`, `index.js` (callback routing). Done: S5c.1 passes.
- [x] S5c.3 RED `index.test.js`: `setup` and card create turns reach the advisor, `nia:min` and `nia:conv` callbacks route correctly, stale callbacks ignored with no write. Reqs NA7, NA9.
- [x] S5c.4 GREEN `functions/nia/index.js` wiring. Done: S5c.3 passes.
- [ ] S5.CP checkpoint. Owner deploys Nia and web (action 5).

## Phase S6: Advisor adjust (design 1,300 / worst 2,600) · deps: S4, S5

Groups: S6a charge add and correction action (about 600); S6b checklist, chain and unsupported (about 700).

- [x] S6a.1 RED `functions/nia/debt/planChange.test.js`: «agrega un seguro de vida de 12 mil mensual a la tarjeta» previews the charge from the effective date and Confirm writes one `charge_change`; a fee of 45,000 with its IVA preset previews IVA 8,550 linked to the fee; explicit fields (`kind`, `label`, `basis`, `value`, `cadence`, `refLabel`) accepted; an added charge is validated against the resulting set through `normalizeCharges`; `ADD_IN_WEB` refusal removed; edit and remove by label or kind unchanged; backdated note when the change precedes a recorded payment. Reqs NA8.
- [x] S6a.2 GREEN `functions/nia/debt/planChange.js` (`addPresetCharge`, `addExplicitCharge`), `extract.js` explicit add fields. Done: S6a.1 passes.
- [x] S6a.3 RED `functions/nia/debt/correction.test.js`: «el corte de la tarjeta es el 20, no el 15» previews 15 to 20, EA echo, impacted rows and the retroactive note; unchanged value says nothing changes and writes nothing; Confirm writes exactly one `terms_correction` (terms rebuilt at Confirm, dedupe pre-check); when `impacted.length > 0` the preview and reply add «Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.»; Nia does not reconcile; unsupported field answers «no soportado aún». Reqs NA6, NA7.
- [x] S6a.4 GREEN `functions/nia/debt/correction.js`, `extract.js` (`ACTIONS += terms_correction`), `handler.js` (`COMMIT.terms_correction`), `preview.js`. Done: S6a.3 passes.
- [x] S6b.1 RED `advisor/propose.test.js` (adjust) and `advisor/unsupported.test.js`: adjust mode compares the description with stored terms and lists differences as steps; stored day 15 and «siempre fue el 20» gives `terms_correction`; «bajó la tasa el mes pasado» gives `rate_change`; ambiguous gives the `fix_or_change` question with `nia:adj:fix|change` buttons (`awaiting:'adjust_kind'`); corrections ordered first, then the user's order; «mi cupo es 5 millones» gives «no soportado aún» with no write and no pretence of saving; same for advance rate, `prepaymentPenaltyPct`, `allocationOrder`, mora base. Reqs ADV6, ADV8.
- [x] S6b.2 GREEN `advisor/propose.js` (adjust checklist), `advisor/unsupported.js`. Done: S6b.1 passes.
- [x] S6b.3 RED `advisor/chain.test.js` and `handler.test.js`: correction then charge; the second step is previewed on the corrected debt with a fresh pending id, its own `dedupeKey` `debt:{pendingId}` and event id `de{pendingId}`, Confirm button `nia:confirm:<pendingId>`; a double tap with the old id answers «Ese paso ya quedó registrado» and writes once; a failed step (preview invalid, rebuild invalid, commit failure) stops the chain and reports done and remaining; cancelling step 2 of 3 skips step 3 and reports step 1 done and two remaining; each pending at most 1.5 KB; `nia:confirm` without an id still works for other flows. Reqs ADV7, NA9.
- [x] S6b.4 GREEN `advisor/chain.js`, `handler.js`, `index.js` (`cancelPending` delegates debt chains, `nia:confirm:<id>` regex). Done: S6b.3 passes.
- [ ] S6.CP checkpoint. Owner deploys Nia (the S4 web must already be live, action 6).

## Phase S7: Popovers, build check and docs (design 850 / worst 1,700) · deps: S1 to S6

Groups: S7a popovers (about 600); S7b docs (about 250).

- [ ] S7a.1 RED `src/features/debts/explain/popoverModel.test.js`: figure to topic mapping (rate, mora, charges, minimum payment, statement); content from `explainFacts` and `EXPLAIN_COPY` with the same source line and exact disclaimer; a topic not in `releasedTopics()` yields no popover; no writes. Reqs WM3, DE3, DE4.
- [ ] S7a.2 GREEN `src/features/debts/explain/popoverModel.js`. Done: S7a.1 passes.
- [ ] S7a.3 RED `WhatIsThis.test.jsx`, `DebtDetail.test.jsx`, `DebtDetail.card.test.jsx`: the disclosure opens and closes with Enter, Space and Escape, sets `aria-expanded`, returns focus; renders the `mora` explanation with its disclaimer next to the mora figure and writes nothing (port spies); triggers appear next to rate, mora, charges, minimum and statement figures only when the topic is released; absent for unreleased topics. Reqs WM3.
- [ ] S7a.4 GREEN `explain/WhatIsThis.jsx` (a disclosure like `MoreActionsMenu`, no new dependency), `DebtDetail.jsx`, `CardPanel.jsx`, `LateNotices.jsx`. Done: S7a.3 passes.
- [ ] S7a.5 RED `scripts/check-explain-copy.test.mjs` addition: root `package.json` `build` script runs the copy check first. Reqs DE4.
- [ ] S7a.6 GREEN `package.json` (`build` runs `node scripts/check-explain-copy.mjs`). Done: S7a.5 passes. Note: the S7 build needs gate G.2 done or `NIA_ALLOW_UNREVIEWED=1`.
- [ ] S7b.1 RED `functions/nia/index.test.js`: `/ayuda` lists explain, setup/configure and «corregir datos» capabilities. Reqs NA7.
- [ ] S7b.2 GREEN `functions/nia/index.js` `/ayuda`; DOCS `functions/nia/README.md` (explain, advisor, `terms_correction`, buttons, override), `docs/deploy.md` (final deploy order and the override rule), `docs/` user guide for «Corregir datos» and «¿Qué es esto?». Done: S7b.1 passes; docs reviewed by reading.
- [ ] S7.CP checkpoint and owner deploy of web, then Nia tarball (action 7). Final handoff to `sdd-verify`.

---

## Requirement to task traceability

| Spec | Requirement (ADDED / MODIFIED) | Tasks |
|---|---|---|
| debt-explanations | DE1 Closed topic catalogue (ADDED) | S0a.1, S0a.2, S0b.3, S0b.4 |
| | DE2 Facts from code, numbers only from facts | S1a.1, S1a.5, S1b.1, S1b.4, S1b.5, S2b.1, S3a.3 |
| | DE3 Mandatory source line and disclaimer | S1b.1, S2a.3, S2b.1, S3a.3, S7a.1 |
| | DE4 Reviewed legal constants and release gate | S0a.1, S0b.7, S0b.8, S1a.5, S1b.6, G.1, G.2, G.3, S7a.1, S7a.5 |
| | DE5 Rate conventions | S1a.1, S1b.1 |
| | DE6 Usury and IBC | S1a.1, S3a.1, S1b.1 |
| | DE7 Mora | S1a.3, S2a.3, S1b.1 |
| | DE8 Payment allocation | S1a.3, S1b.1 |
| | DE9 Charges | S1a.5, S1b.1 |
| | DE10 Card topics | S2a.1, S2a.3, S2b.1 |
| | DE11 Restructure and prepayment | S3a.1, S3a.3 |
| | DE12 Length and splitting | S1b.2, S1b.6 |
| | DE13 Optional paraphrase | S3b.1, S3b.2 |
| debt-ledger | DL1 Terms correction event (ADDED) | S4a.1, S4a.2 |
| | DL2 Retroactive replay | S4a.1, S4a.3, S4a.4 |
| | DL3 Terms correction preview | S4a.6, S4a.7 |
| | DL4 Void, reconcile and summary | S4a.3, S4a.6, S4b1.3, S4b2.3 |
| | DL5 Older bundles skip the correction | S4a.5 (plus deploy order, owner action 4) |
| | DL6 Append-only debts and events (MODIFIED) | S4a.2, S4a.3 |
| credit-card-debt | CC1 Revolving and excluded base per statement (ADDED) | S2a.1, S2a.2 |
| | CC2 Corrected card terms (ADDED) | S4a.3, S4a.4 |
| debt-web-management | WM1 Correct data dialog (ADDED) | S4b1.1, S4b1.2, S4b2.1, S4b2.2 |
| | WM2 Correction history, void and reconcile (ADDED) | S4b1.3, S4b1.4, S4b2.3, S4b2.4 |
| | WM3 Explain popovers (ADDED) | S7a.1 to S7a.4 |
| | WM4 More-actions menu (MODIFIED) | S4b2.3, S4b2.4 |
| nia-debt-advisor | ADV1 Proposal is read-only and complete | S5b.3, S5b.4, S5c.1, S5c.2 |
| | ADV2 Charge presets | S5a.1, S5a.2, S5b.3 |
| | ADV3 Rate convention echo and mora default | S5b.1, S5b.3, S5b.4 |
| | ADV4 Card proposal | S5b.1, S5b.3, S5c.1 |
| | ADV5 Exactly one write after Confirm | S5c.1, S5c.2 |
| | ADV6 Adjustment checklist and action choice | S6b.1, S6b.2 |
| | ADV7 Sequential chain | S6b.3, S6b.4 |
| | ADV8 Unsupported fields | S5b.3, S6b.1, S6b.2 |
| | ADV9 No extra model calls | S5a.5, S5c.1 |
| nia-debt-assistant | NA1 Explain action and topic selection (ADDED) | S0a.7, S0b.3, S0b.4 |
| | NA2 Glossary router | S0a.5, S0a.6, S0b.5, S0b.6 |
| | NA3 Explain is read-only and session-safe | S0b.3, S0b.4 |
| | NA4 Stateless explain buttons and marker | S0a.5, S0b.1, S0b.2, S0b.3, S1b.6, S2b.1 |
| | NA5 Card creation and charge presets in extraction | S5a.1, S5a.5, S5a.6, S5c.1 |
| | NA6 Terms correction action | S6a.3, S6a.4 |
| | NA7 Debt intent, extraction only (MODIFIED) | S0a.7, S0b.5, S5c.3, S6a.3, S7b.1 |
| | NA8 Rate and charge change actions (MODIFIED) | S6a.1, S6a.2 |
| | NA9 Conversation callbacks for all actions (MODIFIED) | S0b.5, S5c.1, S5c.3, S6b.3 |
| | NA10 Paraphrase guardrail (MODIFIED) | S0a.3, S0a.4, S3b.1 |

All 6 specs, 13 + 6 + 2 + 4 + 9 + 10 = 44 requirements (ADDED and MODIFIED) are covered. Design threat matrix: every row is N/A; the chatbot routing safety cases (write vetoes, stale and foreign buttons, id-bound chain Confirm) are the RED tests S0a.5, S0b.3, S0b.5 and S6b.3.
