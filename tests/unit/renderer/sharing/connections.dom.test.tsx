import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConversationConnections from '@/renderer/pages/share/ConversationConnections';
import { ensureCsrfCookie } from '@/renderer/pages/share/shareApi';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => {
  vi.stubGlobal('electronAPI', undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: undefined });
  request.mockReset();
  document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
});
afterEach(() => vi.unstubAllGlobals());

describe('share management', () => {
  it('keeps the original URL while disabling and re-enabling access with a CSRF header', async () => {
    let enabled = true;
    document.cookie = 'aionui-csrf-token=token; Path=/';
    request.mockImplementation(async (method: string, _url: string, body?: { enabled: boolean }) => {
      if (method === 'PUT') enabled = body?.enabled ?? false;
      return { enabled, token: 'fixed-token' };
    });
    render(<ConversationConnections conversationId='mine' />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.sharing.manageTitle' }));
    const input = await screen.findByRole('textbox', { name: 'conversation.sharing.link' });
    const original = (input as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('switch'));
    await screen.findByText('conversation.sharing.disabled');
    expect((input as HTMLInputElement).value).toBe(original);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.queryByText('conversation.sharing.disabled')).toBeNull());
    expect(request).toHaveBeenLastCalledWith(
      'PUT',
      '/api/conversations/mine/share',
      { enabled: true },
      { headers: { 'x-csrf-token': 'token' } }
    );
  });
  it('shows failed owner authorization without producing a share link', async () => {
    request.mockRejectedValue(new Error('Forbidden'));
    render(<ConversationConnections conversationId='other' />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.sharing.manageTitle' }));
    await screen.findByText('conversation.sharing.requestFailed');
    expect(screen.queryByRole('textbox', { name: 'conversation.sharing.link' })).toBeNull();
  });
});

describe('management CSRF bootstrap', () => {
  it('obtains the server cookie before a new management write', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      document.cookie = 'aionui-csrf-token=fresh; Path=/';
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);
    await ensureCsrfCookie();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/feishu/status',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });
  it('fails when the bootstrap did not produce a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await expect(ensureCsrfCookie()).rejects.toThrow('CSRF token unavailable');
  });
});
