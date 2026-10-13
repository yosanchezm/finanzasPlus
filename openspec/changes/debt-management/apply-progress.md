# Apply Progress: debt-management

Mode: Strict TDD. Delivery: auto-chain, stacked-to-main, review budget 800 lines. Later batches MUST merge into this file.

## Batch 1: S0a (Nia in-repo) - COMPLETE (size:exception, mechanical move)

Branch `feat/debt-s0a-nia-in-repo`. Commit `de7b7cd chore(nia): track functions/nia as plain files`.

### Owner confirmation (S0a.1 gate)
The owner explicitly confirmed in chat on 2026-10-12 to back up and remove the nested `functions/nia/.git` and integrate Nia as plain files. Gate satisfied before any destructive step. Include this text in the PR description.

### Preflight (S0a.2)
- `git ls-files -s functions/nia`: `160000 887fe1189c050cec3c718273ab8dc2f391d8bb67`.
- `git -C functions/nia rev-parse --show-toplevel` = the nested root (`.../functions/nia`).
- Nested `rev-parse HEAD` = `887fe1189c050cec3c718273ab8dc2f391d8bb67` (`887fe11 init`).
- Nested `status --porcelain`: ` M README.md`, ` M index.js`, ` M package.json`, `?? node_modules/` (uncommitted changes preserved in the new tracked blobs).

### Backup (S0a.4)
- Primary: `C:\Users\USER~1.ADM\AppData\Local\Temp\claude\C--Users-User-admin-Documents-Personal-FinanzasPlus\80d850eb-574b-4a14-be99-7b0ab5513e1e\scratchpad\nia-git-backup\` (`.git/`, `index.js`, `README.md`, `package.json`, `nia.bundle`). The scratchpad is temporary.
- Durable copy: `C:\Users\User.admin\backups\finanzasplus-nia-git-20261012\` (same contents).
- Verified before deletion: `git --git-dir=<backup>/.git log --oneline` shows `887fe11 init`; `git bundle verify nia.bundle` is okay (refs master, origin/master, HEAD at 887fe11, complete history); the three files are byte-identical to the working tree (`cmp`); sha256 of the working-tree files was recorded and matched after staging.

### Tasks
- [x] S0a.1 owner gate (confirmation recorded above)
- [x] S0a.2 preflight
- [x] S0a.3 RED `src/test/niaInRepo.test.js` (7 tests; 7 failed first for the right reason: pathspec in submodule / gitlink 160000 present / nested `.git` present / dockerignore lacks `dist-nia`)
- [x] S0a.4 backup (see above)
- [x] S0a.5 `git rm --cached functions/nia`, removed `functions/nia/.git`, staged `index.js`, `package.json`, `README.md` by explicit path (no lockfile exists)
- [x] S0a.6 `git rm --cached functions/nia.tar.gz functions/nia-deploy.tar.gz` (files kept on disk); `.gitignore` += `dist-nia/`; `.dockerignore` += `dist-nia`, `**/dist-nia` (`packages` not listed, so it stays in the context)
- [x] S0a.7 `npm test` and `npm run build` green; committed

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S0a.3/5/6 | `src/test/niaInRepo.test.js` | Unit (node env, real git via `execFileSync`, no shell) | Full suite baseline 187/187 (first run had 3 timeouts under load, rerun 187/187) | Written first; 7/7 failed | 7/7 passed after index change + ignore files | 7 cases: blobs 100644, no 160000 under `functions/`, no nested `.git`, no `node_modules`/`*.tar.gz` tracked, tarballs and `dist-nia` ignored, sources not ignored, dockerignore | None needed (test already minimal) |

Test summary: 7 tests written, 7 passing; full suite 30 files / 194 tests passing. Pure functions created: 0 (test helpers only).

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run src/test/niaInRepo.test.js`: exit 0, 7 passed |
| Runtime harness | `git ls-files -s functions`: only 100644 entries (`nia/README.md`, `nia/index.js`, `nia/package.json`); `npm run build` exit 0 (built in 7.25s); `npm test` exit 0 (30 files, 194 tests) |
| Rollback boundary | Restore `.git` from the backup, `git rm -r --cached functions/nia`, `git update-index --add --cacheinfo 160000,887fe1189c050cec3c718273ab8dc2f391d8bb67,functions/nia`; revert `.gitignore`, `.dockerignore`, remove `src/test/niaInRepo.test.js` |

### Notes
- Git reports LF-to-CRLF warnings (autocrlf); blobs are stored normalized, working-tree bytes unchanged.
- `.codegraph/` and `.claude/` left untracked on purpose (not in S0a scope).
- Pre-existing flakiness: under a loaded machine the jsdom suite can hit 15 s timeouts on 1-3 tests; a rerun passed 187/187.
- Size checkpoint: mostly moved Nia files (about 1,100 lines); accepted `size:exception`.

## Batch 2: S0b (Nia packaging script) - COMPLETE

Branch `feat/debt-s0b-nia-packaging` (stacked on `feat/debt-s0a-nia-in-repo`). Commits:
- `b48dae9 feat(nia): add in-process ustar writer for the Function archive`
- `c043bb5 feat(nia): add package:nia script that bundles the Function for Node 16`
- `025941c docs(nia): document npm run package:nia and the separate Function deployment`

Size: 582 added / 4 deleted lines across 8 files (tests and docs included); well under the 800-line budget, no split needed.

### Tasks
- [x] S0b.1 RED `scripts/lib/tar.test.js` (module missing -> suite failed to import)
- [x] S0b.2 GREEN `scripts/lib/tar.mjs` (`createTar`, `createTarGz`; 8 tests)
- [x] S0b.3 RED `scripts/package-nia.test.js` (module missing -> suite failed to import)
- [x] S0b.4 GREEN `scripts/package-nia.mjs` (`packageNia`, `scanForbiddenApis`, CLI with `--out` and `--entry`)
- [x] S0b.5 `"package:nia": "node scripts/package-nia.mjs"` (RED test first: script undefined)
- [x] S0b.6 docs (Spanish): `docs/setup.md` section 5 item 4, `docs/deploy.md` new section 8, `functions/nia/README.md` (Empaquetado + env var table)
- [x] S0b.7 REFACTOR, full suite and size checkpoint

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S0b.1/2 | `scripts/lib/tar.test.js` | Unit (node env) | N/A (new) | Written first; suite failed (module missing) | 8/8 passed | 8 cases: header fields and checksum, 512 padding plus 2 zero end blocks, empty file, determinism, explicit mode/mtime, name limit (101 bytes, exactly 100, multibyte), empty/absolute/`..` names, gzip round trip | None needed |
| S0b.3/4 | `scripts/package-nia.test.js` | Unit + subprocess integration (real Vite build via `execFileSync(process.execPath)`, no shell; bundle loaded in a child Node process) | Baseline 194/194 | Written first; suite failed (module missing) | 10/10 passed | Scan positive and negative cases; import-specifier check has a negative control (relative and `packages/` paths flagged); tarball vs dist byte equality; fixture with `findLast` exits non-zero and writes no tarball | None needed |
| S0b.4 (fix) | same | same | 10/10 | Added "dist-nia holds only index.js and package.json": failed because Vite copied web `public/` assets (5 files) into the bundle dir | 11/11 after `publicDir: false` | n/a | n/a |
| S0b.5 | same (`npm script` describe) | Unit | `package.json` read | Failed: script undefined | 12/12 passed | Triangulation skipped: single constant string, one possible output | n/a |

Test summary: 20 tests written (8 tar + 12 packaging); full suite 32 files / 214 tests passing (baseline 30 files / 194). Pure functions created: 3 (`createTar`, `createTarGz`, `scanForbiddenApis`).

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run scripts/`: exit 0, 3 files, 23 tests passed (includes pre-existing script tests); `scripts/lib/tar.test.js` 8/8, `scripts/package-nia.test.js` 12/12 |
| Runtime harness | `npm run package:nia` exit 0 wrote `functions/nia.tar.gz` (14,837 bytes: `index.js` 56,814 + `package.json` 182, listed by the system `tar -tzvf`); the bundle loaded in a child Node process with stubbed env and `undici@5.28.5` linked in, GET returned `{ok:true, service:'nia'}`; `npm test` 214/214; `npm run build` exit 0; `git status` shows no tarball or `dist-nia` noise (`functions/*.tar.gz` and `dist-nia/` ignored, confirmed with `git check-ignore -v`) |
| Rollback boundary | Remove `scripts/package-nia.mjs`, `scripts/package-nia.test.js`, `scripts/lib/tar.mjs`, `scripts/lib/tar.test.js`, the `package:nia` line in `package.json`, and revert the three doc files (`docs/setup.md` item 4, `docs/deploy.md` section 8, `functions/nia/README.md`) |

### Deviations and decisions
- The bundle API scan excludes `.at(` on purpose: Node 16.6+ ships it and `functions/nia/index.js` already uses it (`message.photo.at(-1)`, `sorted.at(-1)`); including it would fail the existing code and the task forbids refactoring Nia here. The finance-core `.at(` rule stays in S1.9's own static test. Scan list: `findLast`, `findLastIndex`, `toSorted`, `toReversed`, `toSpliced`, `.with(`, `structuredClone`, `Object.groupBy`, `Map.groupBy`.
- Added `publicDir: false` to the Vite build (not in AD12): without it Vite copied `public/` web assets into `dist-nia/`. Covered by a dedicated test.
- Added a test-only `--entry <file>` CLI flag and an `entry` option on `packageNia` so the forbidden-API failure can be exercised end to end with a fixture; default is `functions/nia/index.js`.
- `scanForbiddenApis` is exported; `vite` is imported lazily inside `packageNia`, so importing the module is cheap.
- The smoke test loads the bundle in a child Node process (explicit minimal env, `node_modules/undici` junction to the pinned 5.28.5 resolved from `functions/nia`), not inside Vitest, so no env seam or refactor of `functions/nia/index.js` was needed. `undici` is pinned: the script throws if `functions/nia/package.json` has a range instead of an exact version.
- Docs: `setup.md` no longer recommends the GitHub root `functions/nia` (S8 will inline `packages/` through relative imports, which that mode could not resolve); the tarball upload is the documented path. The old text claimed the tarball held `README.md`; the generated one holds only `index.js` and `package.json`.

### Notes
- `npm run package:nia` regenerated the local, untracked `functions/nia.tar.gz` (OA-4: owner uploads it after merge). `functions/nia-deploy.tar.gz` is untouched.
- Pre-existing flakiness persists: the first full-suite run of the session hit 2 jsdom timeouts under load; the rerun passed 194/194.
- The Node version used here is 24; the Node 16 guarantees come from the Vite `target`, the API scan and the static `node:`/`undici` import check, not from executing on Node 16.
