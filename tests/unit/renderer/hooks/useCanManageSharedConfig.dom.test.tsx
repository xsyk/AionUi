/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };

const mocks = vi.hoisted(() => ({
  isDesktop: false,
  user: null as MockAuthUser | null,
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => mocks.isDesktop,
}));

import { useCanManageSharedConfig } from '@/renderer/hooks/system/useCanManageSharedConfig';

describe('useCanManageSharedConfig', () => {
  beforeEach(() => {
    mocks.isDesktop = false;
    mocks.user = null;
  });

  it('lets the super admin manage the shared configuration', () => {
    mocks.user = { id: 'system_default_user', is_super_admin: true, username: 'admin' };

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(true);
  });

  it('keeps regular users read-only', () => {
    mocks.user = { id: 'user-2', is_super_admin: false, username: 'bob' };

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(false);
  });

  it('keeps users without the admin flag read-only', () => {
    mocks.user = { id: 'user-3', username: 'carol' };

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(false);
  });

  it('decides a signed-in user by the admin flag, whatever the platform', () => {
    mocks.isDesktop = true;
    mocks.user = { id: 'user-2', is_super_admin: false, username: 'bob' };

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(false);
  });

  it('treats the desktop app, which has no sign-in, as the administrator', () => {
    mocks.isDesktop = true;
    mocks.user = null;

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(true);
  });

  it('keeps a browser without a signed-in user read-only', () => {
    mocks.isDesktop = false;
    mocks.user = null;

    const { result } = renderHook(() => useCanManageSharedConfig());

    expect(result.current).toBe(false);
  });
});
