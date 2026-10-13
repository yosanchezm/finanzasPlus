# Delta for nia-in-repo-packaging

## ADDED Requirements

### Requirement: Nia is tracked as plain files

`functions/nia/` MUST be tracked as ordinary files, not a gitlink (mode 160000). The repo MUST NOT contain a nested `.git` under it after the change.

#### Scenario: Gitlink resolved

- GIVEN `functions/nia` is a gitlink with uncommitted working-tree changes
- WHEN the in-repo move is applied
- THEN `index.js`, `package.json` and `README.md` are tracked as blobs with the working-tree content preserved
- AND `git ls-files -s functions/nia` shows no mode 160000 entry

### Requirement: Destructive step is guarded

The move MUST NOT start without explicit owner confirmation at apply time. Before removing `functions/nia/.git`, the process MUST copy it to a backup location outside the repo, and MUST abort if the backup fails.

#### Scenario: No confirmation

- GIVEN the owner has not confirmed
- WHEN the move is invoked
- THEN `functions/nia/.git` is left untouched and the process exits non-zero

#### Scenario: Backup fails

- GIVEN the owner confirmed but the backup copy fails
- WHEN the move runs
- THEN the nested `.git` is NOT removed and the gitlink is NOT untracked

### Requirement: Deployable bundle script

`scripts/package-nia.mjs` MUST produce a Node16-compatible bundle (`dist-nia/`) that inlines `packages/finance-core/`, keeps `undici` external, and archives it as `functions/nia.tar.gz`. It SHOULD be exposed through an npm script.

#### Scenario: Bundle contains shared core

- GIVEN `functions/nia/index.js` imports `packages/finance-core`
- WHEN the script runs
- THEN the tar.gz contains an entry file and `package.json`
- AND the bundle has no import path that resolves outside the archive except external dependencies

#### Scenario: Smoke test

- GIVEN the produced bundle
- WHEN the entry module is loaded under the Node16 target in a test with stubbed env
- THEN it loads without a syntax or import error

### Requirement: Tarballs are not tracked

`functions/*.tar.gz` MUST be untracked and ignored. The web Docker build MUST NOT depend on files under `functions/`.

#### Scenario: Generated archive ignored

- GIVEN the script just wrote `functions/nia.tar.gz`
- WHEN `git status` runs
- THEN the archive does not appear as untracked
- AND previously tracked tarballs are removed from the index
