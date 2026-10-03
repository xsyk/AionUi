/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type WithElectron = { electronAPI?: unknown };

/** Load AuthContext as the browser (WebUI) build sees it: no Electron bridge. */
async function loadBrowserAuthContext() {
  vi.resetModules();
  delete (window as WithElectron).electronAPI;
  return import('@/renderer/hooks/context/AuthContext');
}

describe('AuthContext login (WebUI)', () => {
  const electronAPI = (window as WithElectron).electronAPI;

  afterEach(() => {
    (window as WithElectron).electronAPI = electronAPI;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the full profile after login so is_super_admin is known without a reload', async () => {
    let signedIn = false;
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith('/login') && init?.method === 'POST') {
        signedIn = true;
        return json(200, { success: true, user: { id: 'system_default_user', username: 'admin' } });
      }
      if (url.endsWith('/api/auth/user')) {
        return signedIn
          ? json(200, { success: true, user: { id: 'system_default_user', username: 'admin', is_super_admin: true } })
          : json(401, { success: false });
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { AuthProvider, useAuth } = await loadBrowserAuthContext();
    const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));

    await act(async () => {
      const outcome = await result.current.login({ username: 'admin', password: 'x', remember: false });
      expect(outcome.success).toBe(true);
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.is_super_admin).toBe(true);
  });
});
