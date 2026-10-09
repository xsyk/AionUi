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
import { rememberCredentials } from '@/renderer/pages/login/rememberedCredentials';

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
  afterEach(() => vi.unstubAllGlobals());

  it('opens on the Feishu view when Feishu login is enabled', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
    expect(screen.getByText('login.brand')).toBeTruthy();
    expect(screen.getByText('login.subtitle')).toBeTruthy();
    expect(screen.getByText('login.feishu.caption')).toBeTruthy();
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
  });

  it('returns to the Feishu view when Back restores the page from the back/forward cache', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('feishu-login-button'));
    expect(screen.getByTestId('feishu-redirecting')).toBeTruthy();
    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(pageshow);
    });
    expect(await screen.findByTestId('feishu-login-button')).toBeTruthy();
  });

  it('keeps a Feishu callback error on screen until the user moves on', async () => {
    stubFeishuStatus({ enabled: true });
    renderLogin('/login?feishu_error=pending');
    expect(await screen.findByText('login.feishu.errors.pending')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toBe(''));
    fireEvent.click(screen.getByTestId('use-password-login'));
    expect(screen.queryByText('login.feishu.errors.pending')).toBeNull();
  });

  it('signs in with the remember flag and stores the credentials', async () => {
    stubFeishuStatus({ enabled: false });
    authState.login.mockResolvedValue({ success: true });
    renderLogin();
    fireEvent.change(await screen.findByPlaceholderText('login.username'), { target: { value: ' admin ' } });
    fireEvent.change(screen.getByPlaceholderText('login.password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('login.rememberMe'));
    fireEvent.click(screen.getByTestId('password-login-submit'));
    await waitFor(() =>
      expect(authState.login).toHaveBeenCalledWith({ username: 'admin', password: 'secret', remember: true })
    );
    expect(localStorage.getItem('rememberMe')).toBe('true');
    expect(await screen.findByText('login.success')).toBeTruthy();
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

  it('shows the mapped error when the sign-in is rejected', async () => {
    stubFeishuStatus({ enabled: false });
    authState.login.mockResolvedValue({ success: false, code: 'invalidCredentials' });
    renderLogin();
    fireEvent.change(await screen.findByPlaceholderText('login.username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('login.password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByTestId('password-login-submit'));
    expect(await screen.findByText('login.errors.invalidCredentials')).toBeTruthy();
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
