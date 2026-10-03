/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { feishuErrorKey, fetchFeishuLoginEnabled } from '@/renderer/pages/login/feishuLogin';

describe('feishuLogin helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps known error codes and falls back for unknown ones', () => {
    expect(feishuErrorKey(null)).toBeNull();
    expect(feishuErrorKey('')).toBeNull();
    for (const code of ['disabled', 'state', 'cancelled', 'tenant', 'account_disabled', 'upstream', 'server']) {
      expect(feishuErrorKey(code)).toBe(`login.feishu.errors.${code}`);
    }
    expect(feishuErrorKey('weird')).toBe('login.feishu.errors.unknown');
  });

  it('reads the public status endpoint', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { enabled: true } }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFeishuLoginEnabled()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/feishu/status',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('treats failures as disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    await expect(fetchFeishuLoginEnabled()).resolves.toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline')))
    );
    await expect(fetchFeishuLoginEnabled()).resolves.toBe(false);
  });
});
