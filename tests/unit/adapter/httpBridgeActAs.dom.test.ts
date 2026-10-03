/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACT_AS_HEADER, getActAsUser, httpRequest, setActAsUser, shouldAttachActAs } from '@/common/adapter/httpBridge';

type WindowWithPort = { __backendPort?: number };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers;
}

describe('shouldAttachActAs', () => {
  it('attaches to conversation-scoped and other user data paths', () => {
    expect(shouldAttachActAs('/api/conversations/abc')).toBe(true);
    expect(shouldAttachActAs('/api/conversations/abc/messages?limit=20')).toBe(true);
    expect(shouldAttachActAs('/api/fs/read')).toBe(true);
    expect(shouldAttachActAs('/api/agents/management')).toBe(true);
  });

  it('never attaches to sider, order, admin and auth paths', () => {
    for (const path of [
      '/api/sidebar',
      '/api/sidebar/items?scope=x',
      '/api/order/sider/move',
      '/api/admin/users',
      '/api/admin/conversations?limit=10',
      '/api/auth/user',
      '/api/auth/refresh',
      '/login',
      '/logout',
    ]) {
      expect(shouldAttachActAs(path), path).toBe(false);
    }
  });
});

describe('httpRequest act-as header', () => {
  beforeEach(() => {
    delete (window as WindowWithPort).__backendPort;
    vi.restoreAllMocks();
    setActAsUser(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActAsUser(null);
  });

  it('sends no act-as header when not acting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await httpRequest('GET', '/api/conversations/abc');
    expect(sentHeaders(fetchMock)[ACT_AS_HEADER]).toBeUndefined();
  });

  it('sends the header on scoped paths while acting, and not on exempt paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    setActAsUser('user_alice');
    expect(getActAsUser()).toBe('user_alice');

    await httpRequest('GET', '/api/conversations/abc');
    await httpRequest('GET', '/api/sidebar');
    await httpRequest('GET', '/api/admin/users');

    expect(sentHeaders(fetchMock, 0)[ACT_AS_HEADER]).toBe('user_alice');
    expect(sentHeaders(fetchMock, 1)[ACT_AS_HEADER]).toBeUndefined();
    expect(sentHeaders(fetchMock, 2)[ACT_AS_HEADER]).toBeUndefined();
  });

  it('stops sending the header after clearing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    setActAsUser('user_alice');
    setActAsUser(null);
    await httpRequest('GET', '/api/conversations/abc');
    expect(sentHeaders(fetchMock)[ACT_AS_HEADER]).toBeUndefined();
    expect(getActAsUser()).toBeNull();
  });
});
