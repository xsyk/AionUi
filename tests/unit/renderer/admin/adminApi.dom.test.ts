/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACT_AS_HEADER, BackendHttpError, setActAsUser } from '@/common/adapter/httpBridge';
import { adminApi } from '@/renderer/pages/admin/adminApi';
import type { FeishuDirectorySyncView } from '@/renderer/pages/admin/adminApi';

const path = '/api/admin/feishu-directory/sync';
const task: FeishuDirectorySyncView = {
  id: 'sync-test',
  status: 'running',
  scanned: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
  partial: false,
  error_code: null,
  started_at: 1000,
  finished_at: null,
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('adminApi Feishu directory HTTP binding', () => {
  beforeEach(() => {
    delete window.__backendPort;
    document.cookie = 'aionui-csrf-token=synthetic-admin-csrf; Path=/';
    setActAsUser('test-delegated-user');
  });

  afterEach(() => {
    document.cookie = 'aionui-csrf-token=; Path=/; Max-Age=0';
    setActAsUser(null);
    vi.unstubAllGlobals();
  });

  it('starts with the current CSRF cookie header and an empty JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: task }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await adminApi.startFeishuDirectorySync()).toEqual(task);
    expect(fetchMock).toHaveBeenCalledWith(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'synthetic-admin-csrf' },
      body: '{}',
    });
    expect(fetchMock.mock.calls[0][1].headers[ACT_AS_HEADER]).toBeUndefined();
  });

  it('obtains a missing CSRF cookie through the existing same-origin bootstrap before import', async () => {
    document.cookie = 'aionui-csrf-token=; Path=/; Max-Age=0';
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/feishu/status') {
        document.cookie = 'aionui-csrf-token=synthetic-bootstrapped-csrf; Path=/';
        return jsonResponse({ success: true });
      }
      const headers = new Headers(init?.headers);
      return headers.get('x-csrf-token') === 'synthetic-bootstrapped-csrf'
        ? jsonResponse({ success: true, data: task })
        : jsonResponse({ success: false, code: 'CSRF_INVALID' }, 403);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await adminApi.startFeishuDirectorySync()).toEqual(task);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/feishu/status', path]);
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'same-origin', cache: 'no-store' });
  });

  it('does not send an import POST when the CSRF bootstrap is unavailable', async () => {
    document.cookie = 'aionui-csrf-token=; Path=/; Max-Age=0';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: false }, 503));
    vi.stubGlobal('fetch', fetchMock);
    await expect(adminApi.startFeishuDirectorySync()).rejects.toThrow('CSRF token unavailable');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/feishu/status']);
  });

  it('does not send an import POST if bootstrap returns without a CSRF cookie', async () => {
    document.cookie = 'aionui-csrf-token=; Path=/; Max-Age=0';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(adminApi.startFeishuDirectorySync()).rejects.toThrow('CSRF token unavailable');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/feishu/status']);
  });

  it('preserves a null recent task from the response wrapper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await adminApi.getFeishuDirectorySync()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(path, { method: 'GET', headers: {}, body: undefined });
  });

  it('reads a running task as the real caller while act-as is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: task }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await adminApi.getFeishuDirectorySync()).toEqual(task);
    expect(fetchMock.mock.calls[0][1].headers[ACT_AS_HEADER]).toBeUndefined();
  });

  it('preserves fixed permission errors for localized UI handling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            success: false,
            code: 'FEISHU_DIRECTORY_PERMISSION_DENIED',
            error: 'synthetic-response',
          },
          403
        )
      )
    );
    await expect(adminApi.startFeishuDirectorySync()).rejects.toMatchObject({
      name: BackendHttpError.name,
      status: 403,
      code: 'FEISHU_DIRECTORY_PERMISSION_DENIED',
    });
  });
});
