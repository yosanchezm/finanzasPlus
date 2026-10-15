// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyHash, topicCopyKeys } from '../packages/finance-core/src/explain/copy.js';
import { EXPLAIN_TOPICS } from '../packages/finance-core/src/explain/topics.js';
import { checkExplainCopy, printExplainCopy } from './check-explain-copy.mjs';

const root = process.cwd();
const script = resolve(root, 'scripts/check-explain-copy.mjs');
const packager = resolve(root, 'scripts/package-nia.mjs');

const NEEDED = [...new Set(EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic)))];
const entry = (text, overrides = {}) => ({ text, sources: [{ label: 'Fuente', url: 'https://example.test' }], reviewedOn: null, reviewedHash: null, ...overrides });
const reviewed = (text) => {
  const base = entry(text, { reviewedOn: '2026-10-01' });
  return { ...base, reviewedHash: copyHash(base) };
};
const fullCopy = () => Object.fromEntries(NEEDED.map((key) => [key, reviewed(`texto ${key}`)]));

// Runs a script and returns { status, stdout, stderr } without throwing.
const exec = (file, args = [], env = {}) => {
  const clean = { ...process.env };
  delete clean.NIA_ALLOW_UNREVIEWED;
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('checkExplainCopy', () => {
  it('fails and lists every missing key when the copy is empty', () => {
    const result = checkExplainCopy({ copy: {}, env: {} });

    expect(result.ok).toBe(false);
    expect(result.override).toBe(false);
    expect(result.missing).toEqual(NEEDED);
    expect(result.unreviewed).toEqual([]);
    expect(result.lines.join('\n')).toContain('mora.sample');
    expect(result.lines.join('\n')).toContain('legal.gmf');
  });

  it('tells a missing key from an unreviewed one and lets the reviewed ones through', () => {
    const copy = { 'legal.gmf': reviewed('GMF'), 'legal.mora': entry('Mora sin revisar'), 'mora.sample': { ...reviewed('Mora'), text: 'Mora editada' } };
    const result = checkExplainCopy({ copy, env: {} });

    expect(result.ok).toBe(false);
    expect(result.unreviewed).toEqual(['legal.mora', 'mora.sample']);
    expect(result.missing).toEqual(NEEDED.filter((key) => !(key in copy)));
    expect(result.missing).not.toContain('legal.gmf');
    expect(result.unreviewed).not.toContain('legal.gmf');
  });

  it('flags an entry without sources or without a matching hash as unreviewed', () => {
    const noSources = { ...reviewed('Sin fuentes'), sources: [] };
    const result = checkExplainCopy({ copy: { ...fullCopy(), 'legal.gmf': noSources, 'legal.mora': { ...reviewed('x'), reviewedHash: '00000000' } }, env: {} });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.unreviewed).toEqual(['legal.mora', 'legal.gmf'].sort((a, b) => NEEDED.indexOf(a) - NEEDED.indexOf(b)));
  });

  it('passes with no warning when every key is reviewed', () => {
    const result = checkExplainCopy({ copy: fullCopy(), env: {} });

    expect(result).toMatchObject({ ok: true, override: false, missing: [], unreviewed: [] });
    expect(result.lines.join('\n')).not.toMatch(/warning/i);
  });

  it('passes with NIA_ALLOW_UNREVIEWED=1 and a visible warning that lists what ships unreviewed', () => {
    const result = checkExplainCopy({ copy: {}, env: { NIA_ALLOW_UNREVIEWED: '1' } });

    expect(result.ok).toBe(true);
    expect(result.override).toBe(true);
    expect(result.lines.join('\n')).toMatch(/warning/i);
    expect(result.lines.join('\n')).toContain('NIA_ALLOW_UNREVIEWED=1');
    expect(result.lines.join('\n')).toContain('mora.sample');
  });

  it('accepts only the exact value 1 as the override', () => {
    for (const value of ['0', 'true', 'yes', '', ' 1']) {
      expect(checkExplainCopy({ copy: {}, env: { NIA_ALLOW_UNREVIEWED: value } }).ok).toBe(false);
    }
  });
});

describe('printExplainCopy', () => {
  it('lists every key with its status, text and sources', () => {
    const text = printExplainCopy({ ...fullCopy(), 'legal.gmf': entry('GMF 4 por mil', { sources: [{ label: 'Estatuto Tributario', url: 'https://example.test/gmf' }] }) }).join('\n');

    for (const key of NEEDED) expect(text).toContain(key);
    expect(text).toContain('GMF 4 por mil');
    expect(text).toContain('Estatuto Tributario');
    expect(text).toContain('https://example.test/gmf');
    expect(text).toMatch(/legal\.gmf.*unreviewed/);
    expect(text).toMatch(/legal\.mora.*reviewed/);
  });

  it('shows a missing key as missing', () => {
    expect(printExplainCopy({}).join('\n')).toMatch(/mora\.sample.*missing/);
  });
});

describe('check-explain-copy CLI (the shipped, empty copy)', () => {
  it('exits non-zero and lists the missing keys on stderr', () => {
    const result = exec(script);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('legal.gmf');
    expect(result.stderr).toContain('prepayment.sample');
  });

  it('exits zero with NIA_ALLOW_UNREVIEWED=1 and warns', () => {
    const result = exec(script, [], { NIA_ALLOW_UNREVIEWED: '1' });

    expect(result.status).toBe(0);
    expect(result.stderr + result.stdout).toMatch(/warning/i);
  });

  it('--print lists every key and exits zero', () => {
    const result = exec(script, ['--print']);

    expect(result.status).toBe(0);
    for (const key of NEEDED) expect(result.stdout).toContain(key);
  });
});

describe('package:nia runs the check before building the tarball', () => {
  it('refuses to package while the copy is unreviewed, and writes no tarball', () => {
    const out = mkdtempSync(join(tmpdir(), 'package-nia-gate-'));
    try {
      const result = exec(packager, ['--out', out]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('NIA_ALLOW_UNREVIEWED');
      expect(result.stderr).toContain('legal.gmf');
      expect(existsSync(join(out, 'nia.tar.gz'))).toBe(false);
      expect(existsSync(join(out, 'dist-nia'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
