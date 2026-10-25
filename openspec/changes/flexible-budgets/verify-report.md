# Verify Report: flexible-budgets

Mode: strict TDD, hybrid (Engram unavailable in this executor; file only). Branch `feat/flexible-budgets`, 70 files, +5596/-598.

## Verdict: PASS WITH WARNINGS

CRITICAL 0, WARNING 3, SUGGESTION 4.

## Evidence
| Check | Command | Result |
|---|---|---|
| Tests | `npx vitest run --maxWorkers=6` | exit 0; 178 files, 3126 tests passed, 0 failed |
| Build | `npm run build` | exit 0 (only the pre-existing >500 kB chunk notice) |
| Tasks | tasks.md | 74 of 74 implementation tasks `[x]`; the single unchecked box is the operator-steps checklist item (OP-1..OP-7), not code |
| Working tree | git status | only the two pre-existing untracked paths (`.claude/`, `scripts/spike-transactions.mjs`) |

## Spec traceability (38/38 requirements)
Every requirement BP-1..8, BC-1..11, BM-1..8, DM-1..6, NB-1..4 maps to a RED/GREEN task pair with a passing runtime test (core: `packages/finance-core/test/budget/{groups,ids,lines,edit,compute,outflows}.test.js`; schema/migration: `scripts/lib/budget-{schema,migration}.test.js`, `scripts/migrate-budgets.test.js`; web: `src/appwrite.test.js`, `src/features/budget/*.test.jsx`, `src/features/dashboard/*.test.jsx`; Nia: `functions/nia/budget.test.js`, `index.test.js`). Requirements without test evidence: none. BM-9 (rollout order) is procedural by design, evidenced by docs (docs/setup.md, functions/nia/README.md) and the OP table.

## Design consistency
| Item | Result |
|---|---|
| Naming table | Compliant (source and tests use `porAsignarMinor`, `base.source`, `householdFixed`, `sublimits_exceed_envelope`, `debt_data_unavailable`) |
| Row ids <= 36 | Compliant; ids.test.js asserts 36-char category id yields <= 36 |
| Tie-break order (override, latest fromMonth, smaller toMonth, greatest $id) | Compliant; lines.test.js incl. shuffled property test |
| Tombstones | Compliant; never overBudget, shadow older lines, planLineEdit never deletes |
| Legacy fallback | Compliant; web `linesMode` and Nia refuse writes (`LEGACY_REFUSAL`) |
| Debt actual rule | Compliant; void-aware, cost rows with debtId not summed, fallback + warning |
| Cashflow net = Balance | Compliant; outflows.test.js and cashflow tests |
| Nia never writes `budgets` | Compliant; `functions/nia/index.js:944-952` writes only `budget_lines`; `budgets` only read (`budget.js:69`) |
| Web never writes `budgets` | Compliant; `src/appwrite.js:169` read only |
| finance-core Node 16 safety | Compliant; all 6 new files in node16 scan (`node16.test.js:103-108`); no BigInt/findLast/toSorted/structuredClone in `src/budget` |

## Findings
### CRITICAL
None.

### WARNING
- W1 `src/features/dashboard/KpiCards.jsx:77` / `src/app/FinanceShell.jsx:276`: the "N movimientos" note under Gastos (consumption) counts ALL expense rows, including saving, investment and debt rows, so it can disagree with the Gastos amount. Real, cosmetic/misleading. Fix: count only consumption-group rows or relabel.
- W2 `src/app/FinanceShell.jsx:109-112,336`: legacy `totals` (income/expenses, all expense rows) is kept only for `AssistantPanel`. Real; it uses the pre-change "expenses" definition, so the assistant panel can show a figure different from dashboard Gastos/Balance. Low impact, inconsistent with DM-1 spirit.
- W3 `functions/nia/index.js:946,954`: confirm performs two full `loadBudgetMonth` reads (re-plan with fresh lines, then recompute Por asignar), each paginating several tables. Real; latency/cost on Appwrite Function only, failure of the second read is already handled gracefully (try/catch).

### SUGGESTION
- S1 S5b decisions confirmed in code: saving/investment overshoot shown as "Meta superada" (`BudgetView.jsx:103,183`), debt overshoot shown as over; "Categorías excedidas" and "Gasto sin límite" are removed (no matches in non-test code). Matches AD12 intent; document in PR notes.
- S2 S1b "Desde este mes" with an existing one-month override leaves the override in effect; `LineEditorDialog.jsx:77-79` warns and `BudgetContainer.jsx:43` derives `monthOverride`. Acceptable, UX trade-off.
- S3 `scripts/merge-categories.mjs:181-191` still writes/deletes `budgets` rows. It is a pre-existing manual operator script (not web/Nia), but after cut-over it would mutate the rollback source and would not touch `budget_lines`. Consider updating or deprecating it.
- S4 Open questions Q1 (biweekly pay with the reference base) and Q3 (automatic seed) remain product decisions.

## Operator steps (not executed here; all PENDING)
OP-1 `npm run migrate:appwrite` (creates `budget_lines`; run twice on dev first): pending.
OP-2 `npm run migrate:budgets` dry run review: pending.
OP-3 `npm run migrate:budgets -- --apply`, confirm backup file, re-run must be a no-op: pending.
OP-4 Deploy web (only after OP-3): pending.
OP-5 Web smoke check (migrated amounts, edit, scope Tú read-only, KPIs match): pending.
OP-6 `npm run package:nia`, upload, Telegram smoke: pending.
OP-7 Rollback path available (revert deploys; `budgets` untouched; kinds from backup): on demand.
No migration, live Appwrite call or deploy was performed during verification.
