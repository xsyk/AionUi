/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Render test for the LocalAgents settings surface. Its purpose is to lock in
 * that LocalAgents reads the management view (`useManagedAgents`) — the
 * include_disabled data path that keeps user-disabled agents listed — and
 * derives the detected/custom sections from it. It also covers the shared-config
 * rule: only the administrator can change agents, everyone else gets a read-only
 * list they can still test connections from.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// t() echoes the key so section labels/buttons are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

const { messageSuccess, messageWarning, messageError } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));
const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [
        {
          success: messageSuccess,
          warning: messageWarning,
          error: messageError,
        },
        null,
      ],
      success: messageSuccess,
      warning: messageWarning,
      error: messageError,
    },
  };
});

// Controlled management-view data; assert LocalAgents consumes THIS hook.
const useManagedAgents = vi.fn();
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => useManagedAgents(),
}));

// Bridge is only touched by user-action handlers, not on render — stub the
// shape the handlers reference so the import resolves.
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      createCustomAgent: { invoke: vi.fn() },
      updateCustomAgent: { invoke: vi.fn() },
      deleteCustomAgent: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
    // Bound-assistant avatar stacks fetch the assistant list via SWR.
    assistants: {
      list: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

// Who is looking at the page. The agents are shared by the whole server, so the signed-in user's admin flag
// (or, without a user, the desktop app) decides whether the page is editable.
type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };
const ADMIN_USER: MockAuthUser = { id: 'system_default_user', is_super_admin: true, username: 'admin' };
const REGULAR_USER: MockAuthUser = { id: 'user-2', is_super_admin: false, username: 'bob' };
const { viewer } = vi.hoisted(() => ({
  viewer: { isDesktop: false, user: null as MockAuthUser | null },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: viewer.user }),
}));

vi.mock('@renderer/utils/platform', async () => {
  const actual = await vi.importActual<typeof import('@renderer/utils/platform')>('@renderer/utils/platform');
  return {
    ...actual,
    isElectronDesktop: () => viewer.isDesktop,
    openExternalUrl,
  };
});

// Keep the test focused on LocalAgents' own logic — stub heavy children. While open, the modal and the
// editor leave a marker behind so a test can tell whether the custom-agent editor was reachable.
vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
    visible ? <div data-testid='agent-editor-modal'>{children}</div> : null,
}));
vi.mock('@renderer/pages/settings/AgentSettings/InlineAgentEditor', () => ({
  default: () => <div data-testid='inline-agent-editor-stub' />,
}));
vi.mock('@renderer/pages/settings/AgentSettings/AgentHubModal', () => ({ AgentHubModal: () => null }));

import LocalAgents from '@renderer/pages/settings/AgentSettings/LocalAgents';
import AgentModalContent from '@renderer/components/settings/SettingsModal/contents/AgentModalContent';
import { SettingsViewModeProvider } from '@renderer/components/settings/SettingsModal/settingsViewContext';
import { ipcBridge } from '@/common';
import { MemoryRouter } from 'react-router-dom';
import { getBoundAssistants } from '@renderer/pages/settings/AgentSettings/BoundAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const makeAgents = () => [
  {
    id: 'aionrs',
    name: 'Aion CLI',
    agent_type: 'aionrs',
    agent_source: 'internal',
    backend: 'aionrs',
    enabled: true,
    available: true,
    installed: true,
    status: 'online',
  },
  {
    id: 'acp-claude',
    name: 'Claude Code',
    agent_type: 'acp',
    agent_source: 'builtin',
    backend: 'claude',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'openclaw-gateway',
    name: 'OpenClaw Gateway',
    agent_type: 'openclaw-gateway',
    agent_source: 'builtin',
    backend: 'openclaw-gateway',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'custom-1',
    name: 'My Agent',
    agent_type: 'acp',
    agent_source: 'custom',
    command: 'sh',
    enabled: true,
    available: true,
    installed: true,
    status: 'offline',
  },
];

beforeEach(() => {
  // Default to the administrator in a browser: the page the tests that predate the shared-config rule expect.
  viewer.isDesktop = false;
  viewer.user = ADMIN_USER;
});

describe('LocalAgents', () => {
  it('runs the health probe and shows a success toast after an official-agent test connection succeeds', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'online',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'aionrs' });
    });
    await waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('warns with the auth guidance when a test connection reports auth_required', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      // formatManagedAgentDiagnosticMessage maps auth_required → its errorCodes key.
      expect(messageWarning).toHaveBeenCalledWith('settings.agentManagement.errorCodes.auth_required');
    });
  });

  it('reads the managed-agents view and renders detected + custom sections', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Proves L30 (useManagedAgents) ran and fed the derived lists.
    expect(useManagedAgents).toHaveBeenCalled();
    expect(screen.getByText('Aion CLI')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('shows the empty state when no detected agents are present', () => {
    useManagedAgents.mockReturnValue({ agents: [], revalidate: vi.fn(), refreshCatalog: vi.fn() });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.localAgentsEmpty')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customEmpty')).toBeTruthy();
  });

  it('renders official/custom sections with management statuses and removes the chat shortcut', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    // Only Claude Code shows 'missing' now; openclaw-gateway is filtered out as deprecated
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeTruthy();
    expect(screen.queryByText('settings.agentManagement.goToChat')).toBeNull();
    // Verify deprecated agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
  });

  it('shows a lightweight refresh hint while the management view is revalidating', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      isRefreshing: true,
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.refreshingStatuses')).toBeInTheDocument();
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
  });

  it('renders official agents as diagnostics cards and filters out deprecated types', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Agent names render
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    // Deprecated openclaw-gateway agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
    // Status tags render
    expect(screen.getByText('settings.agentManagement.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
  });

  it('does not render the market-install CTA in the diagnostics-only agent page', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.queryByText('settings.agentManagement.installFromMarket')).toBeNull();
    expect(screen.queryByText('settings.agentManagement.discoverMoreAgents')).toBeNull();
  });

  it('renders the setup-guide action for official agents diagnostics', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByText('settings.agentManagement.localAgentsSetupLink'));

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup');
  });

  it('binds assistants to managed agents by agent_id instead of runtime backend', () => {
    const [aionrsAgent, claudeAgent] = makeAgents();
    const assistants: Assistant[] = [
      {
        id: 'assistant-on-claude-runtime',
        source: 'generated',
        name: 'Claude Runtime',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        agent_id: 'acp-other-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
      {
        id: 'assistant-on-claude-agent',
        source: 'generated',
        name: 'Claude Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 2,
        agent_id: 'acp-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
    ];

    expect(getBoundAssistants(claudeAgent, assistants).map((assistant) => assistant.id)).toEqual([
      'assistant-on-claude-agent',
    ]);
    expect(getBoundAssistants(aionrsAgent, assistants)).toEqual([]);
  });

  it('pins Kimi right after the aionrs agent in the official list', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        ...makeAgents(),
        {
          id: 'acp-kimi',
          name: 'Kimi',
          agent_type: 'acp',
          agent_source: 'builtin',
          backend: 'kimi',
          enabled: true,
          available: false,
          installed: false,
          status: 'missing',
        },
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Alphabetically Claude Code < Kimi, so this order proves the pin rule:
    // aionrs stays first, Kimi jumps ahead of the localeCompare ordering.
    const aion = screen.getByText('Aion CLI');
    const kimi = screen.getByText('Kimi');
    const claude = screen.getByText('Claude Code');
    expect(kimi.compareDocumentPosition(aion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(claude.compareDocumentPosition(kimi) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('renders agent management as a single diagnostics page without local/remote tabs', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/settings/agents?tab=remote']}>
        <SettingsViewModeProvider value='page'>
          <AgentModalContent />
        </SettingsViewModeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.localAgents')).toBeNull();
  });

  it('surfaces custom-agent toggle failures to the user', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog,
    });
    vi.mocked(ipcBridge.acpConversation.setAgentEnabled.invoke).mockRejectedValue({
      backendMessage: 'permission denied',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.setAgentEnabled.invoke).toHaveBeenCalledWith({
        id: 'custom-1',
        enabled: false,
      });
      expect(messageError).toHaveBeenCalledWith('permission denied');
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it('renders the availability filter as underline tabs and switches the visible official agents', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Filter tabs render as buttons (underline-tab style), not an Arco radio group.
    const allTab = screen.getByTestId('settings-tab-all');
    const availableTab = screen.getByTestId('settings-tab-available');
    const unavailableTab = screen.getByTestId('settings-tab-unavailable');
    expect(allTab.tagName).toBe('BUTTON');

    // Default "all": both official agents visible (Aion CLI online, Claude Code missing).
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();

    // "available" keeps only the online agent.
    fireEvent.click(availableTab);
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).toBeNull();

    // "unavailable" keeps only the non-online agent.
    fireEvent.click(unavailableTab);
    expect(screen.queryByText('Aion CLI')).toBeNull();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});

describe('LocalAgents shared configuration', () => {
  const rowIds = ['aionrs', 'acp-claude', 'custom-1'];
  const checkHealth = () => vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('tells administrators the agent settings apply to everyone and keeps every management control', () => {
    render(<LocalAgents />);

    expect(screen.getByText('settings.sharedConfig.agentsAdmin')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsReadonly')).not.toBeInTheDocument();
    expect(screen.getByTestId('btn-add-custom-agent')).toBeInTheDocument();
    rowIds.forEach((id) => {
      expect(screen.getByTestId(`agent-row-test-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`agent-row-edit-${id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-row-definition-custom-1')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-delete-custom-1')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeEnabled();
  });

  it('lets administrators open the custom agent editor from the pencil on a row', () => {
    render(<LocalAgents />);
    expect(screen.queryByTestId('agent-editor-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-row-definition-custom-1'));
    expect(
      within(screen.getByTestId('agent-editor-modal')).getByTestId('inline-agent-editor-stub')
    ).toBeInTheDocument();
  });

  it('lets administrators add a custom agent by hand from the add menu', async () => {
    render(<LocalAgents />);

    fireEvent.click(screen.getByTestId('btn-add-custom-agent'));
    fireEvent.click(await screen.findByText('settings.talkToButler.addManually'));

    expect(await screen.findByTestId('agent-editor-modal')).toBeInTheDocument();
  });

  it('lets administrators delete a custom agent', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.deleteCustomAgent.invoke).mockResolvedValue({ deleted: true });
    render(<LocalAgents />);

    fireEvent.click(screen.getByTestId('agent-row-delete-custom-1'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.deleteCustomAgent.invoke).toHaveBeenCalledWith({ id: 'custom-1' });
      expect(refreshCatalog).toHaveBeenCalled();
    });
  });

  it('shows non-admin users a read-only notice and no way to add, edit or delete agents', () => {
    viewer.user = REGULAR_USER;
    render(<LocalAgents />);

    expect(screen.getByText('settings.sharedConfig.agentsReadonly')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsAdmin')).not.toBeInTheDocument();

    // No "add custom agent" entry, neither the button nor its via-chat / manual menu.
    expect(screen.queryByTestId('btn-add-custom-agent')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.addCustomAgent')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.talkToButler.addViaChat')).not.toBeInTheDocument();

    // No edit on any row (neither the Edit button to the settings page nor the pencil of the definition editor)
    // and no delete.
    rowIds.forEach((id) => {
      expect(screen.queryByTestId(`agent-row-edit-${id}`)).not.toBeInTheDocument();
    });
    expect(screen.queryByText('common.edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-definition-custom-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-delete-custom-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-editor-modal')).not.toBeInTheDocument();
  });

  it('still lists every agent with its status, search and availability tabs for non-admin users', () => {
    viewer.user = REGULAR_USER;
    render(<LocalAgents />);

    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('My Agent')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-status-aionrs')).toHaveTextContent('settings.agentManagement.statusOnline');
    expect(screen.getByTestId('agent-row-status-custom-1')).toHaveTextContent('settings.agentManagement.statusOffline');
    expect(screen.getByTestId('input-search-agents')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-available')).toBeInTheDocument();
  });

  it('keeps the test-connection action on every row for non-admin users', async () => {
    viewer.user = REGULAR_USER;
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    checkHealth().mockResolvedValue({ ...makeAgents()[3], status: 'online' });
    render(<LocalAgents />);

    rowIds.forEach((id) => {
      expect(screen.getByTestId(`agent-row-test-${id}`)).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId('agent-row-test-custom-1'));

    await waitFor(() => {
      expect(checkHealth()).toHaveBeenCalledWith({ id: 'custom-1' });
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('disables the enable switch of a custom agent for non-admin users and saves nothing when it is clicked', () => {
    viewer.user = REGULAR_USER;
    render(<LocalAgents />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);

    expect(ipcBridge.acpConversation.setAgentEnabled.invoke).not.toHaveBeenCalled();
  });

  it('still opens the status page when a non-admin user clicks a row', () => {
    viewer.user = REGULAR_USER;
    render(<LocalAgents />);

    fireEvent.click(screen.getByTestId('agent-row-custom-1'));

    expect(navigate).toHaveBeenCalledWith('/settings/agent/custom-1/repair');
  });

  it('keeps full control in the desktop app, which has no signed-in user, and shows no shared-configuration notice', () => {
    viewer.user = null;
    viewer.isDesktop = true;
    render(<LocalAgents />);

    // The desktop app has a single user, so "applies to everyone" would mean nothing there.
    expect(screen.queryByTestId('shared-config-notice')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsAdmin')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.agentsReadonly')).not.toBeInTheDocument();
    expect(screen.getByTestId('btn-add-custom-agent')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-delete-custom-1')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeEnabled();
  });

  it('keeps a browser without a signed-in user read-only', () => {
    viewer.user = null;
    viewer.isDesktop = false;
    render(<LocalAgents />);

    expect(screen.getByText('settings.sharedConfig.agentsReadonly')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-add-custom-agent')).not.toBeInTheDocument();
  });
});
