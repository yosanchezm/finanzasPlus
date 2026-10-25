# Apply progress: flexible-budgets

Mode: Strict TDD. Engram: unavailable in this executor (no mem_* tools); progress persisted here only.

## S1a (branch feat/fb-s1a-core): S1a.1-S1a.9 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S1a.1/2 | test/budget/groups.test.js | module missing | 7 pass | Map and object lookup, debtId, transfer, unknown kinds | clean |
| S1a.3/4 | test/budget/ids.test.js | module missing | 6 pass | 5 vectors (BigInt oracle run offline), 36-char id | clean |
| S1a.5-7 | test/budget/lines.test.js | module missing | 23 pass | 11 invalid-line rows, 200-case shuffle property | clean |
| S1a.8 | test/node16.test.js | 2 barrel tests failed (86 vs 97 keys) | pass after barrel lines | n/a | n/a |
| S1a.9 | npm test | n/a | 166 files / 2956 tests pass | n/a | comments trimmed to fit 400 |

## Size
New files 373 lines (src 159, tests 230 incl. none else) + tracked diff 21 = 394 (<= 400).

## Work Unit Evidence
- Focused: `npx vitest run packages/finance-core/test/budget packages/finance-core/test/node16.test.js` green.
- Runtime harness: N/A (pure functions).
- Rollback: delete `packages/finance-core/src/budget/`, `test/budget/`, 3 barrel lines, node16 additions.

## Decisions
- validateLine returns `{ok}` / `{ok:false, code}`; unknown category is not rejected (callers report it).
- `categoryOf` (Map or plain object lookup) lives in groups.js and is not exported from the barrel.
- Id helpers take `(target, 'YYYY-MM')`; `migrated(budgetId)`.
- linesFromLegacyBudgets also skips rows without categoryId; sets `actorId`/`source` to `migration`.
