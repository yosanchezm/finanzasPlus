// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../index.js';

// The Appwrite Function runs on Node 16 and the core also ships to browsers, so
// the core must stay dependency-free and avoid APIs newer than Node 16. Vite's
// `target` only lowers syntax, never APIs, so this static scan is the guard.
// It is stricter than the Nia bundle scan: it also forbids array `.at(`.

const CORE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const FORBIDDEN = [
  { name: 'findLast', pattern: /\bfindLast(Index)?\b/ },
  { name: 'toSorted', pattern: /\btoSorted\b/ },
  { name: 'toReversed', pattern: /\btoReversed\b/ },
  { name: 'toSpliced', pattern: /\btoSpliced\b/ },
  { name: 'with', pattern: /\.with\s*\(/ },
  { name: 'structuredClone', pattern: /\bstructuredClone\b/ },
  { name: 'groupBy', pattern: /\b(Object|Map)\.groupBy\b/ },
  { name: 'Object.hasOwn', pattern: /\bObject\.hasOwn\b/ },
  { name: 'at', pattern: /\.at\s*\(/ },
  {
    name: 'regex v flag',
    pattern:
      /(?:^|[=(,:;!&|?{}[]|\breturn|\bcase)\s*\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*v[a-z]*|new\s+RegExp\([^)]*,\s*['"`][a-z]*v[a-z]*['"`]\s*\)/m,
  },
];

const findForbidden = (source) => FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);

// Production sources only: the tests legitimately name the forbidden APIs.
function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

const importSpecifiers = (source) => {
  const specifiers = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s*['"]([^'"]+)['"]/gm];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
};

const files = sourceFiles(CORE_ROOT).map((path) => ({
  path: relative(CORE_ROOT, path).split('\\').join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('forbidden API scanner (self-check)', () => {
  it('flags each Node 17+ API and the array .at( call', () => {
    expect(findForbidden('items.findLast((x) => x)')).toEqual(['findLast']);
    expect(findForbidden('items.findLastIndex(Boolean)')).toEqual(['findLast']);
    expect(findForbidden('const s = list.toSorted()')).toEqual(['toSorted']);
    expect(findForbidden('const r = list.toReversed()')).toEqual(['toReversed']);
    expect(findForbidden('list.toSpliced(0, 1)')).toEqual(['toSpliced']);
    expect(findForbidden('list.with(0, 1)')).toEqual(['with']);
    expect(findForbidden('const c = structuredClone(value)')).toEqual(['structuredClone']);
    expect(findForbidden('Object.groupBy(rows, key)')).toEqual(['groupBy']);
    expect(findForbidden('Map.groupBy(rows, key)')).toEqual(['groupBy']);
    expect(findForbidden('if (Object.hasOwn(o, k)) {}')).toEqual(['Object.hasOwn']);
    expect(findForbidden('const last = rows.at(-1);')).toEqual(['at']);
  });

  it('flags the regex v flag in literals and in the RegExp constructor', () => {
    expect(findForbidden('const re = /[\\p{L}--[a-z]]/v;')).toEqual(['regex v flag']);
    expect(findForbidden('return /abc/giv.test(text);')).toEqual(['regex v flag']);
    expect(findForbidden("const re = new RegExp('a+', 'v');")).toEqual(['regex v flag']);
  });

  it('does not flag ordinary code', () => {
    const clean = [
      'const last = rows[rows.length - 1];',
      'const label = data.attributes.format(withdraw);',
      "text.replace(/a/g, 'v');",
      'const ratio = a / b / value;',
      'const re = /ab+c/gi;',
      'const total = items.reduce((sum, item) => sum + item, 0);',
      "Object.prototype.hasOwnProperty.call(object, 'key');",
    ].join('\n');
    expect(findForbidden(clean)).toEqual([]);
  });
});

describe('finance-core sources', () => {
  it('scans the real sources (not an empty list)', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'index.js',
        'src/advice/advice.js',
        'src/advice/facts.js',
        'src/calendar.js',
        'src/chargePresets.js',
        'src/charges.js',
        'src/errors.js',
        'src/explain/allowed.js',
        'src/explain/copy.js',
        'src/explain/explain.js',
        'src/explain/facts/allocation.js',
        'src/explain/facts/card.js',
        'src/explain/facts/charges.js',
        'src/explain/facts/mora.js',
        'src/explain/facts/prepayment.js',
        'src/explain/facts/rates.js',
        'src/explain/facts/restructure.js',
        'src/explain/facts/usury.js',
        'src/explain/format.js',
        'src/explain/hash.js',
        'src/explain/topics.js',
        'src/ledger/allocate.js',
        'src/ledger/commit.js',
        'src/ledger/correction.js',
        'src/ledger/events.js',
        'src/ledger/preview.js',
        'src/ledger/project.js',
        'src/ledger/restructure.js',
        'src/ledger/rows.js',
        'src/ledger/snapshot.js',
        'src/ledger/tail.js',
        'src/late/accrue.js',
        'src/late/policy.js',
        'src/legal.js',
        'src/money.js',
        'src/prepay/compare.js',
        'src/prepay/simulate.js',
        'src/rates.js',
        'src/schedule/bullet.js',
        'src/schedule/french.js',
        'src/schedule/german.js',
        'src/schedule/grace.js',
        'src/schedule/index.js',
        'src/schedule/interestOnly.js',
        'src/schedule/manual.js',
        'src/schedule/row.js',
        'src/terms.js',
      ]),
    );
  });

  it('uses no API newer than Node 16 and no regex v flag', () => {
    const offenders = files
      .map((file) => ({ path: file.path, found: findForbidden(file.source) }))
      .filter((entry) => entry.found.length > 0);
    expect(offenders).toEqual([]);
  });

  it('imports only relative modules with an explicit .js extension, so it stays dependency-free and browser-safe', () => {
    const imports = files.flatMap((file) => importSpecifiers(file.source).map((specifier) => ({ path: file.path, specifier })));
    expect(imports.length).toBeGreaterThan(5);
    const offenders = imports.filter(({ specifier }) => !/^\.{1,2}\/.*\.js$/.test(specifier));
    expect(offenders).toEqual([]);
  });
});

describe('public barrel (index.js)', () => {
  it('exports exactly the public API and no internals', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'ADVICE_DEFAULTS',
        'CHARGE_PRESET_SPECS',
        'CONVENTIONS',
        'CommitError',
        'DEFAULT_LEGAL',
        'EXPLAIN_COPY',
        'EXPLAIN_TOPICS',
        'EVENT_KINDS',
        'LATE_MODES',
        'LEGAL_MODALITIES',
        'PERIODICITIES',
        'SMMLV_TABLE',
        'TERMS_MAX_CHARS',
        'TERMS_SCHEMA_VERSION',
        'TermsTooLarge',
        'USURY_TABLE',
        'ValidationError',
        'activeCategories',
        'activeEvents',
        'addDays',
        'addExplicitCharge',
        'addMonthsClamped',
        'addPresetCharge',
        'advise',
        'allocate',
        'allowedTexts',
        'assertMinor',
        'buildCorrection',
        'buildCostRow',
        'buildRestructureTerms',
        'buildFacts',
        'buildSchedule',
        'capOn',
        'commitPlan',
        'compareIso',
        'compareStrategies',
        'convertRate',
        'copyStatus',
        'cycleDates',
        'dailyRate',
        'daysBetween',
        'defaultLateFor',
        'evaluateCharges',
        'explainFacts',
        'findActiveCategory',
        'foldCategoryName',
        'isIsoDate',
        'lastStatementOn',
        'lateEAOn',
        'lateRateOn',
        'legalOf',
        'legalRateId',
        'legalValueInRange',
        'ley1555Notice',
        'minimumPayment',
        'modalityOf',
        'normalizeCharges',
        'normalizeLate',
        'normalizeRate',
        'parseTerms',
        'periodDates',
        'periodicRate',
        'planCommit',
        'presetCharges',
        'previewChange',
        'project',
        'rateInForce',
        'rateLabel',
        'registerProjector',
        'releasedTopics',
        'removeCharge',
        'renderSummary',
        'restructureCarry',
        'resolveLegal',
        'roundUnit',
        'serializeTerms',
        'simulateExtra',
        'smmlvFor',
        'sumMinor',
        'summarizeSchedule',
        'toEffectiveAnnual',
        'sortEvents',
        'usuryFromIbcBp',
        'usuryNotice',
        'validateEvent',
        'validateTerms',
        'versionTermsAt',
      ].sort(),
    );
  });

  it('re-exports working functions, not placeholders', () => {
    expect(api.roundUnit(-2.5)).toBe(-3);
    expect(api.addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(api.rateLabel(api.normalizeRate({ convention: 'MV', value: 2.1 }))).toBe('2.1% MV ≈ 28.32% EA');
    expect(api.usuryNotice(api.normalizeRate({ convention: 'EA', value: 30 }), 'consumer', '2026-10-12').capEA).toBe(28.59);
    expect(() => api.assertMinor(1.5)).toThrow(api.ValidationError);
    expect(api.usuryFromIbcBp(1949)).toBe(2924);
    expect(api.capOn(api.DEFAULT_LEGAL.usuryTable, 'consumer', '2026-12-05')).toMatchObject({ capEA: 28.59, stale: true });
    expect(api.smmlvFor(api.legalOf({}).smmlvTable, 2026)).toEqual({ valueMinor: 1750905, stale: false });
    expect(api.LEGAL_MODALITIES).toContain('mortgage');
    expect(api.removeCharge([{ id: 'a', basis: 'fixed' }, { id: 'b', basis: 'pctOfCharge', refId: 'a' }], 'a')).toEqual([]);
    expect(api.normalizeCharges([{ id: 'a', kind: 'fee', basis: 'fixed', value: 10 }])[0]).toMatchObject({ id: 'a', cadence: 'per_installment' });
    expect(typeof api.previewChange).toBe('function');
    expect(api.dailyRate(28.59)).toBeCloseTo(0.00068917, 8);
    expect(api.defaultLateFor('mortgage')).toEqual({ mode: 'usury', graceDays: 0 });
    expect(api.modalityOf({ kind: 'mortgage' })).toBe('mortgage');
    expect(api.lateEAOn({ kind: 'consumer', rate: api.normalizeRate({ convention: 'EA', value: 24 }), late: { mode: 'usury', graceDays: 0 } }, '2026-10-20').ea).toBe(28.59);
    expect(api.normalizeLate(undefined)).toEqual({ mode: 'none', graceDays: 0 });
    expect(api.LATE_MODES).toContain('contract_multiple');
    expect(api.EVENT_KINDS).toContain('late_policy');
    expect(api.restructureCarry({ $id: 'd1', terms: { kind: 'informal', principalMinor: 900_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' } }, [], '2026-03-01')).toMatchObject({ balanceMinor: 900_000, carriedMinor: 900_000, waivableLateMinor: 0 });
    expect(api.buildRestructureTerms(api.validateTerms({ kind: 'informal', principalMinor: 900_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' }), { effectiveOn: '2026-03-01', carriedMinor: 800_000, overrides: {} })).toMatchObject({ principalMinor: 800_000, openedOn: '2026-03-01' });
  });
});
