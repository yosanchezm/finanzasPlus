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
