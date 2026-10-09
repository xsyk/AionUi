/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { exposeImageGenMcpScript, startBackendOrExit } from '@/process/startup/backendStartup';

describe('startBackendOrExit', () => {
  it('registers the backend port when startup succeeds', async () => {
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => 42123,
      onStarted,
      captureFailure,
      exitApp,
      logError: vi.fn(),
    });

    expect(result).toEqual({ ok: true, port: 42123 });
    expect(onStarted).toHaveBeenCalledWith(42123);
    expect(captureFailure).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('captures startup failure and exits without registering a backend port by default', async () => {
    const error = new Error('aioncore failed to start within timeout');
    const calls: string[] = [];
    const onStarted = vi.fn();
    const captureFailure = vi.fn(async () => {
      calls.push('capture-start');
      await Promise.resolve();
      calls.push('capture-end');
    });
    const exitApp = vi.fn(() => {
      calls.push('exit');
    });
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith('[AionUi] Failed to start aioncore:', error);
    expect(captureFailure).toHaveBeenCalledWith(error);
    expect(exitApp).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['capture-start', 'capture-end', 'exit']);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('captures startup failure without dialog or exit when exitOnFailure is disabled', async () => {
    const error = new Error('aioncore exited before health check passed');
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      exitOnFailure: false,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith('[AionUi] Failed to start aioncore:', error);
    expect(captureFailure).toHaveBeenCalledWith(error);
    expect(exitApp).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('does not capture or exit when backend startup is cancelled by shutdown', async () => {
    const error = new Error('aioncore startup cancelled');
    error.name = 'BackendStartupCancelledError';
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).not.toHaveBeenCalled();
    expect(captureFailure).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe('exposeImageGenMcpScript', () => {
  // aioncore reads this variable at spawn time and uses it to add the image generation MCP server to every
  // session once the administrator switches the shared image setting on. Without it the server has nothing to run.
  it('points aioncore at the bundled image generation script', () => {
    const env: NodeJS.ProcessEnv = {};
    const resolveScriptPath = vi.fn(() => '/app/out/main/builtin-mcp-image-gen.js');

    exposeImageGenMcpScript(env, resolveScriptPath);

    expect(env.AIONUI_IMAGE_GEN_MCP_SCRIPT).toBe('/app/out/main/builtin-mcp-image-gen.js');
  });

  it('keeps a script path the operator already set', () => {
    const env: NodeJS.ProcessEnv = { AIONUI_IMAGE_GEN_MCP_SCRIPT: '/opt/custom/image-gen.js' };
    const resolveScriptPath = vi.fn(() => '/app/out/main/builtin-mcp-image-gen.js');

    exposeImageGenMcpScript(env, resolveScriptPath);

    expect(env.AIONUI_IMAGE_GEN_MCP_SCRIPT).toBe('/opt/custom/image-gen.js');
    expect(resolveScriptPath).not.toHaveBeenCalled();
  });

  it('treats an empty value as not set', () => {
    const env: NodeJS.ProcessEnv = { AIONUI_IMAGE_GEN_MCP_SCRIPT: '' };

    exposeImageGenMcpScript(env, () => '/app/out/main/builtin-mcp-image-gen.js');

    expect(env.AIONUI_IMAGE_GEN_MCP_SCRIPT).toBe('/app/out/main/builtin-mcp-image-gen.js');
  });
});
