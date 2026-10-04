/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import FeishuLoginButton from '@/renderer/pages/login/FeishuLoginButton';

function stubStatus(enabled: boolean) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { enabled, public_base_url: enabled ? 'https://a.example.com' : null } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('FeishuLoginButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders when Feishu login is enabled', async () => {
    stubStatus(true);
    render(<FeishuLoginButton />);
    await waitFor(() => expect(screen.getByTestId('feishu-login-button')).toBeTruthy());
    expect(screen.getByText('login.feishu.button')).toBeTruthy();
  });

  it('renders nothing when disabled', async () => {
    const fetchMock = stubStatus(false);
    const { container } = render(<FeishuLoginButton />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });
});
