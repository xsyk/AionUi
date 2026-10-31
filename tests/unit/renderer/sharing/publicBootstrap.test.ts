import { afterEach, describe, expect, it, vi } from 'vitest';
const adapter = vi.hoisted(() => vi.fn());
vi.mock('@/common/platform/bridge', () => ({ bridge: { adapter } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  adapter.mockClear();
});

describe('anonymous application bootstrap', () => {
  it('does not create a private socket or fetch private settings on the share route', async () => {
    vi.resetModules();
    const socket = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('window', { location: { hash: '#/share/public-token' } });
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('fetch', fetchMock);
    await import('@/common/adapter/browser');
    const { wsEmitter, httpRequest } = await import('@/common/adapter/httpBridge');
    const unsubscribe = wsEmitter('conversation.changed').on(() => {});
    await expect(httpRequest('GET', '/api/conversations')).rejects.toThrow('Private API access');
    unsubscribe();
    const { configService } = await import('@/common/config/configService');
    await configService.initialize();
    expect(socket).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });
  it('still rejects errors while fetching ordinary private client settings', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { hash: '#/guid' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' }));
    const { configService } = await import('@/common/config/configService');
    await expect(configService.initialize()).rejects.toThrow('401');
  });
});
