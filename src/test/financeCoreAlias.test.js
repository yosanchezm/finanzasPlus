// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from 'vite';
import * as viaAlias from '@finance-core';
import * as viaPath from '../../packages/finance-core/index.js';
import { buildSchedule, project, rateLabel } from '@finance-core';

const root = process.cwd();

describe('@finance-core alias (AD3)', () => {
  it('resolves the public barrel of packages/finance-core', () => {
    expect(typeof buildSchedule).toBe('function');
    expect(typeof project).toBe('function');
    expect(Object.keys(viaAlias).sort()).toEqual(Object.keys(viaPath).sort());
    expect(viaAlias.buildSchedule).toBe(viaPath.buildSchedule);
  });

  it('runs real core code through the alias', () => {
    expect(rateLabel({ value: 2.1, basis: 'effective', periodicity: 'monthly', timing: 'arrears' })).toBe('2.1% MV ≈ 28.32% EA');
    const rows = buildSchedule({
      schemaVersion: 1, kind: 'family', unit: 'COP', principalMinor: 1200000, openedOn: '2026-01-01',
      rate: { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
      system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-01',
      charges: [], prepaymentPenaltyPct: 0, roundingUnit: 1,
    });
    expect(rows).toHaveLength(12);
    expect(rows[0].installmentMinor).toBe(100000);
  });

  it('is declared in vite.config.js for the app, the tests and the build alike', async () => {
    const config = await resolveConfig({ configFile: resolve(root, 'vite.config.js'), root }, 'build');
    const entry = config.resolve.alias.find((alias) => alias.find === '@finance-core');
    expect(entry).toBeDefined();
    expect(existsSync(resolve(entry.replacement, 'index.js'))).toBe(true);
    expect(resolve(entry.replacement)).toBe(resolve(root, 'packages/finance-core'));
  });

  it('keeps packages/ inside the Docker build context (web image builds with the alias)', () => {
    const lines = readFileSync(resolve(root, '.dockerignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((line) => /(^|\/)packages(\/|$)/.test(line))).toEqual([]);
  });
});
