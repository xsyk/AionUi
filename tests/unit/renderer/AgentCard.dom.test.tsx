/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AgentCard — the assistant-style row used on the Agent
 * settings page. Covers the disabled-agent treatment (a toggled-off custom
 * agent stays visible but greyed), the status tags, and the per-row
 * test-connection / edit actions shared by official and custom agents. A
 * read-only card (agents are shared by the whole server and only the
 * administrator can change them) keeps the status and test connection but
 * drops every action that writes.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Project convention: t() echoes the key so labels are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

import AgentCard from '@renderer/pages/settings/AgentSettings/AgentCard';

const baseAgent = {
  id: 'agent-1',
  name: 'Hermes',
  command: '/usr/local/bin/hermes-acp',
  args: ['--remote'],
};

const renderCustom = (
  enabled: boolean,
  handlers: Partial<{ onToggle: (v: boolean) => void; onTestConnection: () => void; onConfigure: () => void }> = {}
) =>
  render(
    <AgentCard
      type='custom'
      agent={{ ...baseAgent, enabled, agent_type: 'acp', agent_source: 'custom', installed: true, status: 'online' }}
      boundAssistants={[]}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onToggle={handlers.onToggle ?? vi.fn()}
      onTestConnection={handlers.onTestConnection ?? vi.fn()}
      onConfigure={handlers.onConfigure ?? vi.fn()}
    />
  );

describe('AgentCard (custom variant)', () => {
  it('greys the identity block and keeps the test-connection action available when the agent is disabled', () => {
    const { container } = renderCustom(false);

    // Disabled => identity block carries the opacity treatment.
    expect(container.querySelector('.opacity-50')).toBeTruthy();
    const testConnection = screen
      .getByText('settings.agentManagement.testConnection')
      .closest('button') as HTMLButtonElement;
    expect(testConnection.disabled).toBe(false);
  });

  it('renders at full opacity with both test-connection and edit actions when enabled', () => {
    const { container } = renderCustom(true);

    expect(container.querySelector('.opacity-50')).toBeNull();
    expect(screen.getByText('settings.agentManagement.testConnection')).toBeTruthy();
    expect(screen.getByText('common.edit')).toBeTruthy();
  });

  it('fires onTestConnection when the test-connection button is clicked', () => {
    const onTestConnection = vi.fn();
    renderCustom(true, { onTestConnection });

    fireEvent.click(screen.getByText('settings.agentManagement.testConnection'));
    expect(onTestConnection).toHaveBeenCalled();
  });

  it('fires onToggle when the switch is clicked', () => {
    const onToggle = vi.fn();
    const { container } = renderCustom(false, { onToggle });

    const toggle = container.querySelector('[role="switch"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
  });
});

const renderOfficial = (
  agent: Record<string, unknown>,
  handlers: Partial<{ onTestConnection: () => void; onConfigure: () => void }> = {}
) =>
  render(
    <AgentCard
      type='official'
      agent={agent as never}
      boundAssistants={[]}
      onTestConnection={handlers.onTestConnection ?? vi.fn()}
      onConfigure={handlers.onConfigure ?? vi.fn()}
    />
  );

describe('AgentCard (official variant)', () => {
  it('shows status tag plus test-connection and edit actions for a missing official agent', () => {
    renderOfficial({
      id: 'claude',
      name: 'Claude Code',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'claude',
      enabled: true,
      installed: false,
      status: 'missing',
      last_check_error_code: 'command_not_found',
      last_check_error_details: { command: 'claude' },
      last_check_error_message: 'CLI command not found',
    });

    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
    // F2-02: test-connection stays available in every state, including missing.
    expect(screen.getByText('settings.agentManagement.testConnection')).toBeInTheDocument();
    expect(screen.getByText('common.edit')).toBeInTheDocument();
  });

  it('shows the needs-sign-in status when an offline agent reports auth_required', () => {
    renderOfficial({
      id: 'kimi',
      name: 'Kimi',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'kimi',
      enabled: true,
      installed: true,
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    // auth_required is split out of the generic offline label.
    expect(screen.getByText('settings.agentManagement.statusNeedsAuth')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusOffline')).toBeNull();
  });

  it('shows the unchecked status before an agent has been manually tested', () => {
    renderOfficial({
      id: 'qwen',
      name: 'Qwen',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'qwen',
      enabled: true,
      installed: false,
      status: 'unchecked',
    });

    expect(screen.getByText('settings.agentManagement.statusUnchecked')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusUnknown')).toBeNull();
  });

  it('shows the generic unavailable status for a non-auth offline agent', () => {
    renderOfficial({
      id: 'droid',
      name: 'Droid',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'droid',
      enabled: true,
      installed: true,
      status: 'offline',
      last_check_error_code: 'acp_init_failed',
    });

    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusNeedsAuth')).toBeNull();
  });

  it('fires onTestConnection when an online official agent is tested', () => {
    const onTestConnection = vi.fn();
    renderOfficial(
      {
        id: 'gemini',
        name: 'Gemini CLI',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'gemini',
        enabled: true,
        installed: true,
        status: 'online',
      },
      { onTestConnection }
    );

    fireEvent.click(screen.getByText('settings.agentManagement.testConnection'));
    expect(onTestConnection).toHaveBeenCalled();
  });

  it('fires onConfigure when the edit action is clicked', () => {
    const onConfigure = vi.fn();
    renderOfficial(
      {
        id: 'gemini',
        name: 'Gemini CLI',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'gemini',
        enabled: true,
        installed: true,
        status: 'online',
      },
      { onConfigure }
    );

    fireEvent.click(screen.getByText('common.edit'));
    expect(onConfigure).toHaveBeenCalled();
  });
});

describe('AgentCard (administrator)', () => {
  it('offers the definition editor and delete next to the enable switch of a custom agent', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <AgentCard
        type='custom'
        agent={{
          ...baseAgent,
          enabled: true,
          agent_type: 'acp',
          agent_source: 'custom',
          installed: true,
          status: 'online',
        }}
        boundAssistants={[]}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggle={vi.fn()}
        onTestConnection={vi.fn()}
        onConfigure={vi.fn()}
      />
    );

    expect(screen.getByRole('switch')).toBeEnabled();
    fireEvent.click(screen.getByTestId('agent-row-definition-agent-1'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('agent-row-delete-agent-1'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('AgentCard (read-only)', () => {
  const renderReadOnlyCustom = (handlers: Partial<{ onTestConnection: () => void; onConfigure: () => void }> = {}) => {
    const props = {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onToggle: vi.fn(),
      onTestConnection: handlers.onTestConnection ?? vi.fn(),
      onConfigure: handlers.onConfigure ?? vi.fn(),
    };
    render(
      <AgentCard
        type='custom'
        readOnly
        agent={{
          ...baseAgent,
          enabled: true,
          agent_type: 'acp',
          agent_source: 'custom',
          installed: true,
          status: 'online',
        }}
        boundAssistants={[]}
        {...props}
      />
    );
    return props;
  };

  it('keeps the status and test connection of a custom agent but offers no edit, definition editor or delete', () => {
    const { onTestConnection } = renderReadOnlyCustom();

    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('settings.agentManagement.statusOnline')).toBeInTheDocument();
    expect(screen.queryByText('common.edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-edit-agent-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-definition-agent-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-delete-agent-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('settings.agentManagement.testConnection'));
    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });

  it('shows the enable state of a custom agent on a disabled switch that changes nothing', () => {
    const { onToggle } = renderReadOnlyCustom();

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('still opens the status page when the row is clicked', () => {
    const onConfigure = vi.fn();
    renderReadOnlyCustom({ onConfigure });

    fireEvent.click(screen.getByTestId('agent-row-agent-1'));
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it('keeps the status and test connection of an official agent but offers no edit action', () => {
    const onTestConnection = vi.fn();
    render(
      <AgentCard
        type='official'
        readOnly
        agent={
          {
            id: 'claude',
            name: 'Claude Code',
            agent_type: 'acp',
            agent_source: 'builtin',
            backend: 'claude',
            enabled: true,
            installed: false,
            status: 'missing',
          } as never
        }
        boundAssistants={[]}
        onTestConnection={onTestConnection}
        onConfigure={vi.fn()}
      />
    );

    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
    expect(screen.queryByText('common.edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-edit-claude')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-row-test-claude'));
    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });
});
