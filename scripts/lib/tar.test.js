// @vitest-environment node
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createTar, createTarGz } from './tar.mjs';

const BLOCK = 512;

const field = (buffer, offset, length) =>
  buffer.subarray(offset, offset + length).toString('latin1').replace(/\0.*$/s, '');

// Recomputes the ustar checksum: the sum of every header byte with the
// checksum field itself counted as eight ASCII spaces.
const expectedChecksum = (header) => {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return sum;
};

describe('createTar', () => {
  it('writes a ustar header with name, size, magic and a valid checksum', () => {
    const tar = createTar([{ name: 'index.js', data: 'export default 1;\n' }]);
    const header = tar.subarray(0, BLOCK);

    expect(field(header, 0, 100)).toBe('index.js');
    expect(parseInt(field(header, 124, 12), 8)).toBe(Buffer.byteLength('export default 1;\n'));
    expect(field(header, 156, 1)).toBe('0');
    expect(field(header, 257, 6)).toBe('ustar');
    expect(field(header, 263, 2)).toBe('00');
    expect(parseInt(field(header, 148, 8), 8)).toBe(expectedChecksum(header));
  });

  it('pads each entry to 512 bytes and ends with two zero blocks', () => {
    const exact = Buffer.alloc(BLOCK, 'a');
    const over = Buffer.alloc(BLOCK + 1, 'b');
    const tar = createTar([
      { name: 'exact.txt', data: exact },
      { name: 'over.txt', data: over },
    ]);

    // header + 1 data block, header + 2 data blocks, 2 end blocks
    expect(tar.length).toBe((1 + 1 + 1 + 2 + 2) * BLOCK);
    expect(tar.length % BLOCK).toBe(0);
    expect(tar.subarray(BLOCK, 2 * BLOCK).equals(exact)).toBe(true);

    const secondHeaderAt = 2 * BLOCK;
    expect(field(tar, secondHeaderAt, 100)).toBe('over.txt');
    const dataAt = secondHeaderAt + BLOCK;
    expect(tar.subarray(dataAt, dataAt + BLOCK + 1).equals(over)).toBe(true);
    expect(tar.subarray(dataAt + BLOCK + 1, dataAt + 2 * BLOCK).every((byte) => byte === 0)).toBe(true);

    const end = tar.subarray(tar.length - 2 * BLOCK);
    expect(end.length).toBe(2 * BLOCK);
    expect(end.every((byte) => byte === 0)).toBe(true);
  });

  it('keeps an empty file as a header with no data blocks', () => {
    const tar = createTar([{ name: 'empty.txt', data: '' }]);

    expect(tar.length).toBe(BLOCK + 2 * BLOCK);
    expect(parseInt(field(tar, 124, 12), 8)).toBe(0);
  });

  it('is deterministic: same entries give identical bytes', () => {
    const entries = [{ name: 'a.txt', data: 'one' }, { name: 'b.txt', data: 'two' }];

    expect(createTar(entries).equals(createTar(entries))).toBe(true);
    expect(parseInt(field(createTar(entries), 136, 12), 8)).toBe(0);
  });

  it('honours an explicit mtime and mode', () => {
    const tar = createTar([{ name: 'a.txt', data: 'x', mode: 0o755, mtime: 1_700_000_000 }]);

    expect(parseInt(field(tar, 100, 8), 8)).toBe(0o755);
    expect(parseInt(field(tar, 136, 12), 8)).toBe(1_700_000_000);
    expect(parseInt(field(tar, 148, 8), 8)).toBe(expectedChecksum(tar.subarray(0, BLOCK)));
  });

  it('rejects names over 100 bytes but accepts exactly 100', () => {
    expect(() => createTar([{ name: 'a'.repeat(101), data: 'x' }])).toThrow(/100/);
    expect(() => createTar([{ name: 'a'.repeat(100), data: 'x' }])).not.toThrow();
    // 51 two-byte characters = 102 bytes although only 51 characters long.
    expect(() => createTar([{ name: 'é'.repeat(51), data: 'x' }])).toThrow(/100/);
  });

  it('rejects empty names and unsafe paths', () => {
    expect(() => createTar([{ name: '', data: 'x' }])).toThrow(/name/i);
    expect(() => createTar([{ name: '../escape.js', data: 'x' }])).toThrow(/name/i);
    expect(() => createTar([{ name: '/abs.js', data: 'x' }])).toThrow(/name/i);
  });
});

describe('createTarGz', () => {
  it('round-trips through zlib.gunzipSync to the plain tar bytes', () => {
    const entries = [
      { name: 'index.js', data: 'console.log(1);\n' },
      { name: 'package.json', data: Buffer.from('{"type":"module"}\n') },
    ];
    const gz = createTarGz(entries);

    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(gunzipSync(gz).equals(createTar(entries))).toBe(true);
  });
});
