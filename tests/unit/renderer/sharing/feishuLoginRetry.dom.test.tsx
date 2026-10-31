import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en-US' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('@/common/adapter/sessionRefresh', () => ({ refreshSession: async () => false }));
vi.mock('@/renderer/components/settings/LanguageSwitcher', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/AppLoader', () => ({ default: () => <div>checking auth</div> }));

const electronAPI = window.electronAPI;
afterEach(() => {
  window.electronAPI = electronAPI;
  delete (window as Window & { tt?: unknown }).tt;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('Feishu exchange followed by authenticated profile verification', () => {
  it.each([401, 500, 'network'] as const)(
    'shows an explicit retry after user verification fails with %s',
    async (failure) => {
      vi.resetModules();
      delete window.electronAPI;
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla Feishu/7.0');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const requestAccess = vi.fn(({ success }: { success: (value: { code: string }) => void }) =>
        success({ code: 'fresh-code' })
      );
      (window as Window & { tt?: unknown }).tt = { requestAccess };
      let exchanged = false;
      let profileAllowed = false;
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/auth/feishu/status')
          return response(200, { data: { enabled: true, app_id: 'cli-app', public_base_url: window.location.origin } });
        if (url === '/api/auth/feishu/in-app') {
          exchanged = true;
          return response(200, { success: true, data: { user: { id: 'owner', username: 'owner' } } });
        }
        if (url === '/api/auth/user') {
          if (profileAllowed) return response(200, { success: true, user: { id: 'owner', username: 'owner' } });
          if (exchanged && failure === 'network') throw new Error('offline');
          return response(exchanged && typeof failure === 'number' ? failure : 401, { success: false });
        }
        throw new Error(`Unexpected private request ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const { AuthProvider } = await import('@/renderer/hooks/context/AuthContext');
      const { default: LoginPage } = await import('@/renderer/pages/login');
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <Routes>
              <Route path='/login' element={<LoginPage />} />
              <Route path='/guid' element={<div>signed in</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );
      await screen.findByText('login.feishu.errors.upstream');
      expect(screen.getByTestId('feishu-login-button')).toBeTruthy();
      expect(requestAccess).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('signed in')).toBeNull();
      profileAllowed = true;
      fireEvent.click(screen.getByTestId('feishu-login-button'));
      await waitFor(() => expect(screen.getByText('signed in')).toBeTruthy());
      expect(requestAccess).toHaveBeenCalledTimes(2);
    }
  );
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
  it('accepts an already injected legacy-only SDK without loading another script', async () => {
    vi.resetModules();
    const requestAuthCode = vi.fn(({ success }: { success: (value: { code: string }) => void }) =>
      success({ code: 'legacy-code' })
    );
    (window as Window & { tt?: unknown }).tt = { requestAuthCode };
    const { loadFeishuSdk, requestFeishuCode } = await import('@/renderer/pages/login/inAppLogin');
    const sdk = await loadFeishuSdk();
    await expect(requestFeishuCode(sdk, 'app')).resolves.toBe('legacy-code');
    expect(document.querySelector('script[src*="h5-js-sdk"]')).toBeNull();
  });
});
