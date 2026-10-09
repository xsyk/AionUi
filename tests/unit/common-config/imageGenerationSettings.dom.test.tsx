/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The image generation model on the Tools settings page is ONE setting for the whole server: the administrator
 * picks it, every user's sessions get the tool, and the backend injects the MCP server itself. These tests pin
 * the page side of that rule: it reads and writes /api/settings/image-generation only, never the per-user
 * preference or the per-user built-in MCP row, and everyone but the administrator sees it read-only.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { BackendHttpError } from '@/common/adapter/httpBridge';

type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };

const ADMIN_USER: MockAuthUser = { id: 'system_default_user', is_super_admin: true, username: 'admin' };
const REGULAR_USER: MockAuthUser = { id: 'user-2', is_super_admin: false, username: 'bob' };

const GEMINI_PROVIDER = {
  id: 'p-gemini',
  name: 'Gemini',
  platform: 'gemini',
  base_url: '',
  api_key: '',
  models: ['gemini-2.5-pro', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
};
// The generation tool talks to OpenAI's Images API, so this provider's image model is offered.
const OPENAI_PROVIDER = {
  id: 'p-openai',
  name: 'OpenAI',
  platform: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  models: ['gpt-image-1'],
};
// Neither an OpenAI-protocol provider nor one of the chat-style image providers: nothing it hosts is offered.
const ANTHROPIC_PROVIDER = {
  id: 'p-anthropic',
  name: 'Anthropic',
  platform: 'anthropic',
  base_url: '',
  api_key: '',
  models: ['claude-sonnet-4', 'gpt-image-1'],
};

const SAVED_SETTINGS = {
  provider_id: 'p-gemini',
  model: 'gemini-2.5-flash-image',
  enabled: true,
  supported: true,
};
const EMPTY_SETTINGS = { provider_id: null, model: null, enabled: false, supported: true };

const mocks = vi.hoisted(() => ({
  authUser: null as MockAuthUser | null,
  isDesktop: false,
  providers: [] as unknown[],
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateServer: vi.fn(),
  toggleServer: vi.fn(),
  getClientBusinessSetting: vi.fn(),
  setClientBusinessSetting: vi.fn(),
  removeClientBusinessSetting: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Arco's Message cannot mount in jsdom: a test that raises a real toast fails the whole run even when every
// assertion passes. Everything else from Arco stays real so the switch and the notice are the shipped ones.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  const instance = () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: mocks.messageError,
    normal: vi.fn(),
  });
  return { ...actual, Message: { useMessage: () => [instance(), null] } };
});

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// A native <select> stands in for the Arco one so a test can pick an option. Like the real Select it also hands
// renderFormat the option for the current value (null when the list no longer offers it) and shows the result.
// Function declarations are hoisted, which is what lets the hoisted vi.mock factory below use them.
type OfferedOption = { value: string; children?: React.ReactNode };

function collectOptions(nodes: React.ReactNode): OfferedOption[] {
  return React.Children.toArray(nodes).flatMap((node) => {
    if (!React.isValidElement(node)) return [];
    const props = node.props as OfferedOption;
    return typeof props.value === 'string'
      ? [{ value: props.value, children: props.children }]
      : collectOptions(props.children);
  });
}

function MockSelect({
  children,
  disabled,
  onChange,
  renderFormat,
  value,
}: {
  children?: React.ReactNode;
  disabled?: boolean;
  onChange?: (value: string) => void;
  renderFormat?: (option: { children?: React.ReactNode } | null, value: string) => React.ReactNode;
  value?: string;
}) {
  const offered = collectOptions(children).find((option) => option.value === value);
  return (
    <>
      <select
        data-testid='image-model-select'
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      >
        <option value=''>-</option>
        {children}
      </select>
      <span data-testid='image-model-shown'>
        {value === undefined ? null : renderFormat ? renderFormat(offered ?? null, value) : offered?.children}
      </span>
    </>
  );
}

function MockOptGroup({ children, label }: { children?: React.ReactNode; label?: React.ReactNode }) {
  return <optgroup label={String(label)}>{children}</optgroup>;
}

function MockOption({ children, value }: { children?: React.ReactNode; value: string }) {
  return <option value={value}>{children}</option>;
}

vi.mock('@/renderer/components/base/AionSelect', () => ({
  default: Object.assign(MockSelect, { OptGroup: MockOptGroup, Option: MockOption }),
}));

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
  default: () => ({ modelListWithImage: mocks.providers }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: [],
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
  useMountedMessage: (message: unknown) => message,
}));

// Nothing on this page may touch the per-user preference store any more.
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: mocks.getClientBusinessSetting,
  setClientBusinessSetting: mocks.setClientBusinessSetting,
  removeClientBusinessSetting: mocks.removeClientBusinessSetting,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  imageGeneration: {
    get: { invoke: mocks.getSettings },
    update: { invoke: mocks.updateSettings },
  },
  mcpService: {
    updateServer: { invoke: mocks.updateServer },
    toggleServer: { invoke: mocks.toggleServer },
  },
}));

// Who is looking at the page: the signed-in user's admin flag decides, and without a user the desktop app is the admin.
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));

vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => mocks.isDesktop,
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

/** Mounts the page over a fresh SWR cache so one test's settings never leak into the next. */
const renderTools = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <ToolsModalContent />
    </SWRConfig>
  );

const getSwitch = () => screen.getByTestId('image-generation-switch');
const getSelect = () => screen.getByTestId('image-model-select') as HTMLSelectElement;

/** Waits until the shared setting has arrived: the switch stops showing its loading state. */
const renderLoaded = async () => {
  const view = renderTools();
  await waitFor(() => expect(getSwitch()).not.toHaveClass('arco-switch-loading'));
  return view;
};

describe('ToolsModalContent image generation (server-wide setting)', () => {
  beforeEach(() => {
    mocks.authUser = ADMIN_USER;
    mocks.isDesktop = false;
    mocks.providers = [GEMINI_PROVIDER, OPENAI_PROVIDER, ANTHROPIC_PROVIDER];
    mocks.getSettings.mockReset().mockResolvedValue(SAVED_SETTINGS);
    mocks.updateSettings.mockReset().mockImplementation(async (body: object) => ({ ...body, supported: true }));
    mocks.updateServer.mockReset();
    mocks.toggleServer.mockReset();
    mocks.getClientBusinessSetting.mockReset().mockResolvedValue(undefined);
    mocks.setClientBusinessSetting.mockReset().mockResolvedValue(undefined);
    mocks.removeClientBusinessSetting.mockReset().mockResolvedValue(undefined);
    mocks.messageError.mockReset();
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
    vi.restoreAllMocks();
  });

  describe('as the administrator in a browser', () => {
    it('shows the server-wide choice and tells the admin it applies to everyone', async () => {
      await renderLoaded();

      expect(mocks.getSettings).toHaveBeenCalled();
      expect(getSelect()).toHaveValue('p-gemini|gemini-2.5-flash-image');
      expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('settings.sharedConfig.imageAdmin')).toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.imageReadonly')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.imageUnsupported')).not.toBeInTheDocument();
    });

    it('shows the model name, not the raw "provider|model" value, while the list still offers it', async () => {
      await renderLoaded();

      expect(screen.getByTestId('image-model-shown')).toHaveTextContent(/^gemini-2\.5-flash-image$/);
    });

    it('still shows the saved model name when the list no longer offers it', async () => {
      // The provider was removed (or no longer qualifies) after the admin chose its model.
      mocks.getSettings.mockResolvedValue({ ...SAVED_SETTINGS, provider_id: 'p-removed' });
      await renderLoaded();

      expect(screen.getByTestId('image-model-shown')).toHaveTextContent(/^gemini-2\.5-flash-image$/);
      expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
      // Turning it off stays possible, whatever state the stored choice is in.
      expect(getSwitch()).toBeEnabled();
    });

    it('offers only the image models of providers the generation tool can talk to', async () => {
      await renderLoaded();

      const offered = Array.from(getSelect().querySelectorAll('option'))
        .map((option) => option.value)
        .filter(Boolean);
      expect(offered).toEqual([
        'p-gemini|gemini-2.5-flash-image',
        'p-gemini|gemini-3-pro-image-preview',
        'p-openai|gpt-image-1',
      ]);
    });

    it('lists the OpenAI Images models among the supported ones in the hint next to the selector', async () => {
      await renderLoaded();

      fireEvent.mouseEnter(document.querySelector('.arco-form-item-tooltip')!);

      const hint = await screen.findByRole('tooltip');
      expect(hint).toHaveTextContent('settings.imageGenSupportedTooltipOpenAI');
    });

    it('saves the chosen model through the shared setting and keeps the switch as it was', async () => {
      await renderLoaded();

      fireEvent.change(getSelect(), { target: { value: 'p-gemini|gemini-3-pro-image-preview' } });

      await waitFor(() =>
        expect(mocks.updateSettings).toHaveBeenCalledWith({
          provider_id: 'p-gemini',
          model: 'gemini-3-pro-image-preview',
          enabled: true,
        })
      );
      // The page then shows what the server answered.
      await waitFor(() => expect(getSelect()).toHaveValue('p-gemini|gemini-3-pro-image-preview'));
      expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    it('does not turn the tool on just because a model was picked', async () => {
      mocks.getSettings.mockResolvedValue(EMPTY_SETTINGS);
      await renderLoaded();

      fireEvent.change(getSelect(), { target: { value: 'p-gemini|gemini-2.5-flash-image' } });

      await waitFor(() =>
        expect(mocks.updateSettings).toHaveBeenCalledWith({
          provider_id: 'p-gemini',
          model: 'gemini-2.5-flash-image',
          enabled: false,
        })
      );
      await waitFor(() => expect(getSelect()).toHaveValue('p-gemini|gemini-2.5-flash-image'));
      expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
    });

    it('turns the tool on for everyone with the chosen model', async () => {
      mocks.getSettings.mockResolvedValue({ ...SAVED_SETTINGS, enabled: false });
      await renderLoaded();

      fireEvent.click(getSwitch());

      await waitFor(() =>
        expect(mocks.updateSettings).toHaveBeenCalledWith({
          provider_id: 'p-gemini',
          model: 'gemini-2.5-flash-image',
          enabled: true,
        })
      );
      await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'true'));
    });

    it('turns the tool off without forgetting the model', async () => {
      await renderLoaded();

      fireEvent.click(getSwitch());

      await waitFor(() =>
        expect(mocks.updateSettings).toHaveBeenCalledWith({
          provider_id: 'p-gemini',
          model: 'gemini-2.5-flash-image',
          enabled: false,
        })
      );
      await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
      expect(getSelect()).toHaveValue('p-gemini|gemini-2.5-flash-image');
    });

    it('keeps the switch disabled until a model is chosen', async () => {
      mocks.getSettings.mockResolvedValue(EMPTY_SETTINGS);
      await renderLoaded();

      expect(getSwitch()).toBeDisabled();
      fireEvent.click(getSwitch());
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      // The selector itself stays usable, otherwise there would be no way to choose one.
      expect(getSelect()).toBeEnabled();
    });

    it('no longer reads or writes the per-user preference or the built-in MCP row', async () => {
      await renderLoaded();

      fireEvent.change(getSelect(), { target: { value: 'p-gemini|gemini-3-pro-image-preview' } });
      await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getSelect()).toHaveValue('p-gemini|gemini-3-pro-image-preview'));
      fireEvent.click(getSwitch());
      await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));

      expect(mocks.getClientBusinessSetting).not.toHaveBeenCalled();
      expect(mocks.setClientBusinessSetting).not.toHaveBeenCalled();
      expect(mocks.removeClientBusinessSetting).not.toHaveBeenCalled();
      expect(mocks.updateServer).not.toHaveBeenCalled();
      expect(mocks.toggleServer).not.toHaveBeenCalled();
    });

    it('tells the admin why a save was refused and keeps showing the saved choice', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.updateSettings.mockRejectedValue(
        new BackendHttpError({
          method: 'PUT',
          path: '/api/settings/image-generation',
          status: 400,
          body: { success: false, code: 'BAD_REQUEST', error: 'Model is not available on provider p-gemini' },
        })
      );
      await renderLoaded();

      fireEvent.change(getSelect(), { target: { value: 'p-gemini|gemini-3-pro-image-preview' } });

      await waitFor(() =>
        expect(mocks.messageError).toHaveBeenCalledWith('Model is not available on provider p-gemini')
      );
      expect(getSelect()).toHaveValue('p-gemini|gemini-2.5-flash-image');
      // The controls come back, so the admin can try something else.
      await waitFor(() => expect(getSelect()).toBeEnabled());
      // A refusal can mean the server moved on (another admin, a deleted provider), so the page asks again.
      await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(2));
    });

    it('falls back to a generic message when the failure says nothing useful', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.updateSettings.mockRejectedValue(new Error('network down'));
      await renderLoaded();

      fireEvent.click(getSwitch());

      await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith('common.saveFailed'));
      expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('as a user who is not the administrator', () => {
    beforeEach(() => {
      mocks.authUser = REGULAR_USER;
    });

    it('shows the chosen model read-only and says who manages it', async () => {
      await renderLoaded();

      expect(screen.getByText('settings.sharedConfig.imageReadonly')).toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.imageAdmin')).not.toBeInTheDocument();
      expect(getSelect()).toHaveValue('p-gemini|gemini-2.5-flash-image');
      expect(getSelect()).toBeDisabled();
      expect(getSwitch()).toBeDisabled();
      expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    it('never writes the shared setting', async () => {
      await renderLoaded();

      fireEvent.click(getSwitch());
      // Even if a change event slipped past the disabled selector, nothing may be sent.
      fireEvent.change(getSelect(), { target: { value: 'p-gemini|gemini-3-pro-image-preview' } });

      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('in the desktop app', () => {
    it('keeps the full controls for the only user and drops the "applies to all users" notice', async () => {
      mocks.authUser = null;
      mocks.isDesktop = true;
      await renderLoaded();

      expect(getSelect()).toBeEnabled();
      expect(getSwitch()).toBeEnabled();
      expect(screen.queryByTestId('shared-config-notice')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.imageAdmin')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.imageReadonly')).not.toBeInTheDocument();
    });
  });

  describe('on a server without the image generation component', () => {
    beforeEach(() => {
      mocks.getSettings.mockResolvedValue({
        ...EMPTY_SETTINGS,
        provider_id: 'p-gemini',
        model: 'gemini-2.5-flash-image',
        supported: false,
      });
    });

    it('says so and keeps the switch off and disabled', async () => {
      await renderLoaded();

      expect(screen.getByText('settings.sharedConfig.imageUnsupported')).toBeInTheDocument();
      expect(getSwitch()).toBeDisabled();
      expect(getSwitch()).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(getSwitch());
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it('shows the switch off even when the stored setting still says on, since nothing can run', async () => {
      mocks.getSettings.mockResolvedValue({ ...SAVED_SETTINGS, supported: false });
      await renderLoaded();

      expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(getSwitch()).toBeDisabled();
    });

    it('does not let the admin pick a model that could not be used anyway', async () => {
      await renderLoaded();

      expect(getSelect()).toBeDisabled();
    });

    it('still says so in the desktop app, where the shared notice is hidden', async () => {
      mocks.authUser = null;
      mocks.isDesktop = true;
      await renderLoaded();

      expect(screen.getByText('settings.sharedConfig.imageUnsupported')).toBeInTheDocument();
      expect(screen.queryByTestId('shared-config-notice')).not.toBeInTheDocument();
    });

    it('does not claim anything is missing before the server has answered', async () => {
      mocks.getSettings.mockReturnValue(new Promise(() => {}));
      renderTools();

      expect(screen.queryByText('settings.sharedConfig.imageUnsupported')).not.toBeInTheDocument();
    });
  });

  describe('while the shared setting is not known', () => {
    it('keeps every control locked until it has loaded', () => {
      mocks.getSettings.mockReturnValue(new Promise(() => {}));
      renderTools();

      expect(getSwitch()).toBeDisabled();
      expect(getSelect()).toBeDisabled();
      expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
    });

    it('keeps them locked when it cannot be loaded, so nothing is saved blind', async () => {
      mocks.getSettings.mockRejectedValue(new Error('offline'));
      renderTools();

      await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
      await waitFor(() => expect(getSwitch()).not.toHaveClass('arco-switch-loading'));
      expect(getSwitch()).toBeDisabled();
      expect(getSelect()).toBeDisabled();
    });
  });
});
