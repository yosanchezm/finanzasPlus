// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageNia, scanForbiddenApis, scanSourceDirs } from './package-nia.mjs';

const root = process.cwd();
const script = resolve(root, 'scripts/package-nia.mjs');
const realTarball = resolve(root, 'functions/nia.tar.gz');
const realDist = resolve(root, 'dist-nia');

const sha256 = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);

// Reads regular-file entries out of an uncompressed ustar buffer.
const readTar = (tar) => {
  const entries = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 135).toString('latin1'), 8);
    entries.push({ name, data: tar.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
};

// Every module specifier the bundle can reach: static, re-export, dynamic and require().
const importSpecifiers = (source) => {
  const patterns = [
    /\bimport\s*(?:[^'"()]*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bexport\s[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const found = new Set();
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
};

// The shipped explain copy is reviewed (gate G.2), so packaging runs without the override.
const run = (args) => execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });

describe('packageNia copy gate', () => {
  it('refuses to package unreviewed explain copy and writes no archive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'package-gate-'));
    const tarPath = join(dir, 'nia.tar.gz');
    await expect(packageNia({ outDir: join(dir, 'dist'), tarPath, copy: {} })).rejects.toThrow(/Explain copy check FAILED/);
    expect(existsSync(tarPath)).toBe(false);
  });
});

describe('scanForbiddenApis', () => {
  it('reports each Node 16 incompatible API found in the source', () => {
    expect(scanForbiddenApis('const last = list.findLast((n) => n > 1);')).toEqual(['findLast']);
    expect(scanForbiddenApis('list.findLastIndex(f); list.toSorted(); list.toReversed(); list.toSpliced(0); list.with(0, 1);'))
      .toEqual(['findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'with()']);
    expect(scanForbiddenApis('const copy = structuredClone(x); Object.groupBy(a, f); Map.groupBy(a, f);'))
      .toEqual(['structuredClone', 'Object.groupBy', 'Map.groupBy']);
  });

  it('returns nothing for Node 16 safe code and does not match look-alikes', () => {
    expect(scanForbiddenApis('const a = [3, 1].sort(); const b = [...a].reverse(); a.flat(); name.replaceAll("-", "");')).toEqual([]);
    expect(scanForbiddenApis('// findLast and toSorted are mentioned only in a comment\nconst myfindLastThing = 1;')).toEqual([]);
  });
});

describe('scanSourceDirs', () => {
  it('flags array .at(, Object.hasOwn and the Node 17+ APIs in the explain and advisor sources, and skips tests and missing folders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-sources-'));
    try {
      writeFileSync(join(dir, 'bad.js'), 'const last = rows.at(-1);\nif (Object.hasOwn(a, b)) rows.toSorted();\n');
      writeFileSync(join(dir, 'good.js'), 'const last = rows[rows.length - 1];\n');
      writeFileSync(join(dir, 'bad.test.js'), 'rows.at(-1);\n');

      expect(scanSourceDirs([dir, join(dir, 'missing')])).toEqual([{ file: join(dir, 'bad.js'), found: ['toSorted', '.at()', 'Object.hasOwn'] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds nothing in the real explain and advisor sources', () => {
    expect(scanSourceDirs()).toEqual([]);
  });
});

describe('npm script', () => {
  it('exposes the packaging as `npm run package:nia`', () => {
    const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(scripts['package:nia']).toBe('node scripts/package-nia.mjs');
  });
});

describe('packageNia (CLI, --out redirected to a temp dir)', () => {
  let tmp;
  let bundlePath;
  let bundle;
  let tarEntries;
  const tarballBefore = sha256(realTarball);
  const distExistedBefore = existsSync(realDist);

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'package-nia-'));
    run(['--out', tmp]);
    bundlePath = join(tmp, 'dist-nia', 'index.js');
    bundle = readFileSync(bundlePath, 'utf8');
    tarEntries = readTar(gunzipSync(readFileSync(join(tmp, 'nia.tar.gz'))));
  }, 60_000);

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the bundle and the tarball under --out and leaves the repo artifacts alone', () => {
    expect(existsSync(bundlePath)).toBe(true);
    expect(sha256(realTarball)).toBe(tarballBefore);
    expect(existsSync(realDist)).toBe(distExistedBefore);
  });

  it('archives exactly index.js and package.json, byte for byte', () => {
    expect(tarEntries.map((entry) => entry.name)).toEqual(['index.js', 'package.json']);
    expect(tarEntries[0].data.equals(readFileSync(bundlePath))).toBe(true);
    expect(tarEntries[1].data.equals(readFileSync(join(tmp, 'dist-nia', 'package.json')))).toBe(true);
  });

  it('stages only index.js and package.json (no web public/ assets copied into dist-nia)', () => {
    expect(readdirSync(join(tmp, 'dist-nia')).sort()).toEqual(['index.js', 'package.json']);
  });

  it('generates a package.json that keeps undici as a pinned external dependency', () => {
    const generated = JSON.parse(tarEntries[1].data.toString('utf8'));
    const source = JSON.parse(readFileSync(resolve(root, 'functions/nia/package.json'), 'utf8'));

    expect(generated).toEqual({
      name: 'finanzas-plus-nia',
      private: true,
      type: 'module',
      main: 'index.js',
      engines: { node: '>=16' },
      dependencies: { undici: source.dependencies.undici },
    });
    expect(generated.dependencies.undici).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('only imports node: built-ins and undici, so nothing resolves outside the archive', () => {
    const specifiers = importSpecifiers(bundle);

    expect(specifiers).toContain('undici');
    expect(specifiers).toContain('node:crypto');
    for (const specifier of specifiers) {
      expect(specifier === 'undici' || specifier.startsWith('node:')).toBe(true);
    }
  });

  it('inlines the shared finance core and the debt modules instead of importing them', () => {
    expect(bundle).toMatch(/function planCommit\(/);
    expect(bundle).toMatch(/function commitPlan\(/);
    expect(bundle).toMatch(/function findDebt\(/);
    expect(importSpecifiers(bundle).filter((specifier) => specifier.startsWith('.') || specifier.includes('packages'))).toEqual([]);
  });

  it('inlines the budget module: line-based snapshot and one-month edit plan', () => {
    for (const name of ['loadBudgetMonth', 'planBudgetEdit', 'budgetWrites']) expect(bundle, name).toMatch(new RegExp(`function ${name}\\(`));
    expect(bundle).toContain('budget_lines');
  });

  it('inlines the advice pipeline: strategies, verdict, cash flow and the numeric guard', () => {
    for (const name of ['compareStrategies', 'advise', 'cashflowSignals', 'guardParaphrase', 'simulateReply', 'adviseReply']) {
      expect(bundle, name).toMatch(new RegExp(`function ${name}\\(`));
    }
  });

  it('keeps the debt modules free of APIs newer than Node 16.0 (array .at, Object.hasOwn)', () => {
    const dir = resolve(root, 'functions/nia/debt');
    const sources = readdirSync(dir).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'));

    expect(sources).toContain('handler.js');
    for (const name of sources) expect(readFileSync(join(dir, name), 'utf8'), name).not.toMatch(/\.at\(|Object\.hasOwn\(/);
  });

  it('is a negative control: the import check flags relative and packages/ paths', () => {
    expect(importSpecifiers('import a from "../../packages/finance-core/index.js";\nimport("./x.js");\nrequire("fs");'))
      .toEqual(['../../packages/finance-core/index.js', './x.js', 'fs']);
  });

  it('contains none of the APIs missing from Node 16', () => {
    expect(scanForbiddenApis(bundle)).toEqual([]);
  });

  it('loads with a stubbed env and a GET answers {ok:true, service:"nia"}', () => {
    // undici is external: link it into the temp dir the way Appwrite would install it.
    const undiciDir = dirname(createRequire(resolve(root, 'functions/nia/package.json')).resolve('undici/package.json'));
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    symlinkSync(undiciDir, join(tmp, 'node_modules', 'undici'), 'junction');

    const loader = [
      "import { pathToFileURL } from 'node:url';",
      'const mod = await import(pathToFileURL(process.argv[1]).href);',
      'let body;',
      'const res = { json: (value) => { body = value; return value; } };',
      "await mod.default({ req: { method: 'GET', headers: {} }, res, log: () => {}, error: () => {} });",
      'process.stdout.write(JSON.stringify(body));',
    ].join('\n');
    const env = Object.fromEntries(
      Object.entries({
        SystemRoot: process.env.SystemRoot,
        APPWRITE_ENDPOINT: 'https://appwrite.invalid/v1',
        APPWRITE_PROJECT_ID: 'project',
        APPWRITE_API_KEY: 'key',
        APPWRITE_DATABASE_ID: 'database',
        HOUSEHOLD_TEAM_ID: 'team',
        HOUSEHOLD_ID: 'household',
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_WEBHOOK_SECRET: 'secret',
        GEMINI_API_KEY: 'gemini',
      }).filter(([, value]) => value !== undefined),
    );

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', loader, bundlePath], {
      cwd: tmp,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(JSON.parse(output)).toEqual({ ok: true, service: 'nia' });
  }, 30_000);

  it('fails the build when the bundle uses a forbidden API (fixture with findLast)', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'package-nia-fixture-'));
    try {
      const entry = join(fixtureDir, 'entry.js');
      writeFileSync(entry, 'export default () => [1, 2, 3].findLast((n) => n < 3);\n');
      const out = join(fixtureDir, 'out');

      let failure;
      try {
        run(['--out', out, '--entry', entry]);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeDefined();
      expect(failure.status).not.toBe(0);
      expect(String(failure.stderr)).toContain('findLast');
      // The scan runs before archiving, so no tarball is produced.
      expect(existsSync(join(out, 'nia.tar.gz'))).toBe(false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 60_000);
});
