/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Where the web launcher keeps the agents' work directory and the logs.
 *
 * The choice is made once, "at install time" (`aionui-web init-dirs`, or the
 * first start when that never ran), and remembered in `<dataDir>/install-dirs.json`
 * so that later starts, possibly under another account or with another HOME,
 * keep using the same place instead of silently moving:
 *
 *   1. try /data/.AionEasiful (logs in /data/.AionEasiful/logs);
 *   2. if that is refused for lack of permission (EACCES / EPERM / EROFS), use
 *      <home>/.AionEasiful (logs in <home>/.AionEasiful/logs) instead;
 *   3. write the outcome to install-dirs.json.
 *
 * Explicit values (`--work-dir` / `AIONUI_WORK_DIR`, `--log-dir` /
 * `AIONUI_LOG_DIR`) take priority over all of this and are never recorded.
 */

import nodeFs from 'node:fs';
import path from 'node:path';

export const DEFAULT_WORK_DIR = '/data/.AionEasiful';
export const HOME_FALLBACK_DIR_NAME = '.AionEasiful';
export const INSTALL_DIRS_FILE = 'install-dirs.json';

const LOG_DIR_NAME = 'logs';

/** mkdir failures that mean "this account may not create a directory there". */
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

export type InstallDirs = {
  workDir: string;
  logDir: string;
  source: 'explicit' | 'recorded' | 'installed' | 'installed-home-fallback';
};

/** The slice of `node:fs` used here, so tests can run against an in-memory fake. */
export type InstallDirsFs = {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string, opts: { recursive: true }): unknown;
};

export type ResolveInstallDirsInput = {
  /** Launcher data dir; `install-dirs.json` lives here. */
  dataDir: string;
  /** Used for the `~/.AionEasiful` fallback. */
  homeDir: string;
  /** From `--work-dir` / `AIONUI_WORK_DIR`. */
  explicitWorkDir?: string;
  /** From `--log-dir` / `AIONUI_LOG_DIR`. */
  explicitLogDir?: string;
  fs?: InstallDirsFs;
};

type Decision = {
  workDir: string;
  logDir: string;
  source: 'installed' | 'installed-home-fallback';
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

function isAbsolutePath(value: unknown): value is string {
  // An empty string is not absolute, so this also rejects blank fields.
  return typeof value === 'string' && path.isAbsolute(value);
}

/** The recorded choice, or `undefined` when there is none or it is unusable. */
function readRecord(fs: InstallDirsFs, recordPath: string): { workDir: string; logDir: string } | undefined {
  try {
    if (!fs.existsSync(recordPath)) return undefined;
    const parsed: unknown = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { workDir, logDir } = parsed as { workDir?: unknown; logDir?: unknown };
    if (!isAbsolutePath(workDir) || !isAbsolutePath(logDir)) return undefined;
    return { workDir, logDir };
  } catch {
    // Unreadable or not JSON: treat it like no record at all and decide again.
    return undefined;
  }
}

/**
 * A recorded directory that cannot be created is a problem to fix, not a cue
 * to pick another place: the data already written there would be orphaned.
 */
function ensureRecordedDir(fs: InstallDirsFs, dir: string, recordPath: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `Cannot create ${dir} (recorded at installation in ${recordPath}): ${reason}. ` +
        `Fix its permissions, delete ${recordPath} to choose the directories again, or pass --work-dir / --log-dir.`,
      { cause: error }
    );
    const code = errorCode(error);
    throw code ? Object.assign(wrapped, { code }) : wrapped;
  }
}

function decideDirs(fs: InstallDirsFs, homeDir: string): Decision {
  const logDir = path.join(DEFAULT_WORK_DIR, LOG_DIR_NAME);
  try {
    // A single recursive mkdir also creates the work dir above it.
    fs.mkdirSync(logDir, { recursive: true });
    return { workDir: DEFAULT_WORK_DIR, logDir, source: 'installed' };
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined || !PERMISSION_ERROR_CODES.has(code)) throw error;
  }

  const homeWorkDir = path.join(homeDir, HOME_FALLBACK_DIR_NAME);
  const homeLogDir = path.join(homeWorkDir, LOG_DIR_NAME);
  fs.mkdirSync(homeWorkDir, { recursive: true });
  fs.mkdirSync(homeLogDir, { recursive: true });
  return { workDir: homeWorkDir, logDir: homeLogDir, source: 'installed-home-fallback' };
}

function writeRecord(fs: InstallDirsFs, dataDir: string, recordPath: string, decision: Decision): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const record = { workDir: decision.workDir, logDir: decision.logDir };
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

export function resolveInstallDirs(input: ResolveInstallDirsInput): InstallDirs {
  const { dataDir, homeDir, explicitWorkDir, explicitLogDir } = input;
  const fs = input.fs ?? nodeFs;

  // An explicit work dir settles both: logs go under it unless told otherwise.
  // Nothing is read from or written to the record.
  if (explicitWorkDir) {
    return {
      workDir: explicitWorkDir,
      logDir: explicitLogDir || path.join(explicitWorkDir, LOG_DIR_NAME),
      source: 'explicit',
    };
  }

  const recordPath = path.join(dataDir, INSTALL_DIRS_FILE);

  const recorded = readRecord(fs, recordPath);
  if (recorded) {
    ensureRecordedDir(fs, recorded.workDir, recordPath);
    // An explicit log dir replaces the recorded one, which is then left alone.
    if (!explicitLogDir) ensureRecordedDir(fs, recorded.logDir, recordPath);
    return { workDir: recorded.workDir, logDir: explicitLogDir || recorded.logDir, source: 'recorded' };
  }

  // First start. What gets remembered is the install-time decision, not a
  // one-off `--log-dir` override.
  const decision = decideDirs(fs, homeDir);
  writeRecord(fs, dataDir, recordPath, decision);
  return { workDir: decision.workDir, logDir: explicitLogDir || decision.logDir, source: decision.source };
}
