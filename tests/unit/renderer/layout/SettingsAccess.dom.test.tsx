/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser } from '@/renderer/hooks/context/AuthContext';

const fixtures = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isMobile: false,
  extensionTabs: [],
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: fixtures.user }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: fixtures.isMobile }),
}));
vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: () => fixtures.extensionTabs,
}));
vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({ resolveExtTabName: (tab: { name: string }) => tab.name }),
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  resolveExtensionAssetUrl: (url: string) => url,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/WebuiModalContent', () => ({
  default: () => <div data-testid='webui-content' />,
}));

import SettingsSider from '@/renderer/pages/settings/components/SettingsSider';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import WebuiSettings from '@/renderer/pages/settings/WebuiSettings';

const ADMIN: AuthUser = { id: 'super-admin', username: 'admin', is_super_admin: true };
const REGULAR_USER: AuthUser = { id: 'regular-user', username: 'member', is_super_admin: false };
const USER_WITHOUT_ROLE: AuthUser = { id: 'other-user', username: 'admin' };
const MENU_VARIANTS = ['sider', 'mobile'] as const;
type MenuVariant = (typeof MENU_VARIANTS)[number];

const LocationProbe = () => <div data-testid='location'>{useLocation().pathname}</div>;

function Menu({ variant }: { variant: MenuVariant }) {
  return (
    <MemoryRouter initialEntries={['/settings/agent']}>
      {variant === 'sider' ? <SettingsSider /> : <SettingsPageWrapper>{null}</SettingsPageWrapper>}
      <LocationProbe />
    </MemoryRouter>
  );
}

function renderMenu(variant: MenuVariant, user: AuthUser | null) {
  fixtures.user = user;
  fixtures.isMobile = variant === 'mobile';
  return render(<Menu variant={variant} />);
}

function renderWebuiPage(user: AuthUser | null) {
  fixtures.user = user;
  return render(
    <MemoryRouter initialEntries={['/settings/webui']}>
      <Routes>
        <Route path='/settings/webui' element={<WebuiSettings />} />
        <Route path='/settings/agent' element={<div data-testid='agent-page' />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  fixtures.user = null;
  fixtures.isMobile = false;
});

afterEach(cleanup);

describe.each(MENU_VARIANTS)('%s settings menu administrator access', (variant) => {
  it.each([
    ['regular user', REGULAR_USER],
    ['user without an administrator flag', USER_WITHOUT_ROLE],
    ['unresolved user', null],
  ] as const)('hides remote connection and user management for a %s', (_label, user) => {
    renderMenu(variant, user);

    expect(screen.queryByText('settings.webui')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.userManagement.title')).not.toBeInTheDocument();
    expect(screen.getByText('settings.agents')).toBeInTheDocument();
  });

  it('keeps user management immediately before remote connection for the administrator', () => {
    renderMenu(variant, ADMIN);

    const labels = screen
      .getAllByText(/^settings\.(webui|userManagement\.title)$/)
      .map((element) => element.textContent);
    expect(labels).toEqual(['settings.userManagement.title', 'settings.webui']);
  });

  it('opens remote connection when the administrator clicks its menu entry', () => {
    renderMenu(variant, ADMIN);

    fireEvent.click(screen.getByText('settings.webui'));

    expect(screen.getByTestId('location')).toHaveTextContent('/settings/webui');
  });

  it('updates remote connection visibility when the current user changes', () => {
    const view = renderMenu(variant, null);
    expect(screen.queryByText('settings.webui')).not.toBeInTheDocument();

    fixtures.user = ADMIN;
    view.rerender(<Menu variant={variant} />);
    expect(screen.getByText('settings.webui')).toBeInTheDocument();

    fixtures.user = REGULAR_USER;
    view.rerender(<Menu variant={variant} />);
    expect(screen.queryByText('settings.webui')).not.toBeInTheDocument();
  });
});

describe('remote connection page administrator access', () => {
  it.each([
    ['regular user', REGULAR_USER],
    ['user without an administrator flag', USER_WITHOUT_ROLE],
  ] as const)('redirects a %s opening the page directly to agent settings', (_label, user) => {
    renderWebuiPage(user);

    expect(screen.queryByTestId('webui-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/agent');
  });

  it('does not render protected content or redirect before the user is resolved', () => {
    renderWebuiPage(null);

    expect(screen.queryByTestId('webui-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/webui');
  });

  it('renders remote connection settings for the administrator', () => {
    renderWebuiPage(ADMIN);

    expect(screen.getByTestId('webui-content')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/webui');
  });
});
