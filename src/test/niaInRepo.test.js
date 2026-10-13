// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

// No shell: arguments go straight to git, and every call is pinned to the repo root.
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const tracked = (...paths) =>
  git('ls-files', '-s', '--', ...paths)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { mode: meta.split(' ')[0], path };
    });
const ignoredPaths = (...paths) => {
  try {
    return git('check-ignore', '--', ...paths).split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
};
const lines = (path) =>
  readFileSync(resolve(root, path), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

describe('Nia is tracked as plain files', () => {
  it('tracks index.js, package.json and README.md as regular blobs (100644)', () => {
    const entries = tracked('functions/nia/index.js', 'functions/nia/package.json', 'functions/nia/README.md');

    expect(entries.map((entry) => entry.path).sort()).toEqual([
      'functions/nia/README.md',
      'functions/nia/index.js',
      'functions/nia/package.json',
    ]);
    expect(entries.every((entry) => entry.mode === '100644')).toBe(true);
  });

  it('has no gitlink (mode 160000) anywhere under functions/', () => {
    const entries = tracked('functions');

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((entry) => entry.mode === '160000')).toEqual([]);
  });

  it('has no nested .git left under functions/nia', () => {
    expect(existsSync(resolve(root, 'functions/nia/.git'))).toBe(false);
  });
});

describe('generated and vendored files stay out of the index', () => {
  it('tracks nothing under node_modules and no functions/*.tar.gz', () => {
    const all = tracked('functions').map((entry) => entry.path);

    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((path) => path.includes('node_modules/'))).toEqual([]);
    expect(all.filter((path) => /^functions\/[^/]+\.tar\.gz$/.test(path))).toEqual([]);
  });

  it('ignores the Nia tarball and the dist-nia build directory', () => {
    const paths = ['functions/nia.tar.gz', 'functions/nia-deploy.tar.gz', 'dist-nia/index.js'];

    expect(ignoredPaths(...paths).sort()).toEqual([...paths].sort());
  });

  it('does not ignore the Nia sources', () => {
    expect(ignoredPaths('functions/nia/index.js', 'functions/nia/package.json', 'functions/nia/README.md')).toEqual([]);
  });
});

describe('web image build context', () => {
  it('excludes dist-nia but keeps packages/ available to the build', () => {
    const entries = lines('.dockerignore');

    expect(entries).toContain('dist-nia');
    expect(entries).not.toContain('packages');
    expect(entries).not.toContain('packages/');
  });
});
