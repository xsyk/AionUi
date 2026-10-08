/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_DIR,
  HOME_FALLBACK_DIR_NAME,
  INSTALL_DIRS_FILE,
  resolveInstallDirs,
  type InstallDirsFs,
} from '../../../packages/web-cli/src/installDirs.js';

// All paths go through path.join/normalize so the suite is independent of the
// host's path separator; the fake file system below is purely in-memory.
const DATA_DIR = path.resolve('/home/alice/.aionui-web');
const HOME_DIR = path.resolve('/home/alice');
const RECORD_PATH = path.join(DATA_DIR, INSTALL_DIRS_FILE);

const DEFAULT_LOG_DIR = path.join(DEFAULT_WORK_DIR, 'logs');
const HOME_WORK_DIR = path.join(HOME_DIR, HOME_FALLBACK_DIR_NAME);
const HOME_LOG_DIR = path.join(HOME_WORK_DIR, 'logs');
const DATA_ROOT = path.normalize('/data');

type FakeFsOptions = {
  /** Files that exist up front: path -> content (their parent dirs exist too). */
  files?: Record<string, string>;
  /** Directories that exist up front (their parents exist too). */
  dirs?: string[];
  /** mkdirSync on a path at or below the key throws an errno error with the value as `code`. */
  mkdirErrors?: Record<string, string>;
};

function errnoError(code: string, syscall: string, target: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: simulated failure, ${syscall} '${target}'`);
  error.code = code;
  return error;
}

function isSameOrBelow(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createFakeFs(options: FakeFsOptions = {}) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  /** Every path handed to mkdirSync, in call order (failed calls included). */
  const mkdirCalls: string[] = [];
  /** Every path handed to existsSync/readFileSync, in call order. */
  const readCalls: string[] = [];
  /** Every path handed to writeFileSync, in call order. */
  const writeCalls: string[] = [];

  const addDir = (dir: string): void => {
    let current = path.normalize(dir);
    while (!dirs.has(current)) {
      dirs.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };

  for (const dir of options.dirs ?? []) addDir(dir);
  for (const [file, content] of Object.entries(options.files ?? {})) {
    files.set(path.normalize(file), content);
    addDir(path.dirname(file));
  }

  const fakeFs: InstallDirsFs = {
    existsSync: (p) => {
      const target = path.normalize(p);
      readCalls.push(target);
      return files.has(target) || dirs.has(target);
    },
    readFileSync: (p) => {
      const target = path.normalize(p);
      readCalls.push(target);
      const content = files.get(target);
      if (content === undefined) throw errnoError('ENOENT', 'open', p);
      return content;
    },
    writeFileSync: (p, data) => {
      const target = path.normalize(p);
      writeCalls.push(target);
      // Like the real thing: writing into a directory that does not exist fails.
      if (!dirs.has(path.dirname(target))) throw errnoError('ENOENT', 'open', p);
      files.set(target, data);
    },
    mkdirSync: (p) => {
      const target = path.normalize(p);
      mkdirCalls.push(target);
      for (const [root, code] of Object.entries(options.mkdirErrors ?? {})) {
        if (isSameOrBelow(target, path.normalize(root))) throw errnoError(code, 'mkdir', p);
      }
      addDir(target);
    },
  };

  return { fs: fakeFs, files, dirs, mkdirCalls, readCalls, writeCalls };
}

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function recordOf(workDir: string, logDir: string): Record<string, string> {
  return { [RECORD_PATH]: JSON.stringify({ workDir, logDir }) };
}

function readRecord(files: Map<string, string>): unknown {
  const content = files.get(path.normalize(RECORD_PATH));
  return content === undefined ? undefined : JSON.parse(content);
}

describe('install dirs constants', () => {
  it('pins the documented defaults', () => {
    expect(DEFAULT_WORK_DIR).toBe('/data/.AionEasiful');
    expect(HOME_FALLBACK_DIR_NAME).toBe('.AionEasiful');
    expect(INSTALL_DIRS_FILE).toBe('install-dirs.json');
  });
});

describe('resolveInstallDirs: first start (nothing recorded yet)', () => {
  it('creates /data/.AionEasiful and its logs dir, then records them', () => {
    const { fs: fakeFs, files, dirs } = createFakeFs({ dirs: [DATA_DIR] });

    const result = resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fakeFs });

    expect(result).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR, source: 'installed' });
    expect(dirs.has(path.normalize(DEFAULT_LOG_DIR))).toBe(true);
    expect(readRecord(files)).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR });
  });

  it('creates the data dir before writing the record when it does not exist yet', () => {
    const { fs: fakeFs, files, dirs } = createFakeFs();

    resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fakeFs });

    expect(dirs.has(path.normalize(DATA_DIR))).toBe(true);
    expect(readRecord(files)).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR });
  });

  it.each(['EACCES', 'EPERM', 'EROFS'])('falls back to the home dir when /data fails with %s', (code) => {
    const { fs: fakeFs, files, dirs } = createFakeFs({ dirs: [DATA_DIR], mkdirErrors: { [DATA_ROOT]: code } });

    const result = resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fakeFs });

    expect(result).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR, source: 'installed-home-fallback' });
    expect(dirs.has(path.normalize(HOME_WORK_DIR))).toBe(true);
    expect(dirs.has(path.normalize(HOME_LOG_DIR))).toBe(true);
    expect(readRecord(files)).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR });
  });

  it.each(['ENOSPC', 'ENOTDIR'])('rethrows %s from /data without falling back or recording anything', (code) => {
    const fake = createFakeFs({ dirs: [DATA_DIR], mkdirErrors: { [DEFAULT_WORK_DIR]: code } });

    const error = catchError(() => resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fake.fs }));

    expect(error).toMatchObject({ code });
    expect(fake.files.has(path.normalize(RECORD_PATH))).toBe(false);
    expect(fake.mkdirCalls.some((dir) => isSameOrBelow(dir, HOME_DIR))).toBe(false);
  });

  it('keeps the default log dir in the record when only the log dir is given explicitly', () => {
    const logDir = path.resolve('/var/log/aionui');
    const { fs: fakeFs, files } = createFakeFs({ dirs: [DATA_DIR] });

    const result = resolveInstallDirs({
      dataDir: DATA_DIR,
      homeDir: HOME_DIR,
      explicitLogDir: logDir,
      fs: fakeFs,
    });

    expect(result).toEqual({ workDir: DEFAULT_WORK_DIR, logDir, source: 'installed' });
    // The record holds the install-time decision, not a one-off override.
    expect(readRecord(files)).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR });
  });
});

describe('resolveInstallDirs: install-dirs.json already exists', () => {
  it('uses the recorded dirs and never tries /data again, even when /data is writable', () => {
    const fake = createFakeFs({ files: recordOf(HOME_WORK_DIR, HOME_LOG_DIR) });

    const result = resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fake.fs });

    expect(result).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR, source: 'recorded' });
    expect(fake.mkdirCalls.some((dir) => isSameOrBelow(dir, DATA_ROOT))).toBe(false);
    expect(fake.dirs.has(path.normalize(HOME_WORK_DIR))).toBe(true);
    expect(fake.dirs.has(path.normalize(HOME_LOG_DIR))).toBe(true);
    // The existing record is authoritative; it is not rewritten.
    expect(fake.writeCalls).toEqual([]);
  });

  it('uses a recorded /data location as is', () => {
    const { fs: fakeFs } = createFakeFs({ files: recordOf(DEFAULT_WORK_DIR, DEFAULT_LOG_DIR) });

    const result = resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fakeFs });

    expect(result).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR, source: 'recorded' });
  });

  it.each([
    ['work dir', DEFAULT_WORK_DIR],
    ['log dir', DEFAULT_LOG_DIR],
  ])('throws when the recorded %s cannot be created, without falling back', (_label, failingDir) => {
    const recordFiles = recordOf(DEFAULT_WORK_DIR, DEFAULT_LOG_DIR);
    const fake = createFakeFs({ files: recordFiles, mkdirErrors: { [failingDir]: 'EACCES' } });

    const error = catchError(() => resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fake.fs }));

    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toContain('recorded at installation');
    expect(message).toContain(failingDir);
    expect(error).toMatchObject({ code: 'EACCES' });
    expect(fake.mkdirCalls.some((dir) => isSameOrBelow(dir, HOME_DIR))).toBe(false);
    expect(fake.files.get(path.normalize(RECORD_PATH))).toBe(recordFiles[RECORD_PATH]);
  });

  it('lets an explicit log dir override the recorded one', () => {
    const logDir = path.resolve('/var/log/aionui');
    const { fs: fakeFs, files, writeCalls } = createFakeFs({ files: recordOf(HOME_WORK_DIR, HOME_LOG_DIR) });

    const result = resolveInstallDirs({
      dataDir: DATA_DIR,
      homeDir: HOME_DIR,
      explicitLogDir: logDir,
      fs: fakeFs,
    });

    expect(result).toEqual({ workDir: HOME_WORK_DIR, logDir, source: 'recorded' });
    expect(writeCalls).toEqual([]);
    expect(readRecord(files)).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR });
  });

  it.each([
    ['not JSON', 'definitely not json {'],
    ['an empty file', ''],
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"/data/.AionEasiful"'],
    ['a missing logDir', JSON.stringify({ workDir: HOME_WORK_DIR })],
    ['a missing workDir', JSON.stringify({ logDir: HOME_LOG_DIR })],
    ['an empty logDir', JSON.stringify({ workDir: HOME_WORK_DIR, logDir: '' })],
    ['a relative workDir', JSON.stringify({ workDir: 'relative/work', logDir: HOME_LOG_DIR })],
    ['a non-string logDir', JSON.stringify({ workDir: HOME_WORK_DIR, logDir: 42 })],
  ])('treats a record that is %s as a first start and overwrites it', (_label, content) => {
    const { fs: fakeFs, files } = createFakeFs({ files: { [RECORD_PATH]: content } });

    const result = resolveInstallDirs({ dataDir: DATA_DIR, homeDir: HOME_DIR, fs: fakeFs });

    expect(result).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR, source: 'installed' });
    expect(readRecord(files)).toEqual({ workDir: DEFAULT_WORK_DIR, logDir: DEFAULT_LOG_DIR });
  });
});

describe('resolveInstallDirs: explicit dirs', () => {
  const workDir = path.resolve('/srv/aionui/work');
  const logDir = path.resolve('/srv/aionui/log');

  it('puts the logs under an explicit work dir and records nothing', () => {
    const { fs: fakeFs, files, mkdirCalls, writeCalls } = createFakeFs({ dirs: [DATA_DIR] });

    const result = resolveInstallDirs({
      dataDir: DATA_DIR,
      homeDir: HOME_DIR,
      explicitWorkDir: workDir,
      fs: fakeFs,
    });

    expect(result).toEqual({ workDir, logDir: path.join(workDir, 'logs'), source: 'explicit' });
    expect(files.has(path.normalize(RECORD_PATH))).toBe(false);
    expect(writeCalls).toEqual([]);
    expect(mkdirCalls.some((dir) => isSameOrBelow(dir, DATA_ROOT))).toBe(false);
  });

  it('ignores an existing record when the work dir is explicit', () => {
    const { fs: fakeFs, files } = createFakeFs({ files: recordOf(HOME_WORK_DIR, HOME_LOG_DIR) });

    const result = resolveInstallDirs({
      dataDir: DATA_DIR,
      homeDir: HOME_DIR,
      explicitWorkDir: workDir,
      fs: fakeFs,
    });

    expect(result).toEqual({ workDir, logDir: path.join(workDir, 'logs'), source: 'explicit' });
    expect(readRecord(files)).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR });
  });

  it('returns both explicit dirs as given and neither reads nor writes the record', () => {
    const { fs: fakeFs, files, readCalls, writeCalls } = createFakeFs({ files: recordOf(HOME_WORK_DIR, HOME_LOG_DIR) });

    const result = resolveInstallDirs({
      dataDir: DATA_DIR,
      homeDir: HOME_DIR,
      explicitWorkDir: workDir,
      explicitLogDir: logDir,
      fs: fakeFs,
    });

    expect(result).toEqual({ workDir, logDir, source: 'explicit' });
    expect(readCalls).not.toContain(path.normalize(RECORD_PATH));
    expect(writeCalls).toEqual([]);
    expect(readRecord(files)).toEqual({ workDir: HOME_WORK_DIR, logDir: HOME_LOG_DIR });
  });
});

describe('resolveInstallDirs: default file system', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads the record and creates the recorded dirs on disk when no fs is injected', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-install-dirs-'));
    tempRoots.push(root);
    const dataDir = path.join(root, 'data');
    const workDir = path.join(root, 'work');
    const logDir = path.join(root, 'work', 'logs');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, INSTALL_DIRS_FILE), JSON.stringify({ workDir, logDir }));

    const result = resolveInstallDirs({ dataDir, homeDir: root });

    expect(result).toEqual({ workDir, logDir, source: 'recorded' });
    expect(fs.statSync(workDir).isDirectory()).toBe(true);
    expect(fs.statSync(logDir).isDirectory()).toBe(true);
  });
});
