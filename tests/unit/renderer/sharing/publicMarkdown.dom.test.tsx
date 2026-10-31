import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';
import SharedResource from '@/renderer/pages/share/SharedResource';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const privateImage = vi.hoisted(() => vi.fn());
const themeModes = vi.hoisted(() => [] as boolean[]);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
}));
vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children, privateTheme }: { children: React.ReactNode; privateTheme: boolean }) => {
    themeModes.push(privateTheme);
    return <div>{children}</div>;
  },
}));
vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children: string }) => <code>{children}</code>,
}));
vi.mock('@/renderer/components/media/LocalImageView', () => ({ default: privateImage }));

describe('public markdown resources', () => {
  it('routes local and same-origin images through restricted rendering without private theme/image hooks', () => {
    const resource = vi.fn((path: string) => <span data-testid='resource'>{path}</span>);
    render(
      <MarkdownView
        renderResource={resource}
      >{`![local](/data/output.png)\n\n![private](${window.location.origin}/api/files/private)`}</MarkdownView>
    );
    expect(screen.getAllByTestId('resource')).toHaveLength(2);
    expect(privateImage).not.toHaveBeenCalled();
    expect(themeModes).not.toContain(true);
  });
  it('decodes Markdown references once and keeps spaces and balanced parentheses', () => {
    const resource = vi.fn((path: string) => <span>{path}</span>);
    render(
      <MarkdownView renderResource={resource}>
        {
          '![space](</work/my image.png>)\n\n![paren](/work/plot(1).png)\n\n![encoded](/work/my%20image.png)\n\n![literal](/work/my%2520image.png)'
        }
      </MarkdownView>
    );
    expect(resource.mock.calls.map(([path]) => path)).toEqual([
      '/work/my image.png',
      '/work/plot(1).png',
      '/work/my image.png',
      '/work/my%20image.png',
    ]);
  });
  it('routes relative files through the share renderer with exactly one URI decode', () => {
    const resource = vi.fn((path: string) => <span>{path}</span>);
    render(
      <MarkdownView renderResource={resource}>
        {
          '[report](report.pdf)\n\n[space](<reports/my report.pdf>)\n\n[paren](./plot(1).pdf)\n\n[encoded](reports/my%20report.pdf)\n\n[literal](reports/my%2520report.pdf)'
        }
      </MarkdownView>
    );
    expect(resource.mock.calls.map(([path]) => path)).toEqual([
      'report.pdf',
      'reports/my report.pdf',
      './plot(1).pdf',
      'reports/my report.pdf',
      'reports/my%20report.pdf',
    ]);
  });
  it('downloads a relative attachment using bearer-header fetch and a blob URL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createObjectURL = vi.fn(() => 'blob:shared-report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['report'], { type: 'application/pdf' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MarkdownView
        renderResource={(path, label, kind) => (
          <SharedResource token='share-secret' path={path} label={label} kind={kind} />
        )}
      >
        {'[download report](reports/my%2520report.pdf)'}
      </MarkdownView>
    );
    fireEvent.click(screen.getByRole('button', { name: 'download report' }));
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce());
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url, window.location.origin).searchParams.get('path')).toBe('reports/my%20report.pdf');
    expect(url).not.toContain('share-secret');
    expect(options).toMatchObject({ credentials: 'omit', headers: { 'X-Share-Token': 'share-secret' } });
    expect(downloadClick.mock.instances[0].getAttribute('href')).toBe('blob:shared-report');
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:shared-report');
  });
  it('keeps external URLs, fragments, query-only links and unsafe schemes outside the resource renderer', () => {
    const resource = vi.fn(() => null);
    render(
      <MarkdownView renderResource={resource}>
        {
          '[web](https://example.com/report.pdf)\n\n[host](//example.com/report.pdf)\n\n[section](#section)\n\n[query](?page=2)\n\n[mail](mailto:team@example.com)\n\n[bad](javascript:alert%281%29)\n\n[encoded-bad](javascript%3Aalert%281%29)'
        }
      </MarkdownView>
    );
    expect(resource).not.toHaveBeenCalled();
    expect(screen.getByText('web').closest('a')?.getAttribute('href')).toBe('https://example.com/report.pdf');
    expect(screen.getByText('section').closest('a')?.getAttribute('href')).toBe('#section');
  });
  it('keeps relative links in the ordinary private Markdown renderer unchanged', () => {
    render(<MarkdownView>{'[private report](report.pdf)'}</MarkdownView>);
    expect(screen.getByText('private report').closest('a')?.getAttribute('href')).toBe('report.pdf');
  });
  it('decodes file URL links only once', () => {
    const resource = vi.fn((path: string) => <span>{path}</span>);
    render(<MarkdownView renderResource={resource}>{'[literal](file:///work/my%2520image.png)'}</MarkdownView>);
    expect(resource.mock.calls.map(([path]) => path)).toEqual(['/work/my%20image.png']);
  });
  it('does not turn dangerous markdown protocols into a usable link', () => {
    render(<MarkdownView renderResource={() => null}>{'[bad](javascript:alert%281%29)'}</MarkdownView>);
    const anchor = screen.getByText('bad').closest('a');
    expect(anchor?.getAttribute('href')).not.toContain('javascript:');
  });
});
