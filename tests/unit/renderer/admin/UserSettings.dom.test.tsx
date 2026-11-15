/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { AdminUser, FeishuDirectorySyncView, FeishuLoginConfig } from '@/renderer/pages/admin/adminApi';
import UserSettings from '@/renderer/pages/admin/UserSettings';

const P = 'settings.userManagement.feishuDirectory';
const mocks = vi.hoisted(() => ({
  user: { id: 'test-admin', username: 'test-admin', is_super_admin: true } as {
    id: string;
    username: string;
    is_super_admin: boolean;
  } | null,
  listUsers: vi.fn(),
  getFeishuLogin: vi.fn(),
  saveFeishuLogin: vi.fn(),
  getFeishuDirectorySync: vi.fn(),
  startFeishuDirectorySync: vi.fn(),
  t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}: ${options.count}`),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('react-router-dom', () => ({ Navigate: () => null }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/renderer/pages/admin/adminApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/admin/adminApi')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      listUsers: mocks.listUsers,
      getFeishuLogin: mocks.getFeishuLogin,
      saveFeishuLogin: mocks.saveFeishuLogin,
      getFeishuDirectorySync: mocks.getFeishuDirectorySync,
      startFeishuDirectorySync: mocks.startFeishuDirectorySync,
    },
  };
});

const config: FeishuLoginConfig = {
  enabled: true,
  app_id: 'cli_test',
  app_secret_set: true,
  tenant_key: null,
  public_base_url: 'https://example.com',
  api_base: null,
  accounts_base: null,
  callback_url: 'https://example.com/api/auth/feishu/callback',
  signup_policy: 'approval',
};

const listedUser: AdminUser = {
  id: 'synthetic-directory-user',
  username: 'feishu-synthetic-user',
  status: 'active',
  source: 'feishu',
  created_at: 2000,
  last_login: null,
  is_super_admin: false,
  email: 'synthetic-user@example.invalid',
  avatar_url: 'https://example.invalid/synthetic-avatar.png',
};

const task = (overrides: Partial<FeishuDirectorySyncView> = {}): FeishuDirectorySyncView => ({
  id: 'sync-test',
  status: 'running',
  scanned: 21,
  created: 8,
  updated: 4,
  unchanged: 3,
  skipped: 5,
  failed: 1,
  partial: false,
  error_code: null,
  started_at: 1000,
  finished_at: null,
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderPage() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<UserSettings />);
  });
  return view;
}

function requestError(code: string, status = 400) {
  return new BackendHttpError({
    method: 'POST',
    path: '/api/admin/feishu-directory/sync',
    status,
    body: { success: false, code, error: 'synthetic-private-response' },
  });
}

describe('UserSettings Feishu directory sync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user = { id: 'test-admin', username: 'test-admin', is_super_admin: true };
    mocks.listUsers.mockResolvedValue([]);
    mocks.getFeishuLogin.mockResolvedValue(config);
    mocks.saveFeishuLogin.mockResolvedValue(config);
    mocks.getFeishuDirectorySync.mockResolvedValue(null);
    mocks.startFeishuDirectorySync.mockResolvedValue(task());
    vi.spyOn(Message, 'success').mockImplementation(() => () => {});
    vi.spyOn(Message, 'error').mockImplementation(() => () => {});
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the trimmed display name before the original username and email', async () => {
    mocks.listUsers.mockResolvedValue([{ ...listedUser, display_name: '  Synthetic Directory User  ' }]);
    await renderPage();
    expect(screen.getByText('Synthetic Directory User').closest('td')).toHaveTextContent(
      /^Synthetic Directory Userfeishu-synthetic-usersynthetic-user@example\.invalid$/
    );
  });

  it('uses the display name for the avatar alternative text', async () => {
    mocks.listUsers.mockResolvedValue([{ ...listedUser, display_name: '  Synthetic Directory User  ' }]);
    await renderPage();
    expect(screen.getByRole('img', { name: 'Synthetic Directory User' })).toBeInTheDocument();
  });

  it.each([{}, { display_name: null }, { display_name: '' }, { display_name: ' \t\n ' }])(
    'falls back to the username for an absent or blank display name: %j',
    async (fields) => {
      mocks.listUsers.mockResolvedValue([{ ...listedUser, ...fields }]);
      await renderPage();
      expect(screen.getAllByText(listedUser.username)).toHaveLength(1);
      expect(screen.getByText(listedUser.username).closest('td')).toHaveTextContent(
        /^feishu-synthetic-usersynthetic-user@example\.invalid$/
      );
      expect(screen.getByRole('img', { name: listedUser.username })).toBeInTheDocument();
    }
  );

  it('avoids repeating the username when it matches the trimmed display name', async () => {
    mocks.listUsers.mockResolvedValue([{ ...listedUser, display_name: `  ${listedUser.username}  ` }]);
    await renderPage();
    expect(screen.getAllByText(listedUser.username)).toHaveLength(1);
    expect(screen.getByText(listedUser.username).closest('td')).toHaveTextContent(
      /^feishu-synthetic-usersynthetic-user@example\.invalid$/
    );
  });

  it('keeps permissions, status and actions for a user with a display name', async () => {
    mocks.listUsers.mockResolvedValue([
      { ...listedUser, display_name: 'Synthetic Directory User', is_super_admin: true },
    ]);
    await renderPage();
    const row = within(screen.getByRole('row', { name: /Synthetic Directory User/ }));
    expect(row.getByText('settings.userManagement.superAdmin')).toBeInTheDocument();
    expect(row.getByText('settings.userManagement.active')).toBeInTheDocument();
    expect(row.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'settings.userManagement.resetPassword',
    ]);
  });

  it.each([false, null])('does not expose admin sync when super-admin is %s', async (isSuperAdmin) => {
    mocks.user = isSuperAdmin === null ? null : { ...mocks.user!, is_super_admin: isSuperAdmin };
    await renderPage();
    expect(screen.queryByRole('button', { name: `${P}.start` })).not.toBeInTheDocument();
    expect(mocks.getFeishuDirectorySync).not.toHaveBeenCalled();
    expect(mocks.getFeishuLogin).not.toHaveBeenCalled();
  });

  it('allows a configured app without a tenant lock and handles no recent task', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: `${P}.start` })).toBeEnabled();
    expect(screen.queryByTestId('feishu-directory-result')).not.toBeInTheDocument();
    expect(mocks.getFeishuLogin).toHaveBeenCalledTimes(1);
  });

  it.each([{ enabled: false }, { app_id: '' }, { app_secret_set: false }])(
    'requires saved enabled app configuration: %j',
    async (missing) => {
      mocks.getFeishuLogin.mockResolvedValue({ ...config, ...missing });
      await renderPage();
      expect(screen.getByRole('button', { name: `${P}.start` })).toBeDisabled();
    }
  );

  it('updates sync availability after saving Feishu settings', async () => {
    mocks.getFeishuLogin.mockResolvedValue({ ...config, enabled: false });
    await renderPage();
    await act(async () => fireEvent.click(screen.getByTestId('feishu-save')));
    expect(screen.getByRole('button', { name: `${P}.start` })).toBeEnabled();
    expect(mocks.getFeishuLogin).toHaveBeenCalledTimes(1);
  });

  it('waits for the recent-task query before allowing a start', async () => {
    const pending = deferred<FeishuDirectorySyncView | null>();
    mocks.getFeishuDirectorySync.mockReturnValue(pending.promise);
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: `${P}.start` }));
    expect(mocks.startFeishuDirectorySync).not.toHaveBeenCalled();
    await act(async () => pending.resolve(null));
    expect(screen.getByRole('button', { name: `${P}.start` })).toBeEnabled();
  });

  it('shows startup loading and prevents duplicate starts while running', async () => {
    const pending = deferred<FeishuDirectorySyncView>();
    mocks.startFeishuDirectorySync.mockReturnValue(pending.promise);
    await renderPage();
    const startButton = screen.getByRole('button', { name: `${P}.start` });
    await act(async () => {
      fireEvent.click(startButton);
      fireEvent.click(startButton);
    });
    expect(mocks.startFeishuDirectorySync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: `${P}.starting` })).toBeDisabled();
    await act(async () => pending.resolve(task()));
    expect(screen.getByRole('button', { name: `${P}.running` })).toBeDisabled();
  });

  it('restores a running task and displays every result counter', async () => {
    mocks.getFeishuDirectorySync.mockResolvedValue(task());
    await renderPage();
    for (const [key, value] of Object.entries({
      scanned: 21,
      created: 8,
      updated: 4,
      unchanged: 3,
      skipped: 5,
      failed: 1,
    })) {
      expect(screen.getByText(`${P}.counts.${key}: ${value}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: `${P}.running` })).toBeDisabled();
    expect(mocks.startFeishuDirectorySync).not.toHaveBeenCalled();
  });

  it('polls at two seconds, refreshes the user list on completion, then stops polling', async () => {
    vi.useFakeTimers();
    mocks.getFeishuDirectorySync
      .mockResolvedValueOnce(task({ failed: 0 }))
      .mockResolvedValue(task({ status: 'completed', failed: 0, finished_at: 3000 }));
    await renderPage();
    await act(async () => vi.advanceTimersByTimeAsync(1999));
    expect(mocks.getFeishuDirectorySync).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText(`${P}.completed`)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect([mocks.getFeishuDirectorySync.mock.calls.length, mocks.listUsers.mock.calls.length]).toEqual([2, 2]);
  });

  it('shows imported users with the existing Feishu source after a partial completion', async () => {
    vi.useFakeTimers();
    const imported: AdminUser = {
      id: 'test-imported',
      username: 'test-imported',
      status: 'disabled',
      source: 'feishu',
      created_at: 2000,
      last_login: null,
      is_super_admin: false,
      email: null,
      avatar_url: null,
    };
    mocks.listUsers.mockResolvedValueOnce([]).mockResolvedValue([imported]);
    mocks.getFeishuDirectorySync
      .mockResolvedValueOnce(task())
      .mockResolvedValue(task({ status: 'completed', partial: true, finished_at: 3000 }));
    await renderPage();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(`${P}.partial`)).toBeInTheDocument();
    expect(screen.getByText('settings.userManagement.sourceFeishu')).toBeInTheDocument();
    expect(screen.getByText('settings.userManagement.pending')).toBeInTheDocument();
  });

  it.each([
    { status: 'completed' as const, partial: true, failed: 0 },
    { status: 'completed' as const, partial: false, failed: 2 },
    { status: 'completed' as const, partial: false, failed: 0, error_code: 'FEISHU_DIRECTORY_TIMEOUT' },
    { status: 'failed' as const, partial: false, failed: 0 },
  ])('never claims full success for an incomplete task: %j', async (result) => {
    mocks.getFeishuDirectorySync.mockResolvedValue(task({ ...result, finished_at: 3000 }));
    await renderPage();
    expect(screen.queryByText(`${P}.completed`)).not.toBeInTheDocument();
    expect(screen.getByText(result.status === 'failed' ? `${P}.failed` : `${P}.partial`)).toBeInTheDocument();
    expect(mocks.listUsers).toHaveBeenCalledTimes(2);
  });

  it('refreshes enabled Feishu users after an immediate successful start response', async () => {
    const imported: AdminUser = {
      id: 'test-open',
      username: 'test-open',
      status: 'active',
      source: 'feishu',
      created_at: 2000,
      last_login: null,
      is_super_admin: false,
      email: null,
      avatar_url: null,
    };
    mocks.getFeishuLogin.mockResolvedValue({ ...config, signup_policy: 'open' });
    mocks.listUsers.mockResolvedValueOnce([]).mockResolvedValue([imported]);
    mocks.startFeishuDirectorySync.mockResolvedValue(task({ status: 'completed', failed: 0, finished_at: 3000 }));
    await renderPage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `${P}.start` })));
    expect(screen.getByText(`${P}.completed`)).toBeInTheDocument();
    expect(screen.getByText('settings.userManagement.active')).toBeInTheDocument();
    expect(screen.queryByText('settings.userManagement.pending')).not.toBeInTheDocument();
  });

  it.each([
    ['FEISHU_DIRECTORY_PERMISSION_DENIED', 'permissionDenied'],
    ['FEISHU_DIRECTORY_CONFIG_UNAVAILABLE', 'configUnavailable'],
    ['FEISHU_DIRECTORY_CONFIG_CHANGED', 'configChanged'],
    ['FEISHU_DIRECTORY_TIMEOUT', 'timeout'],
    ['FEISHU_DIRECTORY_SYNC_FAILED', 'syncFailed'],
    ['UNRECOGNIZED', 'syncFailed'],
    ['', 'syncFailed'],
  ])('localizes start error %s without exposing the response', async (code, key) => {
    mocks.startFeishuDirectorySync.mockRejectedValue(requestError(code));
    await renderPage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `${P}.start` })));
    expect(screen.getByText(`${P}.errors.${key}`)).toBeInTheDocument();
    expect(screen.queryByText(/synthetic-private-response/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${P}.start` })).toBeEnabled();
  });

  it('reports a recent-task query failure with a localized fallback', async () => {
    mocks.getFeishuDirectorySync.mockRejectedValue(new Error('synthetic-private-response'));
    await renderPage();
    expect(screen.getByText(`${P}.errors.syncFailed`)).toBeInTheDocument();
    expect(screen.queryByText(/synthetic-private-response/)).not.toBeInTheDocument();
  });

  it('keeps polling after a transient read failure and clears the error after recovery', async () => {
    vi.useFakeTimers();
    mocks.getFeishuDirectorySync
      .mockResolvedValueOnce(task())
      .mockRejectedValueOnce(requestError('FEISHU_DIRECTORY_TIMEOUT'))
      .mockResolvedValue(task({ status: 'completed', failed: 0, finished_at: 3000 }));
    await renderPage();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(`${P}.errors.timeout`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${P}.running` })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByText(`${P}.errors.timeout`)).not.toBeInTheDocument();
  });

  it('stops polling when this instance no longer has a recent task', async () => {
    vi.useFakeTimers();
    mocks.getFeishuDirectorySync.mockResolvedValueOnce(task()).mockResolvedValue(null);
    await renderPage();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByTestId('feishu-directory-result')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${P}.start` })).toBeEnabled();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.getFeishuDirectorySync).toHaveBeenCalledTimes(2);
  });

  it('clears the scheduled poll when leaving before the next read', async () => {
    vi.useFakeTimers();
    mocks.getFeishuDirectorySync.mockResolvedValue(task());
    const view = await renderPage();
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.getFeishuDirectorySync).toHaveBeenCalledTimes(1);
  });

  it('cancels polling on unmount, including an in-flight read', async () => {
    vi.useFakeTimers();
    const pending = deferred<FeishuDirectorySyncView | null>();
    mocks.getFeishuDirectorySync.mockResolvedValueOnce(task()).mockReturnValue(pending.promise);
    const view = await renderPage();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    view.unmount();
    await act(async () => pending.resolve(task()));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.getFeishuDirectorySync).toHaveBeenCalledTimes(2);
    expect(mocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight start result after leaving the page', async () => {
    vi.useFakeTimers();
    const pending = deferred<FeishuDirectorySyncView>();
    mocks.startFeishuDirectorySync.mockReturnValue(pending.promise);
    const view = await renderPage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `${P}.start` })));
    view.unmount();
    await act(async () => pending.resolve(task()));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.getFeishuDirectorySync).toHaveBeenCalledTimes(1);
    expect(mocks.listUsers).toHaveBeenCalledTimes(1);
  });
});
