import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReadOnlyMessage from '@/renderer/pages/share/ReadOnlyMessage';
import type { TMessage } from '@/common/chat/chatLib';
import PublicSharePage from '@/renderer/pages/share';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => (params?.name ? `${key} ${params.name}` : key),
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
afterEach(() => vi.unstubAllGlobals());

describe('anonymous read-only conversation', () => {
  it('shows visible messages without exposing pending approval controls or hidden records', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        success: true,
        data: url.endsWith('/messages?limit=100')
          ? {
              items: [
                { id: 'text', type: 'text', content: { content: 'Visible answer' }, position: 'left', created_at: 1 },
                { id: 'secret', type: 'text', content: { content: 'Hidden secret' }, hidden: true, created_at: 2 },
                {
                  id: 'permission',
                  type: 'acp_permission',
                  content: { tool_call: { title: 'Run operation' }, options: [{ name: 'Approve operation' }] },
                  created_at: 3,
                },
              ],
              has_more_before: false,
            }
          : url.endsWith('/artifacts')
            ? [
                {
                  id: 'cron',
                  kind: 'cron_trigger',
                  status: 'active',
                  payload: { cron_job_name: 'Daily report' },
                  created_at: 4,
                },
                {
                  id: 'skill',
                  kind: 'skill_suggest',
                  status: 'pending',
                  payload: { name: 'Visible suggestion', description: 'Reusable workflow' },
                  created_at: 5,
                },
                {
                  id: 'dismissed',
                  kind: 'skill_suggest',
                  status: 'dismissed',
                  payload: { name: 'Hidden suggestion' },
                  created_at: 6,
                },
              ]
            : { id: 'conv', name: 'Shared conversation' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicSharePage token='public-token' />);
    await waitFor(() => expect(screen.getByText('Visible answer')).toBeTruthy());
    expect(screen.queryByText('Hidden secret')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve operation' })).toBeNull();
    expect(screen.getByText('Visible suggestion')).toBeTruthy();
    expect(screen.queryByText('Hidden suggestion')).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/public/shares/current'))).toBe(true);
  });
  it('shows an unavailable page when a previously valid link has been disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    render(<PublicSharePage token='disabled' />);
    await waitFor(() => expect(screen.getByText('conversation.sharing.unavailable')).toBeTruthy());
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('complete persisted read-only content', () => {
  it('previews a user PNG attachment through a scoped blob and leaves PDF, SVG and HTML as downloads', async () => {
    const createObjectURL = vi.fn(() => 'blob:user-attachment');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(
      <ReadOnlyMessage
        token='public-image-token'
        message={
          {
            id: 'user-image',
            type: 'text',
            position: 'right',
            content: {
              content:
                'Check attachments\n[[AION_FILES]]\n/work/photo.PNG\n/work/report.pdf\n/work/vector.svg\n/work/page.html',
            },
          } as TMessage
        }
      />
    );
    const image = await screen.findByRole('img', { name: 'photo.PNG' });
    expect(image.getAttribute('src')).toBe('blob:user-attachment');
    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'vector.svg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'page.html' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/shares/current/resources?path=%2Fwork%2Fphoto.PNG');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      headers: { 'X-Share-Token': 'public-image-token' },
    });
    unmount();
  });
  it('does not inline an image extension when the resource MIME is HTML', async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['<script>bad</script>'], { type: 'text/html' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ReadOnlyMessage
        token='public-image-token'
        message={
          {
            id: 'disguised-image',
            type: 'text',
            position: 'right',
            content: { content: 'Attachment\n[[AION_FILES]]\n/work/disguised.png' },
          } as TMessage
        }
      />
    );
    await screen.findByRole('button', { name: 'disguised.png' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'disguised.png' })).toBeNull();
  });
  it('retains ACP diff before and after text without exposing file actions or input-path downloads', () => {
    render(
      <ReadOnlyMessage
        token='public'
        message={
          {
            id: 'diff',
            type: 'acp_tool_call',
            content: {
              update: {
                tool_call_id: 'edit',
                title: 'Edit file',
                status: 'completed',
                kind: 'edit',
                rawInput: { path: '/work/private.txt' },
                content: [
                  {
                    type: 'diff',
                    path: '/work/report.ts',
                    old_text: 'const before = true;\n',
                    new_text: 'const after = true;\n',
                  },
                ],
              },
            },
          } as TMessage
        }
      />
    );
    fireEvent.click(screen.getByText('Edit file'));
    expect(screen.getByText(/const before = true;/)).toBeTruthy();
    expect(screen.getByText(/const after = true;/)).toBeTruthy();
    expect(screen.getByText('/work/report.ts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('retains cross-session source and destination labels, teammate sender and cron metadata without navigation', () => {
    const content =
      'hello\n[[AION_SESSIONS]]\nDestination\tid-2\tworkspace: same\n[[/AION_SESSIONS]]\n[[AION_SESSION_MESSAGE]]\nfrom: Source\tid-1\nworkspace: /work/other\nreply_to: id-1\n[[/AION_SESSION_MESSAGE]]';
    render(
      <>
        <ReadOnlyMessage
          token='public'
          message={{ id: 'session', type: 'text', position: 'right', content: { content } } as TMessage}
        />
        <ReadOnlyMessage
          token='public'
          message={
            {
              id: 'team',
              type: 'text',
              position: 'left',
              content: {
                content: 'teammate answer',
                teammateMessage: true,
                senderName: 'Alice',
                cronMeta: { source: 'cron', cron_job_id: 'cron', cron_job_name: 'Daily', triggered_at: 1700000000000 },
              },
            } as TMessage
          }
        />
      </>
    );
    expect(screen.getByText('@@Destination')).toBeTruthy();
    expect(screen.getByText('conversation.crossSession.fromBadge Source')).toBeTruthy();
    expect(screen.getByText('conversation.crossSession.otherWorkspace')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByTestId('shared-cron-badge')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/AION_SESSION/)).toBeNull();
  });
});
