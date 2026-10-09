/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  feishuErrorKey,
  feishuStartUrl,
  fetchFeishuLoginStatus,
  startFeishuLogin,
} from '@/renderer/pages/login/feishuLogin';

describe('feishuLogin helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps known error codes and falls back for unknown ones', () => {
    expect(feishuErrorKey(null)).toBeNull();
    expect(feishuErrorKey('')).toBeNull();
    for (const code of [
      'disabled',
      'state',
      'cancelled',
      'tenant',
      'account_disabled',
      'pending',
      'upstream',
      'server',
    ]) {
      expect(feishuErrorKey(code)).toBe(`login.feishu.errors.${code}`);
    }
    expect(feishuErrorKey('weird')).toBe('login.feishu.errors.unknown');
  });

  it('reads enabled state and site URL from the public status endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { enabled: true, public_base_url: 'https://a.example.com' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFeishuLoginStatus()).resolves.toEqual({ enabled: true, publicBaseUrl: 'https://a.example.com' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/feishu/status',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('treats disabled and failures as disabled', async () => {
    const disabled = { enabled: false, publicBaseUrl: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { enabled: false, public_base_url: null } }) }))
    );
    await expect(fetchFeishuLoginStatus()).resolves.toEqual(disabled);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    await expect(fetchFeishuLoginStatus()).resolves.toEqual(disabled);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline')))
    );
    await expect(fetchFeishuLoginStatus()).resolves.toEqual(disabled);
  });

  it('gives up on a status check that never answers', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            })
        )
      );
      const pending = fetchFeishuLoginStatus(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toEqual({ enabled: false, publicBaseUrl: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts on the site URL when the page is served from another origin', () => {
    expect(feishuStartUrl(null, 'https://a.example.com')).toBe('/api/auth/feishu/start');
    expect(feishuStartUrl('https://a.example.com', 'https://a.example.com')).toBe('/api/auth/feishu/start');
    expect(feishuStartUrl('https://a.example.com', 'http://192.168.0.210:25808')).toBe(
      'https://a.example.com/api/auth/feishu/start'
    );
    expect(feishuStartUrl('https://a.example.com/', 'http://10.0.0.1')).toBe(
      'https://a.example.com/api/auth/feishu/start'
    );
    expect(feishuStartUrl('not a url', 'https://a.example.com')).toBe('/api/auth/feishu/start');
  });

  it('leaves for the Feishu start URL of this site or of the configured site', () => {
    const assign = vi.fn();
    startFeishuLogin({ enabled: true, publicBaseUrl: 'https://a.example.com' }, assign, 'https://a.example.com');
    expect(assign).toHaveBeenLastCalledWith('/api/auth/feishu/start');
    startFeishuLogin({ enabled: true, publicBaseUrl: 'https://a.example.com/' }, assign, 'http://192.168.0.210:25808');
    expect(assign).toHaveBeenLastCalledWith('https://a.example.com/api/auth/feishu/start');
    expect(assign).toHaveBeenCalledTimes(2);
  });
});
