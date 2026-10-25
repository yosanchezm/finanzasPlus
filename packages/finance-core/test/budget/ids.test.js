// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fnv1a64hex, lineIds, targetKey } from '../../src/budget/ids.js';

const category = { targetType: 'category', targetId: 'abc' };
const group = { targetType: 'group', targetId: 'saving' };

describe('fnv1a64hex', () => {
  it('matches the FNV-1a 64-bit reference vectors as 16 lowercase hex digits', () => {
    expect(fnv1a64hex('')).toBe('cbf29ce484222325');
    expect(fnv1a64hex('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64hex('category:abc')).toBe('a6b009ca135b60af');
    expect(fnv1a64hex('group:saving')).toBe('23cea9a5accb80f8');
  });

  it('hashes the UTF-8 bytes of multi-byte text', () => {
    expect(fnv1a64hex('category:Ñandú-ñ€')).toBe('5f54090b37035896');
  });
});

describe('targetKey', () => {
  it('prefixes the target type', () => {
    expect(targetKey(category)).toBe('category:abc');
    expect(targetKey(group)).toBe('group:saving');
  });
});

describe('lineIds', () => {
  it('builds 24-character ids from prefix, month and hash', () => {
    expect(lineIds.override(category, '2026-10')).toBe('bo202610a6b009ca135b60af');
    expect(lineIds.recurring(group, '2026-07')).toBe('br20260723cea9a5accb80f8');
    expect(lineIds.seeded(category, '2026-11')).toBe('bs202611a6b009ca135b60af');
  });

  it('keeps migrated ids as bl plus the budget id', () => {
    expect(lineIds.migrated('abc')).toBe('blabc');
  });

  it('stays within 36 characters for a 36-character category id and is deterministic', () => {
    const long = { targetType: 'category', targetId: 'c'.repeat(36) };
    const id = lineIds.recurring(long, '2026-01');
    expect(id.length).toBeLessThanOrEqual(36);
    expect(lineIds.recurring(long, '2026-01')).toBe(id);
  });
});
