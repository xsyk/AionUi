import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFeishuClient,
  requestFeishuCode,
  exchangeFeishuCode,
  type FeishuSdk,
} from '@/renderer/pages/login/inAppLogin';

afterEach(() => vi.unstubAllGlobals());

describe('Feishu in-app login', () => {
  it('only activates inside the Feishu client without Electron', () => {
    expect(isFeishuClient('Mozilla Lark/7.0', false)).toBe(true);
    expect(isFeishuClient('Mozilla Chrome', false)).toBe(false);
    expect(isFeishuClient('Lark/7.0', true)).toBe(false);
  });
  it('requests only a login code without additional data permissions', async () => {
    const requestAccess = vi.fn<NonNullable<FeishuSdk['requestAccess']>>(({ success }) => success({ code: 'once' }));
    await expect(requestFeishuCode({ requestAccess }, 'cli-app', 50)).resolves.toBe('once');
    expect(requestAccess).toHaveBeenCalledWith({
      appID: 'cli-app',
      scopeList: [],
      success: expect.any(Function),
      fail: expect.any(Function),
    });
  });
  it('rejects an empty code instead of starting a token exchange', async () => {
    await expect(
      requestFeishuCode({ requestAccess: ({ success }) => success({ code: '' }) }, 'cli-app', 50)
    ).rejects.toThrow();
  });
  it('falls back only for unsupported requestAccess and supports legacy-only clients', async () => {
    const requestAuthCode = vi.fn<NonNullable<FeishuSdk['requestAuthCode']>>(({ success }) =>
      success({ code: 'legacy' })
    );
    await expect(
      requestFeishuCode({ requestAccess: ({ fail }) => fail({ errno: 103 }), requestAuthCode }, 'app', 50)
    ).resolves.toBe('legacy');
    await expect(requestFeishuCode({ requestAuthCode }, 'app', 50)).resolves.toBe('legacy');
    await expect(
      requestFeishuCode({ requestAccess: ({ fail }) => fail({ errno: 104 }), requestAuthCode }, 'app', 50)
    ).rejects.toEqual({ errno: 104 });
    expect(requestAuthCode).toHaveBeenCalledTimes(2);
  });
  it('times out a callback that never answers and permits a new request', async () => {
    await expect(requestFeishuCode({ requestAccess: () => {} }, 'app', 5)).rejects.toThrow('timed out');
    await expect(
      requestFeishuCode({ requestAccess: ({ success }) => success({ code: 'retry' }) }, 'app', 50)
    ).resolves.toBe('retry');
  });
  it('returns failed authorization without silently refreshing an unrelated session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'tenant' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeFeishuCode('code', 'csrf')).rejects.toThrow('tenant');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/feishu/in-app',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'csrf' } })
    );
  });
});
