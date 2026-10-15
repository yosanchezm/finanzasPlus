import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExplainCopy } from './check-explain-copy.mjs';
import { createTarGz } from './lib/tar.mjs';

// Builds the Nia Appwrite Function package:
//   1. bundles functions/nia/index.js with Vite (SSR build, Node 16 target),
//      inlining relative sources and keeping `undici` as an external dependency;
//   2. writes a minimal package.json next to the bundle;
//   3. fails if the bundle uses an API that does not exist in Node 16;
//   4. archives both files as functions/nia.tar.gz.
// Before building, it runs the explain copy gate (scripts/check-explain-copy.mjs): packaging fails while any reviewed copy
// key is missing or unreviewed, unless NIA_ALLOW_UNREVIEWED=1 is set. It also scans the explain and advisor sources.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_ENGINE = '>=16';
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

// Vite's `target` only lowers syntax, never APIs, so APIs are scanned by hand.
// `.at()` is deliberately absent: Node 16.6+ ships it and Nia already uses it;
// the shared core is held to the stricter rule by its own static test.
const FORBIDDEN_APIS = [
  ['findLast', /\.findLast\(/],
  ['findLastIndex', /\.findLastIndex\(/],
  ['toSorted', /\.toSorted\(/],
  ['toReversed', /\.toReversed\(/],
  ['toSpliced', /\.toSpliced\(/],
  ['with()', /\.with\(/],
  ['structuredClone', /\bstructuredClone\s*\(/],
  ['Object.groupBy', /\bObject\.groupBy\b/],
  ['Map.groupBy', /\bMap\.groupBy\b/],
];

/** Returns the names of the Node 16 incompatible APIs used in `source`. */
export function scanForbiddenApis(source) {
  return FORBIDDEN_APIS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

// The sources of the explain and advisor flows are held to the core's stricter rule (no array `.at(`, no `Object.hasOwn`).
const SOURCE_DIRS = ['functions/nia/debt/explain', 'functions/nia/debt/advisor'];
const SOURCE_ONLY_APIS = [
  ['.at()', /\.at\(/],
  ['Object.hasOwn', /\bObject\.hasOwn\(/],
];

/**
 * Scans the non-test sources of `dirs` (relative to the repository root, or absolute) for Node 16 incompatible constructs.
 * A directory that does not exist yet is skipped.
 * @returns {{ file: string, found: string[] }[]}
 */
export function scanSourceDirs(dirs = SOURCE_DIRS) {
  const offenders = [];
  for (const dir of dirs) {
    const base = isAbsolute(dir) ? dir : resolve(repoRoot, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).filter((entry) => entry.endsWith('.js') && !entry.endsWith('.test.js'))) {
      const source = readFileSync(join(base, name), 'utf8');
      const found = [...scanForbiddenApis(source), ...SOURCE_ONLY_APIS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label)];
      if (found.length > 0) offenders.push({ file: join(dir, name), found });
    }
  }
  return offenders;
}

const fromRoot = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));

function generatedPackageJson() {
  const source = JSON.parse(readFileSync(resolve(repoRoot, 'functions/nia/package.json'), 'utf8'));
  const undici = source.dependencies?.undici;
  if (!EXACT_VERSION.test(String(undici))) {
    throw new Error(`functions/nia/package.json must pin undici to an exact version, found: ${undici}`);
  }
  return {
    name: source.name,
    private: true,
    type: 'module',
    main: 'index.js',
    engines: { node: NODE_ENGINE },
    dependencies: { undici },
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.outDir] bundle directory (default `dist-nia`)
 * @param {string} [options.tarPath] archive path (default `functions/nia.tar.gz`)
 * @param {string} [options.entry] bundle entry (default `functions/nia/index.js`)
 * @returns {Promise<{outDir: string, tarPath: string}>}
 */
export async function packageNia({
  outDir = 'dist-nia',
  tarPath = 'functions/nia.tar.gz',
  entry = 'functions/nia/index.js',
} = {}) {
  const bundleDir = fromRoot(outDir);
  const archivePath = fromRoot(tarPath);

  const copyCheck = checkExplainCopy();
  if (!copyCheck.ok) throw new Error(copyCheck.lines.join('\n'));
  if (copyCheck.override) console.warn(copyCheck.lines.join('\n'));
  const sourceOffenders = scanSourceDirs();
  if (sourceOffenders.length > 0) {
    throw new Error(`Node 16 incompatible constructs in the sources: ${sourceOffenders.map(({ file, found }) => `${file} (${found.join(', ')})`).join('; ')}`);
  }

  // Loaded lazily so importing this module (for the scan) stays cheap.
  const { build } = await import('vite');
  await build({
    configFile: false,
    root: repoRoot,
    logLevel: 'warn',
    publicDir: false, // do not copy the web app's public/ assets into the Function bundle
    ssr: { external: ['undici'] },
    build: {
      ssr: fromRoot(entry),
      target: 'node16',
      outDir: bundleDir,
      emptyOutDir: true,
      minify: false,
      rolldownOptions: { output: { format: 'esm', entryFileNames: 'index.js' } },
    },
  });

  const bundle = readFileSync(join(bundleDir, 'index.js'));
  const manifest = Buffer.from(`${JSON.stringify(generatedPackageJson(), null, 2)}\n`, 'utf8');
  writeFileSync(join(bundleDir, 'package.json'), manifest);

  const forbidden = scanForbiddenApis(bundle.toString('utf8'));
  if (forbidden.length > 0) {
    throw new Error(`The bundle uses APIs missing from Node 16: ${forbidden.join(', ')}`);
  }

  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(
    archivePath,
    createTarGz([
      { name: 'index.js', data: bundle },
      { name: 'package.json', data: manifest },
    ]),
  );
  return { outDir: bundleDir, tarPath: archivePath };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--out', '--entry'].includes(flag) || !value) throw new Error(`Usage: package-nia.mjs [--out <dir>] [--entry <file>]`);
    if (flag === '--out') {
      // Redirects both the bundle and the archive so tests never touch functions/nia.tar.gz.
      options.outDir = join(resolve(value), 'dist-nia');
      options.tarPath = join(resolve(value), 'nia.tar.gz');
    } else {
      options.entry = resolve(value);
    }
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { tarPath } = await packageNia(parseArgs(process.argv.slice(2)));
    console.log(`Nia package written to ${tarPath}`);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
