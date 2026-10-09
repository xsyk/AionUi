/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Message } from '@arco-design/web-react';
import AgentRepairPanel from '@/renderer/pages/settings/AgentSettings/AgentRepairPanel';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { acpConversation } from '@/common/adapter/ipcBridge';

vi.mock('@/common/adapter/ipcBridge', () => ({
  acpConversation: {
    getAgentOverrides: {
      invoke: vi.fn(),
    },
    setAgentOverrides: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('AgentRepairPanel', () => {
  const mockAgent: ManagedAgent = {
    id: 'test-agent-1',
    name: 'Test Agent',
    agent_type: 'acp',
    agent_source: 'custom',
    command: '/usr/local/bin/test-cli',
    enabled: true,
    installed: true,
    status: 'offline',
    env_override_key_count: 2,
    has_command_override: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  });

  it('loads current overrides on mount without an unlock step', async () => {
    const getMock = vi.mocked(acpConversation.getAgentOverrides.invoke);
    getMock.mockResolvedValue({
      command_override: '/custom/path/cli',
      env_override: [{ name: 'API_KEY', value: 'secret123' }],
    });
    const onSaved = vi.fn();

    render(<AgentRepairPanel agent={mockAgent} onSaved={onSaved} />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ id: 'test-agent-1' });
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/repair\.pathPlaceholder/)).toHaveValue('/custom/path/cli');
    });
  });

  it('saves overrides then triggers test connection once', async () => {
    const user = userEvent.setup();
    const getMock = vi.mocked(acpConversation.getAgentOverrides.invoke);
    const setMock = vi.mocked(acpConversation.setAgentOverrides.invoke);
    const onSaved = vi.fn();

    getMock.mockResolvedValue({
      command_override: '/custom/path/cli',
      env_override: [
        { name: 'API_KEY', value: 'secret123' },
        { name: 'FACTORY_URL', value: 'http://localhost:8080' },
      ],
    });

    setMock.mockResolvedValue({
      ...mockAgent,
      status: 'online',
      has_command_override: true,
      env_override_key_count: 2,
    });

    render(<AgentRepairPanel agent={mockAgent} onSaved={onSaved} />);

    // Overrides load on mount — wait for the path input to fill.
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ id: 'test-agent-1' });
    });
    await waitFor(() => {
      const pathInput = screen.getByPlaceholderText(/repair\.pathPlaceholder/);
      expect(pathInput).toHaveValue('/custom/path/cli');
    });

    // Change path
    const pathInput = screen.getByPlaceholderText(/repair\.pathPlaceholder/);
    await user.clear(pathInput);
    await user.type(pathInput, '/new/path/cli');

    // Save
    const saveButton = screen.getByRole('button', { name: /repair\.saveAndTest/ });
    await user.click(saveButton);

    await waitFor(() => {
      expect(setMock).toHaveBeenCalledWith({
        id: 'test-agent-1',
        command_override: '/new/path/cli',
        env_override: [
          { name: 'API_KEY', value: 'secret123' },
          { name: 'FACTORY_URL', value: 'http://localhost:8080' },
        ],
      });
      expect(Message.success).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('blocks save on duplicate env keys', async () => {
    const user = userEvent.setup();
    const getMock = vi.mocked(acpConversation.getAgentOverrides.invoke);
    const setMock = vi.mocked(acpConversation.setAgentOverrides.invoke);
    const onSaved = vi.fn();

    getMock.mockResolvedValue({
      env_override: [
        { name: 'API_KEY', value: 'secret1' },
        { name: 'API_KEY', value: 'secret2' },
      ],
    });

    render(<AgentRepairPanel agent={mockAgent} onSaved={onSaved} />);

    // Wait for the mount-time load to populate the duplicate env rows.
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ id: 'test-agent-1' });
    });

    // Try to save
    const saveButton = screen.getByRole('button', { name: /repair\.saveAndTest/ });
    await user.click(saveButton);

    // Should show error and not call setAgentOverrides
    await waitFor(() => {
      expect(screen.getByText(/repair\.duplicateKeysError/)).toBeInTheDocument();
    });

    expect(setMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not save when no override value was entered', async () => {
    const user = userEvent.setup();
    const getMock = vi.mocked(acpConversation.getAgentOverrides.invoke);
    const setMock = vi.mocked(acpConversation.setAgentOverrides.invoke);
    const onSaved = vi.fn();

    getMock.mockResolvedValue({});

    render(<AgentRepairPanel agent={mockAgent} onSaved={onSaved} />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ id: 'test-agent-1' });
    });

    const saveButton = screen.getByRole('button', { name: /repair\.saveAndTest/ });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/repair\.emptyOverridesError/)).toBeInTheDocument();
    });

    expect(setMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows the offline diagnostic banner and the launch path for an offline agent', async () => {
    vi.mocked(acpConversation.getAgentOverrides.invoke).mockResolvedValue({});

    render(<AgentRepairPanel agent={mockAgent} onSaved={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('settings.repair.offlineTitle')).toBeInTheDocument();
    });
    // Non-online agents expose the launch path as the primary lever.
    expect(screen.getByText('settings.repair.pathLabel')).toBeInTheDocument();
  });

  it('shows the online banner and hides the launch path entirely when online', async () => {
    vi.mocked(acpConversation.getAgentOverrides.invoke).mockResolvedValue({});

    render(<AgentRepairPanel agent={{ ...mockAgent, status: 'online' }} onSaved={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('settings.repair.onlineTitle')).toBeInTheDocument();
    });
    // Online: only environment variables are shown; the launch path is hidden.
    expect(screen.getByText('settings.repair.envLabel')).toBeInTheDocument();
    expect(screen.queryByText('settings.repair.pathLabel')).toBeNull();
  });

  it('does not expose override editing for the internal Aion CLI agent', async () => {
    vi.mocked(acpConversation.getAgentOverrides.invoke).mockResolvedValue({
      command_override: '/bad/path',
      env_override: [{ name: 'ANTHROPIC_API_KEY', value: 'sk-x' }],
    });

    render(
      <AgentRepairPanel
        agent={{
          ...mockAgent,
          id: '632f31d2',
          name: 'Aion CLI',
          agent_type: 'aionrs',
          agent_source: 'internal',
          status: 'online',
        }}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('settings.repair.onlineTitle')).toBeInTheDocument();
    });

    expect(acpConversation.getAgentOverrides.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText('settings.repair.pathLabel')).toBeNull();
    expect(screen.queryByText('settings.repair.envLabel')).toBeNull();
    expect(screen.queryByRole('button', { name: /repair\.saveAndTest/ })).toBeNull();
  });
});

describe('AgentRepairPanel (read-only)', () => {
  // Overrides are shared by the whole server and only the administrator can read or change them.
  const sharedAgent: ManagedAgent = {
    id: 'test-agent-2',
    name: 'Shared Agent',
    agent_type: 'acp',
    agent_source: 'builtin',
    backend: 'claude',
    command: 'claude',
    enabled: true,
    installed: true,
    status: 'offline',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acpConversation.getAgentOverrides.invoke).mockResolvedValue({});
  });

  it('does not fetch the overrides, which the server only returns to the administrator', async () => {
    render(<AgentRepairPanel agent={sharedAgent} readOnly onSaved={vi.fn()} />);

    expect(await screen.findByText('settings.repair.offlineTitle')).toBeInTheDocument();
    expect(acpConversation.getAgentOverrides.invoke).not.toHaveBeenCalled();
  });

  it.each(['missing', 'offline', 'online'] as const)(
    'renders no launch path, environment variables or save button when the agent is %s',
    async (status) => {
      render(<AgentRepairPanel agent={{ ...sharedAgent, status }} readOnly onSaved={vi.fn()} />);

      expect(await screen.findByText(`settings.repair.${status}Title`)).toBeInTheDocument();
      expect(screen.queryByText('settings.repair.pathLabel')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.repair.envLabel')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/repair\.pathPlaceholder/)).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /repair\.saveAndTest/ })).not.toBeInTheDocument();
      expect(acpConversation.getAgentOverrides.invoke).not.toHaveBeenCalled();
    }
  );

  it('still explains a failed check with its diagnostic message', async () => {
    render(
      <AgentRepairPanel
        agent={{ ...sharedAgent, last_check_error_message: 'spawn claude ENOENT' }}
        readOnly
        onSaved={vi.fn()}
      />
    );

    expect(await screen.findByText('settings.repair.offlineTitle')).toBeInTheDocument();
    expect(screen.getByText('spawn claude ENOENT')).toBeInTheDocument();
  });

  it('drops the generic hints that send the reader to the launch path and environment variables', async () => {
    const { rerender } = render(<AgentRepairPanel agent={sharedAgent} onSaved={vi.fn()} />);
    // The administrator keeps the hint: the fields it mentions are right below it.
    expect(await screen.findByText('settings.repair.offlineHint')).toBeInTheDocument();

    rerender(<AgentRepairPanel agent={sharedAgent} readOnly onSaved={vi.fn()} />);
    expect(screen.getByText('settings.repair.offlineTitle')).toBeInTheDocument();
    expect(screen.queryByText('settings.repair.offlineHint')).not.toBeInTheDocument();

    rerender(<AgentRepairPanel agent={{ ...sharedAgent, status: 'missing' }} readOnly onSaved={vi.fn()} />);
    expect(screen.getByText('settings.repair.missingTitle')).toBeInTheDocument();
    expect(screen.queryByText('settings.repair.missingHint')).not.toBeInTheDocument();

    rerender(<AgentRepairPanel agent={{ ...sharedAgent, status: 'online' }} readOnly onSaved={vi.fn()} />);
    expect(screen.getByText('settings.repair.onlineTitle')).toBeInTheDocument();
    expect(screen.queryByText('settings.repair.onlineHint')).not.toBeInTheDocument();
  });

  it('keeps the unchecked hint, which points at the Test Connection button that read-only users still have', async () => {
    render(<AgentRepairPanel agent={{ ...sharedAgent, status: 'unchecked' }} readOnly onSaved={vi.fn()} />);

    expect(await screen.findByText('settings.repair.uncheckedTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.repair.uncheckedHint')).toBeInTheDocument();
  });

  it('keeps loading the overrides for administrators', async () => {
    vi.mocked(acpConversation.getAgentOverrides.invoke).mockResolvedValue({ command_override: '/custom/path/cli' });

    render(<AgentRepairPanel agent={sharedAgent} readOnly={false} onSaved={vi.fn()} />);

    await waitFor(() => {
      expect(acpConversation.getAgentOverrides.invoke).toHaveBeenCalledWith({ id: 'test-agent-2' });
    });
    expect(await screen.findByDisplayValue('/custom/path/cli')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /repair\.saveAndTest/ })).toBeInTheDocument();
  });
});
