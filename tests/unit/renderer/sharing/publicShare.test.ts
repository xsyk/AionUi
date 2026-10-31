import { describe, expect, it, vi, afterEach } from 'vitest';
import { getPublicShareToken } from '@/common/utils/urlValidation';
import { buildShareUrl, publicResourceUrl, readPublicShare, readPublicResource } from '@/renderer/pages/share/shareApi';

afterEach(() => vi.unstubAllGlobals());

describe('public conversation links', () => {
  it('recognizes only the dedicated public route', () => {
    expect(getPublicShareToken('#/share/abc123')).toBe('abc123');
    expect(getPublicShareToken('#/conversation/abc?next=/share/secret')).toBeNull();
    expect(getPublicShareToken('#/share/')).toBeNull();
  });
  it('keeps the same token URL when sharing is re-enabled', () => {
    expect(buildShareUrl('https://a.example', 'fixed-token')).toBe('https://a.example/#/share/fixed-token');
    expect(buildShareUrl('https://a.example/', 'fixed-token')).toBe(buildShareUrl('https://a.example', 'fixed-token'));
  });
  it('routes file paths exclusively through the token-scoped resource endpoint', () => {
    expect(publicResourceUrl('abc', '/data/file.png')).toBe(
      '/api/public/shares/current/resources?path=%2Fdata%2Ffile.png'
    );
    expect(publicResourceUrl('abc', '../secret', true)).toContain('&download=true');
  });
});

describe('anonymous share access', () => {
  it('does not send browser credentials or refresh a session on rejected links', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(readPublicShare('revoked')).rejects.toThrow('404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/shares/current',
      expect.objectContaining({ credentials: 'omit', cache: 'no-store', headers: { 'X-Share-Token': 'revoked' } })
    );
  });
  it('fetches resource bytes with the share header and keeps tokens out of resource URLs', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    await expect(readPublicResource('secret-token', '/data/photo.png', false)).resolves.toBe(blob);
    expect(fetchMock.mock.calls[0][0]).not.toContain('secret-token');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      headers: { 'X-Share-Token': 'secret-token' },
    });
  });
});
