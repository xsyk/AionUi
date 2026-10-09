/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type BackendStartupResult = { ok: true; port: number } | { ok: false };

type StartBackendOrExitOptions = {
  startBackend: () => Promise<number>;
  onStarted: (port: number) => void;
  captureFailure: (error: unknown) => Promise<void> | void;
  exitApp: (code: number) => void;
  exitOnFailure?: boolean;
  logError?: (message: string, error: unknown) => void;
};

/**
 * Tell aioncore where the bundled image generation MCP script is.
 *
 * The image model is a server-wide setting and aioncore adds the MCP server to every session itself once it is
 * switched on; the script path comes from AIONUI_IMAGE_GEN_MCP_SCRIPT, and only a script that exists counts as
 * installed. The web host spawns aioncore with a copy of process.env taken at that moment, so this has to run
 * before the backend is started. A path the operator already set wins.
 */
export function exposeImageGenMcpScript(env: NodeJS.ProcessEnv, resolveScriptPath: () => string): void {
  if (env.AIONUI_IMAGE_GEN_MCP_SCRIPT) return;
  env.AIONUI_IMAGE_GEN_MCP_SCRIPT = resolveScriptPath();
}

function isBackendStartupCancelledError(error: unknown): boolean {
  return error instanceof Error && error.name === 'BackendStartupCancelledError';
}

export async function startBackendOrExit(options: StartBackendOrExitOptions): Promise<BackendStartupResult> {
  try {
    const port = await options.startBackend();
    options.onStarted(port);
    return { ok: true, port };
  } catch (error) {
    if (isBackendStartupCancelledError(error)) {
      return { ok: false };
    }
    options.logError?.('[AionUi] Failed to start aioncore:', error);
    await options.captureFailure(error);
    if (options.exitOnFailure ?? true) {
      options.exitApp(1);
    }
    return { ok: false };
  }
}
