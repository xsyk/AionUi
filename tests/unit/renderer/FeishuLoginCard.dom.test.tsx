/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFeishuLogin: vi.fn(),
  saveFeishuLogin: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
  BackendHttpError: class BackendHttpError extends Error {},
}));
vi.mock('@/renderer/pages/admin/adminApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/admin/adminApi')>();
  return {
    ...actual,
    adminApi: { ...actual.adminApi, getFeishuLogin: mocks.getFeishuLogin, saveFeishuLogin: mocks.saveFeishuLogin },
  };
});

import FeishuLoginCard from '@/renderer/pages/admin/FeishuLoginCard';

const config = {
  enabled: true,
  app_id: 'cli_saved',
  app_secret_set: true,
  tenant_key: null,
  public_base_url: 'https://a.example.com',
  api_base: null,
  accounts_base: null,
  callback_url: 'https://a.example.com/api/auth/feishu/callback',
  signup_policy: 'open',
};

describe('FeishuLoginCard', () => {
  beforeEach(() => {
    // Arco's static Message renders through the legacy ReactDOM.render API, absent under React 19
    vi.spyOn(Message, 'success').mockImplementation(() => () => {});
    vi.spyOn(Message, 'error').mockImplementation(() => () => {});
    // jsdom does not implement matchMedia; arco-design's responsive Grid needs it
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
  afterEach(() => vi.clearAllMocks());

  it('saves without expanding the advanced section', async () => {
    mocks.getFeishuLogin.mockResolvedValue(config);
    mocks.saveFeishuLogin.mockResolvedValue(config);
    render(<FeishuLoginCard />);
    await waitFor(() => expect((screen.getByTestId('feishu-app-id') as HTMLInputElement).value).toBe('cli_saved'));

    fireEvent.click(screen.getByTestId('feishu-save'));

    await waitFor(() => expect(mocks.saveFeishuLogin).toHaveBeenCalledTimes(1));
    const payload = mocks.saveFeishuLogin.mock.calls[0][0];
    expect(payload).toMatchObject({
      enabled: true,
      app_id: 'cli_saved',
      public_base_url: 'https://a.example.com',
      api_base: null,
      accounts_base: null,
      signup_policy: 'open',
      clear_tenant_key: false,
    });
    expect(payload).not.toHaveProperty('app_secret');
    expect(Message.error).not.toHaveBeenCalled();
  });
});
