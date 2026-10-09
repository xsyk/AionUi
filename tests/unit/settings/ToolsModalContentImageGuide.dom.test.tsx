/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SettingsTabNavigateProvider } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };

const ADMIN_USER: MockAuthUser = { id: 'system_default_user', is_super_admin: true, username: 'admin' };
const REGULAR_USER: MockAuthUser = { id: 'user-2', is_super_admin: false, username: 'bob' };

const hooks = vi.hoisted(() => ({
  authUser: null as MockAuthUser | null,
  modelListWithImage: [] as unknown[],
  mcpServers: [] as unknown[],
  getClientBusinessSetting: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/AionSelect', () => {
  const Select = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { default: Object.assign(Select, { OptGroup: Select, Option: Select }) };
});

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: () => <div>TalkToButlerButton</div>,
}));

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({ modelListWithImage: hooks.modelListWithImage }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: hooks.mcpServers,
    extensionMcpServers: [],
    saveMcpServers: vi.fn(() => Promise.resolve()),
    setMcpServers: vi.fn(),
    isMcpServersLoading: false,
  }),
  useMcpConnection: () => ({ testingServers: {}, handleTestMcpConnection: vi.fn(), handleTestMcpConnections: vi.fn() }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: [],
    showAddMcpModal: vi.fn(),
    showEditMcpModal: vi.fn(),
    hideMcpModal: vi.fn(),
    showDeleteConfirm: vi.fn(),
    hideDeleteConfirm: vi.fn(),
    toggleServerCollapse: vi.fn(),
  }),
  useMcpServerCRUD: () => ({
    handleAddMcpServer: vi.fn(),
    handleBatchImportMcpServers: vi.fn(),
    handleEditMcpServer: vi.fn(),
    handleDeleteMcpServer: vi.fn(),
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
  useMountedMessage: (m: unknown) => m,
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: hooks.getClientBusinessSetting,
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {},
  imageGeneration: {
    get: {
      invoke: vi.fn(() => Promise.resolve({ provider_id: null, model: null, enabled: false, supported: true })),
    },
    update: { invoke: vi.fn() },
  },
}));

// The image model is shared by every user, so the page asks who is looking at it: only the administrator can add
// the models it is chosen from, so only the administrator is pointed at the model settings.
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: hooks.authUser }),
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

describe('ToolsModalContent image model guide', () => {
  beforeEach(() => {
    hooks.authUser = ADMIN_USER;
    hooks.modelListWithImage = [];
    hooks.mcpServers = [];
    hooks.getClientBusinessSetting.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
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
  });

  /** Mounts the page over a fresh SWR cache so one test's shared image setting never leaks into the next. */
  const renderTools = (ui: React.ReactElement) =>
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

  const GUIDE_LINK_SELECTOR = 'a[href*="Image-Generation-Tool-Model-Configuration-Guide"]';

  it('renders a clickable "go to configure" link that navigates to the model tab', async () => {
    const navigateToTab = vi.fn();
    renderTools(
      <SettingsTabNavigateProvider value={navigateToTab}>
        <ToolsModalContent />
      </SettingsTabNavigateProvider>
    );

    const link = await screen.findByText('settings.goToModelSettings');
    // Rendered as an inline anchor (text link), not a button.
    expect(link.tagName).toBe('A');
    fireEvent.click(link);

    await waitFor(() => expect(navigateToTab).toHaveBeenCalledWith('model'));
  });

  it('renders the guide text as plain text (no link) when no tab navigator is provided', async () => {
    const { container } = renderTools(<ToolsModalContent />);

    // The empty-state hint still shows the go-to-configure wording, but not as a clickable link.
    await waitFor(() => expect(container.textContent).toContain('settings.goToModelSettings'));
    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'settings.goToModelSettings'
    );
    expect(links).toHaveLength(0);
  });

  it('keeps the configuration guide next to the empty state for the administrator', async () => {
    const { container } = renderTools(<ToolsModalContent />);

    await waitFor(() => expect(container.textContent).toContain('settings.noAvailable'));
    expect(container.querySelector(GUIDE_LINK_SELECTOR)).not.toBeNull();
  });

  it('does not send a user who cannot add models to the model settings or the guide', async () => {
    // Models are added by the administrator, so for everyone else the link and the guide lead nowhere.
    hooks.authUser = REGULAR_USER;
    const navigateToTab = vi.fn();
    const { container } = renderTools(
      <SettingsTabNavigateProvider value={navigateToTab}>
        <ToolsModalContent />
      </SettingsTabNavigateProvider>
    );

    await waitFor(() => expect(container.textContent).toContain('settings.noAvailable'));
    expect(container.textContent).not.toContain('settings.goToModelSettings');
    expect(container.querySelector(GUIDE_LINK_SELECTOR)).toBeNull();
  });
});
