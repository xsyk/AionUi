import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/sessionRefresh', () => ({ refreshSession: async () => false }));

const electronAPI = window.electronAPI;
afterEach(() => {
  window.electronAPI = electronAPI;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('verified authentication refresh', () => {
  it('bounds a stalled profile lookup, fails closed and permits a later successful refresh', async () => {
    vi.resetModules();
    delete window.electronAPI;
    let stall = false;
    const fetchMock = vi.fn(async () =>
      stall ? new Promise<never>(() => {}) : response(200, { success: true, user: { id: 'owner', username: 'owner' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    vi.useFakeTimers();
    stall = true;
    let verified: boolean | undefined;
    await act(async () => {
      const pending = result.current.refresh();
      await vi.advanceTimersByTimeAsync(15001);
      verified = await pending;
    });
    expect(verified).toBe(false);
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    stall = false;
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(result.current.status).toBe('authenticated');
  });
});
