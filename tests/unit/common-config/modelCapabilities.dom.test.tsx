/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { DeepLinkAddProviderDetail } from '@/renderer/hooks/system/useDeepLink';

type MockAuthUser = { id: string; is_super_admin?: boolean; username: string };

const ADMIN_USER: MockAuthUser = { id: 'system_default_user', is_super_admin: true, username: 'admin' };
const REGULAR_USER: MockAuthUser = { id: 'user-2', is_super_admin: false, username: 'bob' };

const mocks = vi.hoisted(() => ({
  authUser: null as MockAuthUser | null,
  close: vi.fn(),
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  editModeOpen: vi.fn(),
  isDesktop: false,
  availableModels: [
    { label: 'GPT 5.6 Sol', value: 'gpt-5.6-sol' },
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
  ],
  modelListAsArray: false,
  modelListUnavailable: false,
  mutate: vi.fn(),
  onSubmit: vi.fn(),
  pendingDeepLink: null as DeepLinkAddProviderDetail | null,
  providerMutate: vi.fn(),
  providers: [] as IProvider[],
  protocolReset: vi.fn(),
  singleModelValue: false,
  updateProvider: vi.fn(),
  viewMode: 'modal' as 'modal' | 'page',
}));

function MockSelectOption({ children, value }: { children?: React.ReactNode; value: string }) {
  return <option value={value}>{typeof children === 'string' ? children : value}</option>;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({
    visible,
    children,
    onOk,
    okText,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onOk?: () => void;
    okText?: React.ReactNode;
  }) =>
    visible ? (
      <div role='dialog'>
        {children}
        <button type='button' onClick={onOk}>
          {okText}
        </button>
      </div>
    ) : null,
}));

vi.mock('@icon-park/react', () => ({
  DeleteFour: () => <span>delete</span>,
  Heartbeat: () => <span>health</span>,
  Info: () => <span>info</span>,
  LinkCloud: () => <span aria-hidden='true'>link</span>,
  Loading: () => <span aria-hidden='true'>loading</span>,
  Minus: () => <span>remove-provider</span>,
  Plus: () => <span>add-model</span>,
  PreviewClose: () => <span aria-label='vision-disabled'>vision-disabled</span>,
  PreviewOpen: () => <span aria-hidden='true'>vision</span>,
  Refresh: () => <span aria-hidden='true'>refresh</span>,
  Search: () => <span aria-hidden='true'>search</span>,
  SettingTwo: () => <span>configure</span>,
  Write: () => <span>edit-provider</span>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      createProvider: {
        invoke: mocks.createProvider,
      },
      deleteProvider: {
        invoke: mocks.deleteProvider,
      },
      fetchModelList: {
        invoke: vi.fn(),
      },
      listProviders: {
        invoke: vi.fn(),
      },
      updateProvider: {
        invoke: mocks.updateProvider,
      },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'provider-id',
}));

vi.mock('@renderer/hooks/agent/useModeModeList', () => ({
  default: () => ({
    data: mocks.modelListUnavailable
      ? undefined
      : mocks.modelListAsArray
        ? mocks.availableModels
        : { models: mocks.availableModels },
    error: null,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: mocks.providers, mutate: mocks.providerMutate }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => mocks.viewMode,
}));

vi.mock('@/renderer/hooks/system/useDeepLink', () => ({
  consumePendingDeepLink: () => {
    const pending = mocks.pendingDeepLink;
    mocks.pendingDeepLink = null;
    return pending;
  },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));

vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => mocks.isDesktop,
}));

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: ({ label }: { label: React.ReactNode }) => <span>{label}</span>,
}));

vi.mock('@/renderer/pages/settings/components/EditModeModal', () => {
  const EditModeModal = () => null;
  EditModeModal.useModal = () => [{ close: mocks.close, open: mocks.editModeOpen }, null];
  return { default: EditModeModal };
});

vi.mock('@renderer/hooks/system/useProtocolDetection', () => ({
  default: () => ({
    isDetecting: false,
    reset: mocks.protocolReset,
    result: null,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();

  type Option = {
    disabled?: boolean;
    label?: React.ReactNode;
    value: string;
  };
  type SelectProps = {
    children?: React.ReactNode;
    mode?: 'multiple';
    onChange?: (value: string | string[]) => void;
    options?: Array<Option | string>;
    triggerProps?: { getPopupContainer?: (node: HTMLElement) => HTMLElement };
    value?: string | string[];
  };

  const MockSelect = ({ children, mode, onChange, options = [], triggerProps, value }: SelectProps) => {
    triggerProps?.getPopupContainer?.(document.createElement('span'));
    const optionValues = new Set([
      ...options.map((option) => (typeof option === 'string' ? option : option.value)),
      ...React.Children.toArray(children)
        .filter(React.isValidElement)
        .map((child) => (child as React.ReactElement<{ value?: string }>).props.value)
        .filter((item): item is string => Boolean(item)),
    ]);
    const testId =
      mode === 'multiple'
        ? 'model-select'
        : optionValues.has('supported')
          ? 'vision-select'
          : optionValues.has('chat_completions')
            ? 'api-mode-select'
            : optionValues.has('anthropic') && optionValues.has('gemini')
              ? 'protocol-select'
              : undefined;

    return (
      <select
        data-testid={testId}
        multiple={mode === 'multiple'}
        value={mode === 'multiple' ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? value : ''}
        onChange={(event) => {
          if (mode === 'multiple') {
            const selected = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
            onChange?.(mocks.singleModelValue ? (selected[0] ?? '') : selected);
            return;
          }
          onChange?.(event.currentTarget.value);
        }}
      >
        {options.map((option) => {
          const normalized = typeof option === 'string' ? { label: option, value: option } : option;
          return (
            <option key={normalized.value} value={normalized.value} disabled={normalized.disabled}>
              {typeof normalized.label === 'string' ? normalized.label : normalized.value}
            </option>
          );
        })}
        {children}
      </select>
    );
  };

  return {
    ...actual,
    Button: ({
      children,
      icon,
      onClick,
    }: {
      children?: React.ReactNode;
      icon?: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type='button' onClick={onClick}>
        {icon}
        {children}
      </button>
    ),
    Collapse: Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
      Item: ({ children, header }: { children?: React.ReactNode; header?: React.ReactNode }) => (
        <section>
          {header}
          {children}
        </section>
      ),
    }),
    Divider: () => <hr />,
    Message: {
      error: vi.fn(),
      success: vi.fn(),
      useMessage: () => [
        {
          error: vi.fn(),
          info: vi.fn(),
          success: vi.fn(),
          warning: vi.fn(),
        },
        null,
      ],
    },
    Popconfirm: ({ children, onOk }: { children: React.ReactNode; onOk?: () => void }) =>
      React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: onOk })
        : children,
    Select: Object.assign(MockSelect, { Option: MockSelectOption }),
    Switch: ({
      checked,
      disabled,
      onChange,
    }: {
      checked?: boolean;
      disabled?: boolean;
      onChange?: (checked: boolean) => void;
    }) => (
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
      >
        switch
      </button>
    ),
    Tag: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <span onClick={onClick}>{children}</span>
    ),
    Tooltip: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
      <span title={typeof content === 'string' ? content : undefined}>{children}</span>
    ),
  };
});

import { supportsOpenAiApiMode, updateModelSettings } from '@/common/utils/modelCapabilities';
import AddModelModal from '@/renderer/pages/settings/components/AddModelModal';
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
import ModelModalContent from '@/renderer/components/settings/SettingsModal/contents/ModelModalContent';

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  api_key: 'test-key',
  base_url: 'https://api.example.com/v1',
  id: 'provider-1',
  models: ['gpt-4o'],
  name: 'OpenAI compatible',
  platform: 'openai',
  ...overrides,
});

beforeEach(() => {
  // Default to the administrator in the modal view: the same controls the desktop app shows.
  mocks.authUser = ADMIN_USER;
  mocks.isDesktop = false;
  mocks.pendingDeepLink = null;
  mocks.viewMode = 'modal';
});

describe('supportsOpenAiApiMode', () => {
  it('allows OpenAI-compatible providers', () => {
    expect(supportsOpenAiApiMode('openai')).toBe(true);
    expect(supportsOpenAiApiMode('custom')).toBe(true);
  });

  it('hides the selector for non-OpenAI wire protocols', () => {
    expect(supportsOpenAiApiMode('anthropic')).toBe(false);
    expect(supportsOpenAiApiMode('new-api', 'anthropic')).toBe(false);
  });

  it('uses the selected protocol for new-api providers', () => {
    expect(supportsOpenAiApiMode('new-api', 'openai')).toBe(true);
  });
});

describe('updateModelSettings', () => {
  it('applies explicit settings to every selected model without changing other models', () => {
    const result = updateModelSettings(
      { existing: { image_input: 'unsupported' } },
      ['gpt-4o', 'gpt-5.6-sol'],
      'supported',
      'responses'
    );

    expect(result.existing).toEqual({ image_input: 'unsupported' });
    expect(result['gpt-4o']).toEqual({ image_input: 'supported', openai_api_mode: 'responses' });
    expect(result['gpt-5.6-sol']).toEqual({ image_input: 'supported', openai_api_mode: 'responses' });
  });

  it('stores unsupported when vision is explicitly disabled and the API mode is automatic', () => {
    const result = updateModelSettings(
      {
        'gpt-4o': { image_input: 'supported', openai_api_mode: 'chat_completions' },
        other: { image_input: 'supported' },
      },
      ['gpt-4o'],
      'unsupported',
      'auto'
    );

    expect(result).toEqual({
      'gpt-4o': { image_input: 'unsupported' },
      other: { image_input: 'supported' },
    });
  });

  it('keeps a newly configured model on automatic capability detection', () => {
    expect(updateModelSettings(undefined, ['gpt-4o'], 'auto', 'auto')).toEqual({});
  });

  it('stores only API mode when vision remains automatic', () => {
    expect(updateModelSettings(undefined, ['gpt-4o'], 'auto', 'responses')).toEqual({
      'gpt-4o': { openai_api_mode: 'responses' },
    });
  });

  it('removes an existing model override when both settings return to automatic', () => {
    expect(
      updateModelSettings(
        {
          'gpt-4o': { image_input: 'unsupported', openai_api_mode: 'responses' },
          other: { image_input: 'supported' },
        },
        ['gpt-4o'],
        'auto',
        'auto'
      )
    ).toEqual({ other: { image_input: 'supported' } });
  });
});

describe('model capability selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modelListAsArray = false;
    mocks.modelListUnavailable = false;
    mocks.singleModelValue = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses dropdowns and preserves explicit values while editing a model', async () => {
    render(
      <AddModelModal
        data={provider({
          model_settings: {
            'gpt-4o': { image_input: 'supported', openai_api_mode: 'responses' },
          },
        })}
        model='gpt-4o'
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('vision-select')).toHaveValue('supported');
      expect(screen.getByTestId('api-mode-select')).toHaveValue('responses');
    });

    fireEvent.change(screen.getByTestId('vision-select'), { target: { value: 'unsupported' } });
    fireEvent.change(screen.getByTestId('api-mode-select'), { target: { value: 'chat_completions' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    expect(mocks.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        model_settings: {
          'gpt-4o': { image_input: 'unsupported', openai_api_mode: 'chat_completions' },
        },
      })
    );
  });

  it('does not render an API mode dropdown for a non-OpenAI provider', async () => {
    render(
      <AddModelModal
        data={provider({ platform: 'anthropic' })}
        model='gpt-4o'
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('vision-select')).toHaveValue('auto');
    });
    expect(screen.queryByTestId('api-mode-select')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    expect(mocks.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model_settings: {} }));
  });

  it('does not submit when provider data is unavailable', () => {
    mocks.modelListUnavailable = true;
    render(
      <AddModelModal modalProps={{ visible: true }} modalCtrl={{ close: mocks.close }} onSubmit={mocks.onSubmit} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    expect(mocks.onSubmit).not.toHaveBeenCalled();
  });

  it('adds a standard provider model without protocol detection', async () => {
    mocks.modelListAsArray = true;
    render(
      <AddModelModal
        data={provider({ platform: 'anthropic' })}
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    const modelSelect = (await screen.findByTestId('model-select')) as HTMLSelectElement;
    Array.from(modelSelect.options).forEach((option) => {
      option.selected = option.value === 'gpt-5.6-sol';
    });
    fireEvent.change(modelSelect);
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    expect(mocks.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ models: ['gpt-4o', 'gpt-5.6-sol'] }));
    expect(mocks.onSubmit.mock.calls[0][0]).not.toHaveProperty('model_protocols');
  });

  it('applies detected protocol and explicit capabilities to every newly selected model', async () => {
    render(
      <AddModelModal
        data={provider({ platform: 'new-api' })}
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    const modelSelect = (await screen.findByTestId('model-select')) as HTMLSelectElement;
    Array.from(modelSelect.options).forEach((option) => {
      option.selected = option.value === 'gpt-5.6-sol' || option.value === 'claude-sonnet-4';
    });
    fireEvent.change(modelSelect);

    expect(screen.getByTestId('protocol-select')).toHaveValue('anthropic');
    expect(screen.queryByTestId('api-mode-select')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('protocol-select'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByTestId('vision-select'), { target: { value: 'supported' } });
    fireEvent.change(screen.getByTestId('api-mode-select'), { target: { value: 'responses' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    expect(mocks.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        model_protocols: {
          'claude-sonnet-4': 'openai',
          'gpt-5.6-sol': 'openai',
        },
        model_settings: {
          'claude-sonnet-4': { image_input: 'supported', openai_api_mode: 'responses' },
          'gpt-5.6-sol': { image_input: 'supported', openai_api_mode: 'responses' },
        },
        models: ['gpt-4o', 'gpt-5.6-sol', 'claude-sonnet-4'],
      })
    );
  });

  it('shows dropdowns for the new OpenAI-compatible provider form', async () => {
    render(
      <AddPlatformModal
        deepLinkData={{ api_key: 'test-key', base_url: 'https://api.example.com/v1', platform: 'OpenAI' }}
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('vision-select')).toHaveValue('auto');
      expect(screen.getByTestId('api-mode-select')).toHaveValue('auto');
    });

    fireEvent.change(screen.getByTestId('vision-select'), { target: { value: 'supported' } });
    fireEvent.change(screen.getByTestId('api-mode-select'), { target: { value: 'responses' } });
    const modelSelect = screen.getByTestId('model-select') as HTMLSelectElement;
    Array.from(modelSelect.options).forEach((option) => {
      option.selected = option.value === 'gpt-5.6-sol';
    });
    fireEvent.change(modelSelect);
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() => {
      expect(mocks.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          model_settings: {
            'gpt-5.6-sol': { image_input: 'supported', openai_api_mode: 'responses' },
          },
          models: ['gpt-5.6-sol'],
        })
      );
    });
  });

  it('keeps API mode hidden on the Gemini provider form', async () => {
    mocks.singleModelValue = true;
    render(
      <AddPlatformModal
        deepLinkData={{ api_key: 'test-key', platform: 'gemini' }}
        modalProps={{ visible: true }}
        modalCtrl={{ close: mocks.close }}
        onSubmit={mocks.onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('vision-select')).toHaveValue('auto');
    });
    expect(screen.queryByTestId('api-mode-select')).not.toBeInTheDocument();

    const modelSelect = screen.getByTestId('model-select') as HTMLSelectElement;
    Array.from(modelSelect.options).forEach((option) => {
      option.selected = option.value === 'gpt-5.6-sol';
    });
    fireEvent.change(modelSelect);
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() => {
      expect(mocks.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model_settings: {} }));
    });
  });
});

describe('configured model list', () => {
  const configuredProvider = provider({
    model_enabled: {
      'claude-direct': true,
      'gpt-auto': true,
      'gpt-chat': true,
      'gpt-responses': true,
    },
    model_health: {
      'claude-direct': { status: 'healthy' },
      'gpt-auto': { status: 'healthy' },
      'gpt-chat': { status: 'unhealthy' },
      'gpt-responses': { status: 'healthy' },
    },
    model_protocols: {
      'claude-direct': 'anthropic',
      'gpt-chat': 'openai',
      'gpt-responses': 'openai',
    },
    model_settings: {
      'claude-direct': { image_input: 'supported' },
      'gpt-chat': { image_input: 'unsupported', openai_api_mode: 'chat_completions' },
      'gpt-responses': { image_input: 'supported', openai_api_mode: 'responses' },
    },
    models: ['gpt-responses', 'gpt-chat', 'gpt-auto', 'claude-direct'],
    platform: 'new-api',
  });

  beforeEach(() => {
    mocks.providers.splice(0, mocks.providers.length, configuredProvider);
    mocks.updateProvider.mockResolvedValue(configuredProvider);
  });

  it('shows explicit and automatic Vision and API mode states', () => {
    render(<ModelModalContent />);

    expect(screen.getAllByTitle('settings.imageInputSupported')).toHaveLength(2);
    expect(screen.getByTitle('settings.imageInputUnsupported')).toBeInTheDocument();
    expect(screen.getByTitle('settings.imageInputAuto')).toBeInTheDocument();
    expect(screen.getByText('settings.openAiApiModeResponses')).toBeInTheDocument();
    expect(screen.getByText('settings.openAiApiModeChatCompletions')).toBeInTheDocument();
    expect(screen.getByText('settings.openAiApiModeAuto')).toBeInTheDocument();
  });

  it('opens the selected model in the configuration dialog', async () => {
    render(<ModelModalContent />);

    fireEvent.click(screen.getAllByRole('button', { name: 'configure' })[1]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('vision-select')).toHaveValue('unsupported');
      expect(screen.getByTestId('api-mode-select')).toHaveValue('chat_completions');
    });
  });

  it('removes all per-model state when deleting a model', async () => {
    render(<ModelModalContent />);

    fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[0]);

    await waitFor(() => {
      expect(mocks.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'provider-1',
          model_enabled: {
            'claude-direct': true,
            'gpt-auto': true,
            'gpt-chat': true,
          },
          model_health: {
            'claude-direct': { status: 'healthy' },
            'gpt-auto': { status: 'healthy' },
            'gpt-chat': { status: 'unhealthy' },
          },
          model_protocols: {
            'claude-direct': 'anthropic',
            'gpt-chat': 'openai',
          },
          model_settings: {
            'claude-direct': { image_input: 'supported' },
            'gpt-chat': { image_input: 'unsupported', openai_api_mode: 'chat_completions' },
          },
          models: ['gpt-chat', 'gpt-auto', 'claude-direct'],
        })
      );
    });
  });
});

describe('shared model configuration', () => {
  // The server returns a blank API key to non-admin users, so the fixture is keyless on purpose.
  const sharedProvider = provider({
    api_key: '',
    id: 'shared-1',
    model_protocols: { 'claude-direct': 'anthropic', 'gpt-4o': 'openai' },
    models: ['gpt-4o', 'claude-direct'],
    name: 'Shared gateway',
    platform: 'new-api',
  });
  const managementButtons = ['add-model', 'remove-provider', 'edit-provider', 'configure', 'health', 'delete'];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providers.splice(0, mocks.providers.length, sharedProvider);
    mocks.updateProvider.mockResolvedValue(sharedProvider);
  });

  it('tells administrators the models apply to everyone and keeps every management control', () => {
    mocks.providers.splice(0, mocks.providers.length, { ...sharedProvider, api_key: 'test-key' });
    render(<ModelModalContent />);

    expect(screen.getByText('settings.sharedConfig.modelsAdmin')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.modelsReadonly')).not.toBeInTheDocument();
    expect(screen.getByText('settings.addModel')).toBeInTheDocument();
    expect(screen.getByText('settings.clearStatus')).toBeInTheDocument();
    expect(screen.getByText(/settings\.apiKeyCount/)).toBeInTheDocument();
    expect(screen.getByText('2 / 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'add-model' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'remove-provider' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'edit-provider' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'configure' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'health' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'delete' })).toHaveLength(2);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    switches.forEach((toggle) => expect(toggle).toBeEnabled());
  });

  it('shows non-admin users a read-only notice and none of the management controls', () => {
    mocks.authUser = REGULAR_USER;
    render(<ModelModalContent />);

    expect(screen.getByText('settings.sharedConfig.modelsReadonly')).toBeInTheDocument();
    expect(screen.queryByText('settings.sharedConfig.modelsAdmin')).not.toBeInTheDocument();

    expect(screen.queryByText('settings.addModel')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.clearStatus')).not.toBeInTheDocument();
    managementButtons.forEach((name) => {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    });

    // The blank key would otherwise read as "API Key (0)" - the count is hidden, not shown as zero.
    expect(screen.queryByText(/settings\.apiKeyCount/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    switches.forEach((toggle) => expect(toggle).toBeDisabled());
  });

  it('still lists the shared providers and their models to non-admin users', () => {
    mocks.authUser = REGULAR_USER;
    render(<ModelModalContent />);

    expect(screen.getByText('Shared gateway')).toBeInTheDocument();
    expect(screen.getByText(/settings\.modelCount/)).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('claude-direct')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('points administrators to the configuration guide while no model is configured', () => {
    mocks.providers.splice(0, mocks.providers.length);
    render(<ModelModalContent />);

    expect(screen.getByText('settings.noConfiguredModels')).toBeInTheDocument();
    expect(screen.getByText(/settings\.needHelpConfigGuide/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'settings.configGuide' })).toBeInTheDocument();
  });

  it('keeps the configuration guide away from non-admin users, who cannot add models', () => {
    mocks.authUser = REGULAR_USER;
    mocks.providers.splice(0, mocks.providers.length);
    render(<ModelModalContent />);

    expect(screen.getByText('settings.noConfiguredModels')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'settings.configGuide' })).not.toBeInTheDocument();
    // The sentence around the link goes with it, so no dangling "Need help? Check out the detailed ." is left.
    expect(screen.queryByText(/settings\.needHelpConfigGuide/)).not.toBeInTheDocument();
    expect(screen.queryByText(/settings\.configGuideSuffix/)).not.toBeInTheDocument();
  });

  it('does not save anything when a non-admin user clicks a switch or a protocol label', () => {
    mocks.authUser = REGULAR_USER;
    render(<ModelModalContent />);

    screen.getAllByRole('switch').forEach((toggle) => fireEvent.click(toggle));
    fireEvent.click(screen.getByText('Anthropic'));

    expect(mocks.updateProvider).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.deleteProvider).not.toHaveBeenCalled();
    expect(mocks.providerMutate).not.toHaveBeenCalled();
  });

  it('lets administrators cycle a model protocol', async () => {
    render(<ModelModalContent />);

    fireEvent.click(screen.getByText('Anthropic'));

    await waitFor(() => {
      expect(mocks.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'shared-1',
          model_protocols: { 'claude-direct': 'openai', 'gpt-4o': 'openai' },
        })
      );
    });
  });

  it('keeps full control in the desktop app, which has no signed-in user', () => {
    mocks.authUser = null;
    mocks.isDesktop = true;
    render(<ModelModalContent />);

    expect(screen.getByText('settings.addModel')).toBeInTheDocument();
    expect(screen.getByText('settings.clearStatus')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'delete' })).toHaveLength(2);
    screen.getAllByRole('switch').forEach((toggle) => expect(toggle).toBeEnabled());
  });

  it('keeps the configuration guide in the desktop app while no model is configured', () => {
    mocks.authUser = null;
    mocks.isDesktop = true;
    mocks.providers.splice(0, mocks.providers.length);
    render(<ModelModalContent />);

    expect(screen.getByRole('link', { name: 'settings.configGuide' })).toBeInTheDocument();
  });

  it.each(['modal', 'page'] as const)(
    'shows no shared-configuration notice in the desktop app, which has a single user (%s view)',
    (viewMode) => {
      mocks.authUser = null;
      mocks.isDesktop = true;
      mocks.viewMode = viewMode;
      render(<ModelModalContent />);

      expect(screen.queryByTestId('shared-config-notice')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.modelsAdmin')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.sharedConfig.modelsReadonly')).not.toBeInTheDocument();
    }
  );

  it('announces the notice as a status, not as an alert', () => {
    render(<ModelModalContent />);

    expect(screen.getByTestId('shared-config-notice')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('status')).toHaveTextContent('settings.sharedConfig.modelsAdmin');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the notice under the page header and no header actions to non-admin users', () => {
    mocks.authUser = REGULAR_USER;
    mocks.viewMode = 'page';
    render(<ModelModalContent />);

    expect(screen.getByTestId('model-header')).toBeInTheDocument();
    expect(screen.getByText('settings.sharedConfig.modelsReadonly')).toBeInTheDocument();
    expect(screen.queryByText('settings.addModel')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.clearStatus')).not.toBeInTheDocument();
  });

  it('keeps the page header actions for administrators', () => {
    mocks.viewMode = 'page';
    render(<ModelModalContent />);

    expect(screen.getByTestId('model-header')).toBeInTheDocument();
    expect(screen.getByText('settings.sharedConfig.modelsAdmin')).toBeInTheDocument();
    expect(screen.getByText('settings.addModel')).toBeInTheDocument();
    expect(screen.getByText('settings.clearStatus')).toBeInTheDocument();
  });

  it('opens a pending add-provider deep link for administrators', async () => {
    mocks.pendingDeepLink = { api_key: 'sk-test', base_url: 'https://api.example.com/v1', platform: 'OpenAI' };
    render(<ModelModalContent />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('consumes a pending add-provider deep link without opening it for non-admin users', () => {
    mocks.authUser = REGULAR_USER;
    mocks.pendingDeepLink = { api_key: 'sk-test', base_url: 'https://api.example.com/v1', platform: 'OpenAI' };
    render(<ModelModalContent />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.pendingDeepLink).toBeNull();
  });
});
