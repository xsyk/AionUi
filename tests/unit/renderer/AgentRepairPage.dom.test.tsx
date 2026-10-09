/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test for the agent repair page staying mounted during background
 * catalog revalidation. SWR revalidates the managed-agent catalog when the
 * window regains focus; if the page unmounts its body while `isRefreshing`,
 * unsaved env-var/path edits held in AgentRepairPanel local state are wiped —
 * e.g. a user adds an env row, switches apps to copy the key, and comes back
 * to find the row gone.
 *
 * It also covers the shared-config rule: the agents are shared by the whole
 * server, so the administrator edits the overrides and everyone else gets the
 * status and the test-connection action only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Who is looking at the page: the signed-in user's admin flag (or, without a user, the desktop app) decides.
type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };
const ADMIN_USER: MockAuthUser = { id: 'system_default_user', is_super_admin: true, username: 'admin' };
const REGULAR_USER: MockAuthUser = { id: 'user-2', is_super_admin: false, username: 'bob' };
const { viewer } = vi.hoisted(() => ({
  viewer: { isDesktop: false, user: null as MockAuthUser | null },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: viewer.user }),
}));
vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => viewer.isDesktop,
}));

// Arco's imperative Message cannot mount in jsdom; replace it with spies so the toast text is assertable.
const { messageError, messageSuccess, messageWarning } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { error: messageError, success: messageSuccess, warning: messageWarning },
  };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ id: 'agent-1' }),
  };
});

const useManagedAgents = vi.fn();
vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => useManagedAgents(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
  },
}));

// The panel's own behavior is covered by AgentRepairPanel.dom.test.tsx — here
// we only assert whether the page keeps it mounted and whether it hands it over read-only.
vi.mock('@renderer/pages/settings/AgentSettings/AgentRepairPanel', () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid='agent-repair-panel-stub' data-readonly={String(Boolean(readOnly))} />
  ),
}));
vi.mock('@renderer/pages/settings/AgentSettings/BoundAssistants', () => ({
  BoundAssistantList: () => null,
  getBoundAssistants: () => [],
  useAssistantsForAgents: () => ({ assistants: [] }),
}));

import AgentRepairPage from '@renderer/pages/settings/AgentSettings/AgentRepairPage';
import { ipcBridge } from '@/common';

const agent = {
  id: 'agent-1',
  name: 'Test Agent',
  agent_type: 'acp',
  agent_source: 'custom',
  enabled: true,
  installed: true,
  status: 'online',
};

beforeEach(() => {
  // Default to the administrator in a browser: the page the tests that predate the shared-config rule expect.
  viewer.isDesktop = false;
  viewer.user = ADMIN_USER;
});

describe('AgentRepairPage', () => {
  it('keeps the repair panel mounted while the catalog revalidates in the background', () => {
    useManagedAgents.mockReturnValue({ agents: [agent], isRefreshing: true, refreshCatalog: vi.fn() });

    render(<AgentRepairPage />);

    expect(screen.getByTestId('agent-repair-panel-stub')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates back to the agent list when the agent no longer exists after refresh', () => {
    useManagedAgents.mockReturnValue({ agents: [], isRefreshing: false, refreshCatalog: vi.fn() });

    render(<AgentRepairPage />);

    expect(screen.queryByTestId('agent-repair-panel-stub')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/settings/agent', { replace: true });
  });
});

describe('AgentRepairPage shared configuration', () => {
  const checkHealth = () => vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    useManagedAgents.mockReturnValue({ agents: [agent], isRefreshing: false, refreshCatalog: vi.fn() });
  });

  it('tells administrators the settings apply to everyone and gives them the editable panel', () => {
    render(<AgentRepairPage />);

    expect(screen.getByText('settings.sharedConfig.agentsAdmin')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsReadonly')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-repair-panel-stub')).toHaveAttribute('data-readonly', 'false');
  });

  it('tells non-admin users the agent is managed by the administrator and makes the panel read-only', () => {
    viewer.user = REGULAR_USER;
    render(<AgentRepairPage />);

    expect(screen.getByText('settings.sharedConfig.agentsReadonly')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsAdmin')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-repair-panel-stub')).toHaveAttribute('data-readonly', 'true');
  });

  it('keeps the agent name, the back button and the test-connection action for non-admin users', async () => {
    viewer.user = REGULAR_USER;
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: [agent], isRefreshing: false, refreshCatalog });
    checkHealth().mockResolvedValue({ ...agent, status: 'online' });
    render(<AgentRepairPage />);

    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByTestId('btn-back-agent-repair')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-test-connection-agent-repair'));

    await waitFor(() => {
      expect(checkHealth()).toHaveBeenCalledWith({ id: 'agent-1' });
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('keeps the desktop app, which has no signed-in user, editable', () => {
    viewer.user = null;
    viewer.isDesktop = true;
    render(<AgentRepairPage />);

    expect(screen.getByText('settings.sharedConfig.agentsAdmin')).toBeInTheDocument();
    expect(screen.getByTestId('agent-repair-panel-stub')).toHaveAttribute('data-readonly', 'false');
  });

  it('keeps a browser without a signed-in user read-only', () => {
    viewer.user = null;
    viewer.isDesktop = false;
    render(<AgentRepairPage />);

    expect(screen.getByText('settings.sharedConfig.agentsReadonly')).toBeInTheDocument();
    expect(screen.getByTestId('agent-repair-panel-stub')).toHaveAttribute('data-readonly', 'true');
  });
});
