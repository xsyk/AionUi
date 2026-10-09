/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One translation object for every render, so `t` keeps a stable identity like the real hook's.
const { authState, startFeishuLogin, translation } = vi.hoisted(() => ({
  authState: { status: 'unauthenticated', login: vi.fn() },
  startFeishuLogin: vi.fn(),
  translation: { t: (key: string) => key, i18n: { language: 'zh-CN' } },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@/renderer/components/settings/LanguageSwitcher', () => ({
  default: () => <div data-testid='language-switcher' />,
}));
vi.mock('@/renderer/components/layout/AppLoader', () => ({ default: () => <div data-testid='app-loader' /> }));
vi.mock('@/renderer/pages/login/feishuLogin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/pages/login/feishuLogin')>()),
  startFeishuLogin,
}));

import LoginPage from '@/renderer/pages/login';
import PasswordPanel from '@/renderer/pages/login/PasswordPanel';
import { readRememberedCredentials, rememberCredentials } from '@/renderer/pages/login/rememberedCredentials';

type LoginResult = { success: boolean; code?: string };

function stubFeishuStatus(response: { enabled: boolean } | 'error') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response === 'error') throw new Error('offline');
      return {
        ok: true,
        json: async () => ({
          data: { enabled: response.enabled, public_base_url: response.enabled ? 'https://a.example.com' : null },
        }),
      };
    })
  );
}

/** A sign-in that stays in flight until the test answers it. */
function deferLogin(): (result: LoginResult) => void {
  let answer: ((result: LoginResult) => void) | undefined;
  authState.login.mockReturnValue(
    new Promise<LoginResult>((resolve) => {
      answer = resolve;
    })
  );
  return (result) => answer?.(result);
}

function fillCredentials(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('login.username'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText('login.password'), { target: { value: password } });
}

const LocationProbe: React.FC = () => <div data-testid='location-search'>{useLocation().search}</div>;

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path='/login'
          element={
            <>
              <LoginPage />
              <LocationProbe />
            </>
          }
        />
        <Route path='/guid' element={<div>guid page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    authState.status = 'unauthenticated';
    authState.login.mockReset();
    startFeishuLogin.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on the Feishu view when Feishu login is enabled', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
    expect(screen.getByText('login.brand')).toBeTruthy();
    expect(screen.getByText('login.subtitle')).toBeTruthy();
    expect(screen.getByText('login.feishu.caption')).toBeTruthy();
    expect(screen.queryByPlaceholderText('login.username')).toBeNull();
  });

  it('still opens on the Feishu view when password credentials are remembered', async () => {
    stubFeishuStatus({ enabled: true });
    rememberCredentials({ username: 'admin', password: 'secret' });
    renderLogin();
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
    expect(screen.queryByPlaceholderText('login.username')).toBeNull();
  });

  it('switches to the password form and back to Feishu', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('use-password-login'));
    expect(screen.getByText('login.passwordTitle')).toBeTruthy();
    expect(screen.getByPlaceholderText('login.username')).toBeTruthy();
    fireEvent.click(screen.getByTestId('back-to-feishu'));
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
  });

  it('focuses the Feishu button on the way back from the password form, not on the first visit', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    const firstVisit = await screen.findByTestId('feishu-login-button');
    expect(document.activeElement).not.toBe(firstVisit);
    fireEvent.click(screen.getByTestId('use-password-login'));
    fireEvent.click(screen.getByTestId('back-to-feishu'));
    const afterReturn = await screen.findByTestId('feishu-login-button');
    expect(document.activeElement).toBe(afterReturn);
  });

  it('shows only the password form when Feishu login is disabled', async () => {
    stubFeishuStatus({ enabled: false });
    renderLogin();
    expect(await screen.findByText('login.passwordTitle')).toBeTruthy();
    expect(screen.queryByTestId('back-to-feishu')).toBeNull();
    expect(screen.queryByTestId('feishu-login-button')).toBeNull();
  });

  it('falls back to the password form when the Feishu status check fails', async () => {
    stubFeishuStatus('error');
    renderLogin();
    expect(await screen.findByText('login.passwordTitle')).toBeTruthy();
    expect(screen.queryByTestId('back-to-feishu')).toBeNull();
  });

  it('shows the redirecting view, then leaves for Feishu', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('feishu-login-button'));
    expect(screen.getByText('login.feishu.redirectingTitle')).toBeTruthy();
    expect(screen.getByText('login.feishu.redirectingHint')).toBeTruthy();
    expect(screen.getByText('login.feishu.privacyNote')).toBeTruthy();
    await waitFor(() =>
      expect(startFeishuLogin).toHaveBeenCalledWith({ enabled: true, publicBaseUrl: 'https://a.example.com' })
    );
    expect(startFeishuLogin).toHaveBeenCalledTimes(1);
  });

  it('returns to the Feishu view when Back restores the page from the back/forward cache', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('feishu-login-button'));
    expect(screen.getByTestId('feishu-redirecting')).toBeTruthy();
    expect(startFeishuLogin).toHaveBeenCalledTimes(1);
    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(pageshow);
    });
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
    expect(startFeishuLogin).toHaveBeenCalledTimes(1);
  });

  it('gives the Feishu view back when the browser never leaves for Feishu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFeishuStatus({ enabled: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('feishu-login-button'));
    act(() => {
      vi.advanceTimersByTime(13_000);
    });
    expect(screen.getByTestId('feishu-redirecting')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByTestId('feishu-login-button')).toBeTruthy();
    expect(screen.queryByTestId('feishu-redirecting')).toBeNull();
    expect(startFeishuLogin).toHaveBeenCalledTimes(1);
  });

  it('keeps a Feishu callback error on screen until the user moves on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFeishuStatus({ enabled: true });
    renderLogin('/login?feishu_error=pending');
    expect(await screen.findByText('login.feishu.errors.pending')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toBe(''));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('login.feishu.errors.pending')).toBeTruthy();
    fireEvent.click(screen.getByTestId('use-password-login'));
    expect(screen.queryByText('login.feishu.errors.pending')).toBeNull();
  });

  it('shows a Feishu callback error on the password form when Feishu sign-in is off', async () => {
    stubFeishuStatus({ enabled: false });
    renderLogin('/login?feishu_error=disabled');
    expect(await screen.findByText('login.feishu.errors.disabled')).toBeTruthy();
    expect(screen.getByText('login.passwordTitle')).toBeTruthy();
  });

  it('signs in with the remember flag and stores the credentials', async () => {
    stubFeishuStatus({ enabled: false });
    authState.login.mockResolvedValue({ success: true });
    renderLogin();
    await screen.findByPlaceholderText('login.username');
    fillCredentials(' admin ', 'secret');
    fireEvent.click(screen.getByText('login.rememberMe'));
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() =>
      expect(authState.login).toHaveBeenCalledWith({ username: 'admin', password: 'secret', remember: true })
    );
    expect(await screen.findByText('login.success')).toBeTruthy();
    expect(localStorage.getItem('rememberMe')).toBe('true');
    expect(readRememberedCredentials()).toEqual({ username: 'admin', password: 'secret' });
  });

  it('forgets the saved credentials when signing in with "Remember me" unchecked', async () => {
    stubFeishuStatus({ enabled: false });
    rememberCredentials({ username: 'admin', password: 'secret' });
    authState.login.mockResolvedValue({ success: true });
    renderLogin();
    expect(((await screen.findByPlaceholderText('login.username')) as HTMLInputElement).value).toBe('admin');
    fireEvent.click(screen.getByText('login.rememberMe'));
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() =>
      expect(authState.login).toHaveBeenCalledWith({ username: 'admin', password: 'secret', remember: false })
    );
    expect(await screen.findByText('login.success')).toBeTruthy();
    expect(localStorage.getItem('rememberMe')).toBeNull();
    expect(localStorage.getItem('rememberedUsername')).toBeNull();
    expect(localStorage.getItem('rememberedPassword')).toBeNull();
  });

  it('restores remembered credentials into the password form', async () => {
    stubFeishuStatus({ enabled: false });
    rememberCredentials({ username: 'admin', password: 'secret' });
    renderLogin();
    expect(((await screen.findByPlaceholderText('login.username')) as HTMLInputElement).value).toBe('admin');
    expect((screen.getByPlaceholderText('login.password') as HTMLInputElement).value).toBe('secret');
  });

  it('asks for both fields before calling login', async () => {
    stubFeishuStatus({ enabled: false });
    renderLogin();
    fireEvent.click(await screen.findByTestId('password-login-submit'));
    expect(await screen.findByText('login.errors.empty')).toBeTruthy();
    expect(authState.login).not.toHaveBeenCalled();
  });

  it('clears a username/password error after five seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFeishuStatus({ enabled: false });
    renderLogin();
    fireEvent.click(await screen.findByTestId('password-login-submit'));
    expect(screen.getByText('login.errors.empty')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText('login.errors.empty')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByText('login.errors.empty')).toBeNull();
  });

  it('shows the mapped error when the sign-in is rejected', async () => {
    stubFeishuStatus({ enabled: false });
    authState.login.mockResolvedValue({ success: false, code: 'invalidCredentials' });
    renderLogin();
    await screen.findByPlaceholderText('login.username');
    fillCredentials('admin', 'wrong');
    fireEvent.click(screen.getByTestId('password-login-submit'));
    expect(await screen.findByText('login.errors.invalidCredentials')).toBeTruthy();
  });

  it('keeps the user on the password form while a sign-in is in flight', async () => {
    stubFeishuStatus({ enabled: true });
    deferLogin();
    renderLogin();
    fireEvent.click(await screen.findByTestId('use-password-login'));
    const back = screen.getByTestId('back-to-feishu') as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    fillCredentials('admin', 'secret');
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() => expect(back.disabled).toBe(true));
    fireEvent.click(back);
    expect(screen.getByText('login.passwordTitle')).toBeTruthy();
    expect(screen.queryByTestId('feishu-login-button')).toBeNull();
  });

  it('toggles the password visibility', async () => {
    stubFeishuStatus({ enabled: false });
    renderLogin();
    const input = (await screen.findByPlaceholderText('login.password')) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByLabelText('login.showPassword'));
    expect(input.type).toBe('text');
    expect(screen.getByLabelText('login.hidePassword')).toBeTruthy();
  });
});

describe('PasswordPanel', () => {
  beforeEach(() => {
    authState.login.mockReset();
    localStorage.clear();
  });

  function renderPanel(onNotice: (...args: unknown[]) => void) {
    return render(
      <MemoryRouter>
        <PasswordPanel notice={null} onNotice={onNotice} />
      </MemoryRouter>
    );
  }

  it('drops a sign-in answer that arrives after the form is gone', async () => {
    const answer = deferLogin();
    const onNotice = vi.fn();
    const { unmount } = renderPanel(onNotice);
    fillCredentials('admin', 'wrong');
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() => expect(authState.login).toHaveBeenCalledTimes(1));
    unmount();
    onNotice.mockClear();
    await act(async () => {
      answer({ success: false, code: 'invalidCredentials' });
    });
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('still saves "Remember me" credentials when the sign-in succeeds after the form is gone', async () => {
    const answer = deferLogin();
    const onNotice = vi.fn();
    const { unmount } = renderPanel(onNotice);
    fillCredentials('admin', 'secret');
    fireEvent.click(screen.getByText('login.rememberMe'));
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() => expect(authState.login).toHaveBeenCalledTimes(1));
    unmount();
    onNotice.mockClear();
    await act(async () => {
      answer({ success: true });
    });
    expect(readRememberedCredentials()).toEqual({ username: 'admin', password: 'secret' });
    expect(onNotice).not.toHaveBeenCalled();
  });
});
