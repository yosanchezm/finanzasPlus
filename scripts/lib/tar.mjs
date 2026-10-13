import { gzipSync } from 'node:zlib';

// Minimal in-process ustar writer. It only supports regular files with short
// names, which is all the Nia Function archive needs. No subprocess, no `tar`
// binary: the output is identical on Windows and Linux.

const BLOCK = 512;
const NAME_MAX_BYTES = 100;
const DEFAULT_MODE = 0o644;

const toBuffer = (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data));

const assertName = (name) => {
  if (typeof name !== 'string' || name === '') throw new Error('Tar entry name must be a non-empty string');
  if (name.startsWith('/') || name.split('/').includes('..')) {
    throw new Error(`Invalid tar entry name (absolute or parent path): ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > NAME_MAX_BYTES) {
    throw new Error(`Tar entry name exceeds ${NAME_MAX_BYTES} bytes: ${name}`);
  }
};

// Octal number, zero padded to `width - 1` digits and terminated with NUL.
const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;

const buildHeader = ({ name, size, mode, mtime }) => {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 'utf8');
  header.write(octal(mode, 8), 100, 'latin1');
  header.write(octal(0, 8), 108, 'latin1'); // uid
  header.write(octal(0, 8), 116, 'latin1'); // gid
  header.write(octal(size, 12), 124, 'latin1');
  header.write(octal(mtime, 12), 136, 'latin1');
  header.fill(0x20, 148, 156); // checksum counts as spaces while summing
  header.write('0', 156, 'latin1'); // regular file
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263, 'latin1');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return header;
};

const padToBlock = (data) => {
  const remainder = data.length % BLOCK;
  return remainder === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - remainder)]);
};

/**
 * Builds an uncompressed ustar archive.
 * @param {Array<{name: string, data: string|Uint8Array, mode?: number, mtime?: number}>} entries
 *   `mtime` is in seconds and defaults to 0 so the archive is reproducible.
 * @returns {Buffer}
 */
export function createTar(entries) {
  const parts = [];
  for (const { name, data, mode = DEFAULT_MODE, mtime = 0 } of entries) {
    assertName(name);
    const content = toBuffer(data);
    parts.push(buildHeader({ name, size: content.length, mode, mtime }), padToBlock(content));
  }
  parts.push(Buffer.alloc(2 * BLOCK)); // end-of-archive marker
  return Buffer.concat(parts);
}

/** Same as {@link createTar}, gzip-compressed. */
export function createTarGz(entries) {
  return gzipSync(createTar(entries), { level: 9 });
}
