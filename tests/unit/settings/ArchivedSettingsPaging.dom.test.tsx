/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message, Modal } from '@arco-design/web-react';
import { getActAsUser, setActAsUser } from '@/common/adapter/httpBridge';
import type { AuthUser } from '@/renderer/hooks/context/AuthContext';

const authState = vi.hoisted(() => ({
  user: { id: 'self', username: 'member', is_super_admin: false } as AuthUser | null,
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => authState }));

const { getMock, itemsMock, deleteProjectMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  itemsMock: vi.fn(),
  deleteProjectMock: vi.fn(() => Promise.resolve()),
}));

// The component reads `ipcBridge` from `@/common`. Only the sidebar surface is
// exercised here; the mutation endpoints are stubbed so per-row buttons render.
vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      get: { invoke: getMock },
      items: { invoke: itemsMock },
      unarchive: { invoke: vi.fn(() => Promise.resolve()) },
      deleteArchivedItem: { invoke: vi.fn(() => Promise.resolve()) },
      deleteArchivedProject: { invoke: deleteProjectMock },
    },
  },
}));

// Keep the real `scopeToToken` — the token grammar it produces is exactly what
// the paging assertions verify. Only i18n / logos / passthrough shells are mocked.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'assistant_fallback' as const }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{actions}</div>
    </div>
  ),
}));

import ArchivedSettings from '@/renderer/pages/settings/ArchivedSettings';

type Conv = { id: string; name: string; created_at: number };

const conv = (id: string, name: string): { type: 'conversation'; conversation: Conv } => ({
  type: 'conversation',
  conversation: { id, name, created_at: 1_700_000_000_000 },
});

/** A project group with the given items / paging signals. */
const projectGroup = (
  projectId: string,
  name: string,
  items: ReturnType<typeof conv>[],
  hasMore: boolean,
  nextCursor?: string
) => ({
  scope: { type: 'project' as const, project_id: projectId, name },
  items,
  has_more: hasMore,
  next_cursor: nextCursor,
});

const renderPage = () => {
  let revalidate!: () => Promise<unknown>;
  const RevalidationControl = (): null => {
    const { mutate } = useSWRConfig();
    revalidate = () => mutate((key) => Array.isArray(key) && key[0] === 'sidebar-archived');
    return null;
  };
  const config = { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false };
  const content = () => (
    <SWRConfig value={config}>
      <RevalidationControl />
      <ArchivedSettings />
    </SWRConfig>
  );
  const view = render(content());
  return {
    ...view,
    rerenderArchive: () => view.rerender(content()),
    beginRevalidation: () => revalidate(),
    revalidate: () =>
      act(async () => {
        await revalidate();
      }),
  };
};

const admin: AuthUser = { id: 'self', username: 'admin', is_super_admin: true };
const users = [
  { ...admin, status: 'active' },
  { id: 'alice', username: 'Alice', status: 'active' },
  { id: 'bob', username: 'Bob', status: 'active' },
  { id: 'disabled', username: 'Disabled', status: 'disabled' },
];
type ArchiveFixture = { groups: ReturnType<typeof projectGroup>[]; has_more_groups: boolean };
const sources = new Map<string, ArchiveFixture>();
const source = (...groups: ReturnType<typeof projectGroup>[]): ArchiveFixture => ({ groups, has_more_groups: false });
const fetchMock = vi.fn();
const deleteMock = vi.fn();
const pageMock = vi.fn();
const restoreMock = vi.fn();
const removeFixtureItem = (owner: string, id: string) => {
  const existing = sources.get(owner);
  if (!existing) return;
  sources.set(owner, {
    ...existing,
    groups: existing.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.conversation.id !== id),
    })),
  });
};
let confirmSpy: MockInstance<typeof Modal.confirm>;
let successSpy: MockInstance<typeof Message.success>;
let errorSpy: MockInstance<typeof Message.error>;

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const requests = (method: string) =>
  fetchMock.mock.calls
    .filter(([, options]) => (options as RequestInit).method === method)
    .map(([path, options]) => ({
      path: String(path),
      headers: (options as RequestInit).headers as Record<string, string>,
    }));
const sectionFor = (name: string) => screen.getByText(name).closest('section')!;
const chooseRow = (name: string) => fireEvent.click(screen.getByText(name).closest('.group')!);
const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const confirmDeletion = async () => {
  const options = confirmSpy.mock.calls.at(-1)?.[0];
  expect(options).toBeDefined();
  await act(async () => {
    await options?.onOk?.();
  });
};

beforeEach(() => {
  authState.user = { id: 'self', username: 'member', is_super_admin: false };
  getMock.mockReset().mockImplementation(async () => sources.get(authState.user?.id ?? '') ?? source());
  itemsMock.mockReset();
  deleteProjectMock.mockClear();
  sources.clear();
  deleteMock.mockReset().mockResolvedValue(undefined);
  restoreMock.mockReset().mockResolvedValue(undefined);
  pageMock.mockReset();
  setActAsUser(null);
  document.cookie = 'aionui-csrf-token=fixture-csrf; path=/';
  confirmSpy = vi.spyOn(Modal, 'confirm').mockReturnValue({} as ReturnType<typeof Modal.confirm>);
  successSpy = vi.spyOn(Message, 'success').mockReturnValue(() => {});
  errorSpy = vi.spyOn(Message, 'error').mockReturnValue(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock.mockReset().mockImplementation(async (path: string, options: RequestInit = {}) => {
    const url = new URL(path, 'http://localhost');
    const headers = options.headers as Record<string, string>;
    const owner = headers?.['x-aionui-act-as'] ?? authState.user?.id ?? 'anonymous';
    if (url.pathname === '/api/admin/users') return response(users);
    if (url.pathname === '/api/auth/feishu/status') return response({});
    if (url.pathname === '/api/sidebar') {
      const result =
        sources.get(owner) ?? (await getMock({ archived: true, limit: Number(url.searchParams.get('limit')) }));
      return response(result);
    }
    if (url.pathname === '/api/sidebar/items') {
      const params = {
        scope: url.searchParams.get('scope'),
        cursor: url.searchParams.get('cursor'),
        limit: Number(url.searchParams.get('limit')),
        archived: true,
      };
      return response((await pageMock(owner, params)) ?? (await itemsMock(params)));
    }
    if (options.method === 'DELETE') {
      await deleteMock(owner, url.pathname, headers);
      removeFixtureItem(owner, decodeURIComponent(url.pathname.split('/').at(-1)!));
      return response(null);
    }
    if (options.method === 'POST' && url.pathname.endsWith('/unarchive')) {
      await restoreMock(owner, url.pathname, headers);
      removeFixtureItem(owner, decodeURIComponent(url.pathname.split('/').at(-2)!));
      return response(null);
    }
    throw new Error(`Unexpected fixture request: ${options.method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setActAsUser(null);
  document.cookie = 'aionui-csrf-token=; Max-Age=0; path=/';
});

describe('ArchivedSettings paging', () => {
  it('requests the first screen with an explicit page-size limit and the archived flag', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], false)],
      has_more_groups: false,
    });

    renderPage();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock).toHaveBeenCalledWith({ archived: true, limit: 5 });
    // A fully-loaded group (has_more false) shows no "load more" affordance.
    await screen.findByText('Chat One');
    expect(screen.queryByText('settings.archived.loadMore')).toBeNull();
  });

  it('renders a load-more button only for a group with more archived items', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });

    renderPage();

    await screen.findByText('Chat One');
    expect(screen.getByText('settings.archived.loadMore')).toBeTruthy();
  });

  it('pages the group via sidebar.items with the derived scope token, appends the window, and clears the button when drained', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: false, next_cursor: undefined });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    expect(itemsMock).toHaveBeenCalledWith({ scope: 'project:P1', cursor: 'cursor-1', limit: 10, archived: true });
    // Both the first-screen and appended rows are present…
    expect(screen.getByText('Chat One')).toBeTruthy();
    // …and with the group drained, the button is gone.
    await waitFor(() => expect(screen.queryByText('settings.archived.loadMore')).toBeNull());
  });

  it('keeps paging when the appended window still reports more', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: true, next_cursor: 'cursor-2' });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    // Still more to page: the next click carries the advanced cursor.
    fireEvent.click(screen.getByText('settings.archived.loadMore'));
    await waitFor(() =>
      expect(itemsMock).toHaveBeenLastCalledWith({ scope: 'project:P1', cursor: 'cursor-2', limit: 10, archived: true })
    );
  });

  it('shows a paging failure without removing already loaded rows', async () => {
    getMock.mockResolvedValue(source(projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')));
    itemsMock.mockRejectedValue(new Error('fixture page failure'));
    renderPage();
    fireEvent.click(await screen.findByText('settings.archived.loadMore'));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('settings.archived.loadMoreFailed'));
    expect(screen.getByText('Chat One')).toBeTruthy();
  });
});

describe('ArchivedSettings owner isolation', () => {
  it('does not request private archive data before authentication resolves', () => {
    authState.user = null;
    renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const seedAdmin = () => {
    authState.user = admin;
    sources.set('self', source(projectGroup('same', 'Same project', [conv('mine', 'Admin chat')], false)));
    sources.set(
      'alice',
      source(projectGroup('same', 'Same project', [conv('a1', 'Alice chat')], true, 'alice-cursor'))
    );
    sources.set('bob', source(projectGroup('same', 'Same project', [conv('b1', 'Bob chat')], true, 'bob-cursor')));
  };

  it('shows active owners separately even when project ids and names match', async () => {
    seedAdmin();
    renderPage();
    await screen.findByText('Alice chat');
    expect(screen.getAllByText('Same project')).toHaveLength(3);
    expect(within(sectionFor('Alice chat')).getByText('Alice')).toBeTruthy();
    expect(requests('GET').some(({ headers }) => headers['x-aionui-act-as'] === 'disabled')).toBe(false);
  });

  it('reports an unavailable owner without hiding other owners archives', async () => {
    seedAdmin();
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
      const headers = options.headers as Record<string, string>;
      if (new URL(path, 'http://localhost').pathname === '/api/sidebar' && headers['x-aionui-act-as'] === 'alice') {
        return Promise.resolve(response(null, 404));
      }
      return normalFetch(path, options);
    });
    renderPage();
    await screen.findByText('Bob chat');
    expect(screen.getByRole('alert').textContent).toBe('settings.archived.loadMoreFailed');
    expect(screen.getByText('Admin chat')).toBeTruthy();
  });

  it('reads ordinary users only as themselves without listing administrator users', async () => {
    sources.set('self', source(projectGroup('P1', 'Mine', [conv('mine', 'My chat')], false)));
    setActAsUser('unrelated-global-context');
    renderPage();
    await screen.findByText('My chat');
    expect(requests('GET').map(({ path }) => path)).toEqual(['/api/sidebar?limit=5&archived=true']);
    expect(requests('GET')[0].headers['x-aionui-act-as']).toBeUndefined();
    expect(getActAsUser()).toBe('unrelated-global-context');
  });

  it('pages identical project tokens under independent owners and maps their wire conversations', async () => {
    seedAdmin();
    pageMock.mockImplementation(async (owner: string) => ({
      items: [
        {
          ...conv(`${owner}-next`, `${owner} next`),
          conversation: {
            ...conv('', '').conversation,
            id: `${owner}-next`,
            name: `${owner} next`,
            model: { provider_id: 'fixture-provider', model: 'fixture-model' },
          },
        },
      ],
      has_more: false,
    }));
    renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(within(sectionFor('Alice chat')).getByText('settings.archived.loadMore'));
    await screen.findByText('alice next');
    expect(within(sectionFor('Bob chat')).queryByText('alice next')).toBeNull();
    fireEvent.click(within(sectionFor('Bob chat')).getByText('settings.archived.loadMore'));
    await screen.findByText('bob next');
    expect(pageMock.mock.calls.map(([owner, params]) => [owner, params.scope, params.cursor])).toEqual([
      ['alice', 'project:same', 'alice-cursor'],
      ['bob', 'project:same', 'bob-cursor'],
    ]);
  });

  it('deletes only selected rows across owners with CSRF and without changing global identity', async () => {
    seedAdmin();
    setActAsUser('unrelated-global-context');
    renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    chooseRow('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(deleteMock.mock.calls.map(([owner, path, headers]) => [owner, path, headers['x-csrf-token']])).toEqual([
      ['alice', '/api/sidebar/archived/conversation/a1', 'fixture-csrf'],
      ['bob', '/api/sidebar/archived/conversation/b1', 'fixture-csrf'],
    ]);
    expect(screen.getByText('Admin chat')).toBeTruthy();
    expect(getActAsUser()).toBe('unrelated-global-context');
  });

  it('does not promote a selected visible project window into deleting unloaded archive rows', async () => {
    sources.set('self', source(projectGroup('P1', 'Partial project', [conv('visible', 'Visible chat')], true, 'more')));
    renderPage();
    await screen.findByText('Visible chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    fireEvent.click(within(sectionFor('Visible chat')).getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(deleteMock.mock.calls.map(([, path]) => path)).toEqual(['/api/sidebar/archived/conversation/visible']);
  });

  it('keeps a self-owned delete free of an act-as-self header', async () => {
    seedAdmin();
    renderPage();
    await screen.findByText('Alice chat');
    const row = screen.getByText('Admin chat').closest('.group')!;
    fireEvent.click(within(row as HTMLElement).getAllByRole('button')[0]);
    await confirmDeletion();
    expect(deleteMock.mock.calls[0][0]).toBe('self');
    expect(deleteMock.mock.calls[0][2]['x-aionui-act-as']).toBeUndefined();
  });

  it('restores a foreign row using its owner and CSRF context', async () => {
    seedAdmin();
    renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(within(sectionFor('Alice chat')).getByText('settings.archived.restore'));
    await waitFor(() => expect(restoreMock).toHaveBeenCalled());
    expect(restoreMock.mock.calls[0]).toEqual([
      'alice',
      '/api/sidebar/conversation/a1/unarchive',
      expect.objectContaining({ 'x-aionui-act-as': 'alice', 'x-csrf-token': 'fixture-csrf' }),
    ]);
  });

  it('waits for every delete, refreshes partial success, and leaves failed selections retryable', async () => {
    seedAdmin();
    let finishBob!: () => void;
    deleteMock.mockImplementation(async (owner: string) => {
      if (owner === 'alice') throw new Error('fixture owner unavailable');
      if (owner === 'bob')
        await new Promise<void>((resolve) => {
          finishBob = resolve;
        });
    });
    renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    chooseRow('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    const options = confirmSpy.mock.calls.at(-1)![0];
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = Promise.resolve(options.onOk?.());
    });
    expect(errorSpy).not.toHaveBeenCalled();
    await act(async () => {
      finishBob();
      await operation;
    });
    expect(screen.queryByText('Bob chat')).toBeNull();
    expect(screen.getByText('settings.archived.selectedCount:1')).toBeTruthy();
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('settings.archived.deleteFailed');
    deleteMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.queryByText('Alice chat')).toBeNull();
  });

  it('retains a failed selection from a later page after another owner is deleted', async () => {
    seedAdmin();
    sources.set(
      'alice',
      source(
        projectGroup(
          'same',
          'Same project',
          Array.from({ length: 5 }, (_, i) => conv(`a${i}`, `Alice ${i}`)),
          true,
          'alice-more'
        )
      )
    );
    pageMock.mockImplementation(async (owner: string) => ({
      items: owner === 'alice' ? [conv('a-later', 'Alice later')] : [],
      has_more: false,
    }));
    deleteMock.mockImplementation(async (owner: string) => {
      if (owner === 'alice') throw new Error('fixture unavailable');
    });
    renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(within(sectionFor('Alice 0')).getByText('settings.archived.loadMore'));
    await screen.findByText('Alice later');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice later');
    chooseRow('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.queryByText('Bob chat')).toBeNull();
    expect(
      within(screen.getByText('Alice later').closest('.group') as HTMLElement).getByRole('checkbox')
    ).toBeChecked();
    expect(screen.getByText('settings.archived.selectedCount:1')).toBeTruthy();
  });

  it('removes a successful row while another delete is pending even if the users refresh then fails', async () => {
    seedAdmin();
    const normalFetch = fetchMock.getMockImplementation()!;
    let usersUnavailable = false;
    fetchMock.mockImplementation((path: string, options: RequestInit = {}) =>
      usersUnavailable && new URL(path, 'http://localhost').pathname === '/api/admin/users'
        ? Promise.resolve(response(null, 503))
        : normalFetch(path, options)
    );
    let failBob!: () => void;
    deleteMock.mockImplementation(async (owner: string) => {
      if (owner === 'bob')
        await new Promise<void>((_, reject) => {
          failBob = () => reject(new Error('fixture delete failure'));
        });
    });
    const view = renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    chooseRow('Bob chat');
    usersUnavailable = true;
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = Promise.resolve(confirmSpy.mock.calls.at(-1)![0].onOk?.());
    });
    const successVisibleWhilePending = Boolean(screen.queryByText('Alice chat'));
    const countWhilePending = screen.getByText(/settings.archived.selectedCount:/).textContent;
    const reportedWhilePending = errorSpy.mock.calls.length;
    await act(async () => {
      failBob();
      await operation;
    });
    expect({
      successVisibleWhilePending,
      countWhilePending,
      reportedWhilePending,
      successVisibleAfterRefresh: Boolean(screen.queryByText('Alice chat')),
    }).toEqual({
      successVisibleWhilePending: false,
      countWhilePending: 'settings.archived.selectedCount:1',
      reportedWhilePending: 0,
      successVisibleAfterRefresh: false,
    });
    await view.revalidate();
    expect(within(screen.getByText('Bob chat').closest('.group') as HTMLElement).getByRole('checkbox')).toBeChecked();
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('settings.archived.deleteFailed');
    deleteMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.queryByText('Bob chat')).toBeNull();
    expect(deleteMock.mock.calls.map(([owner]) => owner)).toEqual(['alice', 'bob', 'bob']);
  });

  it.each(['sidebar', 'page'])(
    'preserves a failed later row through a %s 503 and background revalidation',
    async (failedRead) => {
      seedAdmin();
      pageMock.mockImplementation(async (owner: string) => ({
        items: owner === 'alice' ? [conv('a-later', 'Alice later')] : [],
        has_more: false,
      }));
      const normalFetch = fetchMock.getMockImplementation()!;
      let readsUnavailable = false;
      fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
        const pathname = new URL(path, 'http://localhost').pathname;
        const headers = options.headers as Record<string, string>;
        if (
          readsUnavailable &&
          headers?.['x-aionui-act-as'] === 'alice' &&
          pathname === (failedRead === 'sidebar' ? '/api/sidebar' : '/api/sidebar/items')
        )
          return Promise.resolve(response(null, 503));
        return normalFetch(path, options);
      });
      deleteMock.mockImplementation(async (owner: string) => {
        if (owner === 'alice') throw new Error('fixture delete failure');
      });
      const view = renderPage();
      await screen.findByText('Bob chat');
      fireEvent.click(within(sectionFor('Alice chat')).getByText('settings.archived.loadMore'));
      await screen.findByText('Alice later');
      fireEvent.click(screen.getByText('settings.archived.multiSelect'));
      chooseRow('Alice later');
      chooseRow('Bob chat');
      readsUnavailable = true;
      fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
      await confirmDeletion();
      expect(screen.getByRole('alert')).toBeTruthy();
      await view.revalidate();
      expect(screen.queryByText('Bob chat')).toBeNull();
      expect(
        within(screen.getByText('Alice later').closest('.group') as HTMLElement).getByRole('checkbox')
      ).toBeChecked();
      expect(within(sectionFor('Alice later')).getByText('Alice')).toBeTruthy();
      expect(errorSpy).toHaveBeenCalledWith('settings.archived.deleteFailed');
      deleteMock.mockResolvedValue(undefined);
      fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
      await confirmDeletion();
      expect(screen.queryByText('Alice later')).toBeNull();
      expect(deleteMock.mock.calls.map(([owner, path]) => [owner, path])).toEqual([
        ['alice', '/api/sidebar/archived/conversation/a-later'],
        ['bob', '/api/sidebar/archived/conversation/b1'],
        ['alice', '/api/sidebar/archived/conversation/a-later'],
      ]);
    }
  );

  it('keeps the failed fifteenth row retryable when a new archive pushes it beyond the refreshed window', async () => {
    seedAdmin();
    let ordered = Array.from({ length: 15 }, (_, i) => conv(`a${i}`, `Alice ${i}`));
    const updateFirstWindow = () =>
      sources.set('alice', source(projectGroup('same', 'Same project', ordered.slice(0, 5), true, 'alice-5')));
    updateFirstWindow();
    pageMock.mockImplementation(async (_owner: string, params: { cursor: string }) => {
      const offset = Number(params.cursor.split('-').at(-1));
      const end = offset + 10;
      return {
        items: ordered.slice(offset, end),
        has_more: end < ordered.length,
        next_cursor: end < ordered.length ? `alice-${end}` : undefined,
      };
    });
    deleteMock.mockImplementation(async (owner: string) => {
      if (owner === 'alice') throw new Error('fixture delete failure');
      ordered = [conv('new', 'New archive'), ...ordered];
      updateFirstWindow();
    });
    const view = renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(within(sectionFor('Alice 0')).getByText('settings.archived.loadMore'));
    await screen.findByText('Alice 14');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice 14');
    chooseRow('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    await view.revalidate();
    expect(screen.getByText('New archive')).toBeTruthy();
    expect(within(screen.getByText('Alice 14').closest('.group') as HTMLElement).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('settings.archived.selectedCount:1')).toBeTruthy();
    // Preserve the known row, without scanning farther or counting its snapshot as a loaded page.
    expect(pageMock.mock.calls.filter(([owner]) => owner === 'alice')).toHaveLength(3);
    deleteMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.queryByText('Alice 14')).toBeNull();
    expect(deleteMock.mock.calls.map(([owner, path]) => [owner, path])).toEqual([
      ['alice', '/api/sidebar/archived/conversation/a14'],
      ['bob', '/api/sidebar/archived/conversation/b1'],
      ['alice', '/api/sidebar/archived/conversation/a14'],
    ]);
  });

  it.each([
    ['delete', 'users'],
    ['restore', 'users'],
    ['delete', 'sidebar'],
    ['restore', 'sidebar'],
  ] as const)(
    'keeps a successful single %s out after a %s refresh failure and stale revalidation',
    async (action, failedRead) => {
      seedAdmin();
      const staleAlice = sources.get('alice');
      const normalFetch = fetchMock.getMockImplementation()!;
      let readState: 'normal' | 'unavailable' | 'stale' = 'normal';
      fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
        const pathname = new URL(path, 'http://localhost').pathname;
        const aliceSidebar =
          pathname === '/api/sidebar' && (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice';
        if (readState === 'unavailable' && (failedRead === 'users' ? pathname === '/api/admin/users' : aliceSidebar))
          return Promise.resolve(response(null, 503));
        if (readState === 'stale' && aliceSidebar) return Promise.resolve(response(staleAlice));
        return normalFetch(path, options);
      });
      const view = renderPage();
      await screen.findByText('Alice chat');
      readState = 'unavailable';
      const row = screen.getByText('Alice chat').closest('.group') as HTMLElement;
      if (action === 'delete') {
        fireEvent.click(within(row).getAllByRole('button')[0]);
        await confirmDeletion();
      } else {
        fireEvent.click(within(row).getByText('settings.archived.restore'));
        await waitFor(() => expect(successSpy).toHaveBeenCalledWith('settings.archived.restoreSuccess'));
      }
      expect(screen.queryByText('Alice chat')).toBeNull();
      expect(successSpy).toHaveBeenCalledWith(`settings.archived.${action}Success`);
      expect(errorSpy).not.toHaveBeenCalledWith(`settings.archived.${action}Failed`);
      readState = 'stale';
      await view.revalidate();
      expect(screen.queryByText('Alice chat')).toBeNull();
      expect(screen.getByText('Bob chat')).toBeTruthy();
    }
  );

  it.each(['delete', 'restore'] as const)(
    'retains a failed single %s with its owner through unavailable background reads',
    async (action) => {
      seedAdmin();
      const mutation = action === 'delete' ? deleteMock : restoreMock;
      mutation.mockRejectedValue(new Error('fixture mutation failure'));
      const normalFetch = fetchMock.getMockImplementation()!;
      let aliceUnavailable = false;
      fetchMock.mockImplementation((path: string, options: RequestInit = {}) =>
        aliceUnavailable &&
        new URL(path, 'http://localhost').pathname === '/api/sidebar' &&
        (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice'
          ? Promise.resolve(response(null, 503))
          : normalFetch(path, options)
      );
      const view = renderPage();
      await screen.findByText('Alice chat');
      const performAction = async () => {
        const row = screen.getByText('Alice chat').closest('.group') as HTMLElement;
        if (action === 'delete') {
          fireEvent.click(within(row).getAllByRole('button')[0]);
          await confirmDeletion();
        } else {
          fireEvent.click(within(row).getByText('settings.archived.restore'));
          await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('settings.archived.restoreFailed'));
        }
      };
      await performAction();
      aliceUnavailable = true;
      await view.revalidate();
      expect(within(sectionFor('Alice chat')).getByText('Alice')).toBeTruthy();
      mutation.mockResolvedValue(undefined);
      await performAction();
      await waitFor(() => expect(screen.queryByText('Alice chat')).toBeNull());
      expect(mutation.mock.calls.map(([owner]) => owner)).toEqual(['alice', 'alice']);
    }
  );

  it('drops retained failures when the authoritative user list marks their owner inactive', async () => {
    seedAdmin();
    const normalFetch = fetchMock.getMockImplementation()!;
    let aliceUnavailable = false;
    let aliceInactive = false;
    fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
      const pathname = new URL(path, 'http://localhost').pathname;
      if (aliceInactive && pathname === '/api/admin/users')
        return Promise.resolve(
          response(users.map((user) => (user.id === 'alice' ? { ...user, status: 'disabled' } : user)))
        );
      if (
        aliceUnavailable &&
        pathname === '/api/sidebar' &&
        (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice'
      )
        return Promise.resolve(response(null, 503));
      return normalFetch(path, options);
    });
    deleteMock.mockRejectedValue(new Error('fixture delete failure'));
    const view = renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    aliceUnavailable = true;
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.getByText('settings.archived.selectedCount:1')).toBeTruthy();
    aliceInactive = true;
    fetchMock.mockClear();
    await view.revalidate();
    expect(screen.queryByText('Alice chat')).toBeNull();
    expect(screen.getByText('settings.archived.selectedCount:0')).toBeTruthy();
    expect(requests('GET').some(({ headers }) => headers['x-aionui-act-as'] === 'alice')).toBe(false);
  });

  it('drops retained failure snapshots and selection when the administrator role changes', async () => {
    seedAdmin();
    deleteMock.mockRejectedValue(new Error('fixture delete failure'));
    const view = renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    authState.user = { ...admin, is_super_admin: false };
    view.rerenderArchive();
    expect(screen.queryByText('Alice chat')).toBeNull();
    await screen.findByText('Admin chat');
    expect(screen.queryByText('settings.archived.selectedCount:1')).toBeNull();
  });

  it('shows the same owner and id when it is archived again after a complete post-restore read', async () => {
    seedAdmin();
    sources.set('alice', source(projectGroup('same', 'Same project', [conv('a1', 'Alice chat')], false)));
    const view = renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(within(sectionFor('Alice chat')).getByText('settings.archived.restore'));
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('settings.archived.restoreSuccess'));
    expect(screen.queryByText('Alice chat')).toBeNull();

    sources.set('alice', source(projectGroup('same', 'Same project', [conv('a1', 'Alice archived again')], false)));
    await view.revalidate();
    expect(within(sectionFor('Alice archived again')).getByText('Alice')).toBeTruthy();
    expect(restoreMock.mock.calls.map(([owner]) => owner)).toEqual(['alice']);
  });

  it('retires a failed delete and its selection when a complete newer read proves the committed item absent', async () => {
    seedAdmin();
    sources.set('alice', source(projectGroup('same', 'Same project', [conv('a1', 'Alice chat')], false)));
    deleteMock.mockImplementation(async (owner: string) => {
      removeFixtureItem(owner, 'a1');
      throw new Error('fixture response interrupted after commit');
    });
    renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect({
      retainedRow: Boolean(screen.queryByText('Alice chat')),
      selectedCount: screen.getByText(/settings.archived.selectedCount:/).textContent,
      failedMessage: errorSpy.mock.calls.at(-1)?.[0],
    }).toEqual({
      retainedRow: false,
      selectedCount: 'settings.archived.selectedCount:0',
      failedMessage: 'settings.archived.deleteFailed',
    });
    expect(screen.getByText('settings.archived.deleteSelected').closest('button')).toBeDisabled();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it.each(['window', 'group-list'] as const)(
    'keeps a failed row during an incomplete %s observation and retires it after a complete one',
    async (incomplete) => {
      seedAdmin();
      deleteMock.mockImplementation(async () => {
        sources.set(
          'alice',
          incomplete === 'window'
            ? source(projectGroup('same', 'Same project', [conv('other', 'Other archive')], true, 'more'))
            : { ...source(), has_more_groups: true }
        );
        throw new Error('fixture uncertain delete');
      });
      const view = renderPage();
      await screen.findByText('Alice chat');
      fireEvent.click(screen.getByText('settings.archived.multiSelect'));
      chooseRow('Alice chat');
      fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
      await confirmDeletion();
      expect(
        within(screen.getByText('Alice chat').closest('.group') as HTMLElement).getByRole('checkbox')
      ).toBeChecked();
      expect(pageMock).not.toHaveBeenCalled();

      sources.set('alice', source());
      await view.revalidate();
      expect(screen.queryByText('Alice chat')).toBeNull();
      expect(screen.getByText('settings.archived.selectedCount:0')).toBeTruthy();
    }
  );

  it.each(['page-first', 'read-first'] as const)(
    'keeps an owner page and its selection when an overlapping background read finishes %s',
    async (order) => {
      seedAdmin();
      sources.set(
        'alice',
        source(
          projectGroup(
            'same',
            'Same project',
            Array.from({ length: 5 }, (_, i) => conv(`a${i}`, `Alice ${i}`)),
            true,
            'alice-5'
          )
        )
      );
      const normalFetch = fetchMock.getMockImplementation()!;
      const read = deferred<Response>();
      let holdRead = false;
      fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
        if (
          holdRead &&
          new URL(path, 'http://localhost').pathname === '/api/sidebar' &&
          (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice'
        ) {
          holdRead = false;
          return read.promise;
        }
        return normalFetch(path, options);
      });
      const page = deferred<{ items: ReturnType<typeof conv>[]; has_more: boolean }>();
      pageMock.mockImplementation(() => page.promise);
      const view = renderPage();
      await screen.findByText('Alice 0');
      const previousWindow = sources.get('alice');
      sources.set('bob', source(projectGroup('same', 'Same project', [conv('new-bob', 'Bob changed')], false)));
      holdRead = true;
      let revalidation!: Promise<unknown>;
      await act(async () => {
        revalidation = view.beginRevalidation();
      });
      await waitFor(() => expect(holdRead).toBe(false));
      fireEvent.click(within(sectionFor('Alice 0')).getByText('settings.archived.loadMore'));
      await waitFor(() => expect(pageMock).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByText('settings.archived.multiSelect'));
      const finishPage = async () => {
        await act(async () => {
          page.resolve({
            items: Array.from({ length: 10 }, (_, i) => conv(`later-${i}`, `Alice later ${i}`)),
            has_more: false,
          });
        });
        await screen.findByText('Alice later 9');
        chooseRow('Alice later 9');
      };
      const finishRead = () =>
        act(async () => {
          read.resolve(response(previousWindow));
          await revalidation;
        });
      if (order === 'page-first') {
        await finishPage();
        await finishRead();
      } else {
        await finishRead();
        await finishPage();
      }
      expect(
        within(screen.getByText('Alice later 9').closest('.group') as HTMLElement).getByRole('checkbox')
      ).toBeChecked();
      expect(screen.getByText('Bob changed')).toBeTruthy();
      expect(pageMock.mock.calls.map(([owner, params]) => [owner, params.cursor])).toEqual([['alice', 'alice-5']]);
    }
  );

  it.each(['delete', 'restore'] as const)(
    'preserves a new page selected while a %s refresh starts before its React commit',
    async (action) => {
      seedAdmin();
      sources.set(
        'alice',
        source(
          projectGroup(
            'same',
            'Same project',
            Array.from({ length: 5 }, (_, i) => conv(`a${i}`, `Alice ${i}`)),
            true,
            'alice-5'
          )
        )
      );
      sources.set('bob', source(projectGroup('same', 'Same project', [conv('b1', 'Bob chat')], false)));
      const firstWindow = sources.get('alice');
      const nextPage = {
        items: Array.from({ length: 10 }, (_, i) => conv(`later-${i}`, `Alice later ${i}`)),
        has_more: false,
      };
      const page = deferred<typeof nextPage>();
      pageMock.mockResolvedValue(nextPage).mockImplementationOnce(() => page.promise);
      const mutation = deferred<void>();
      const mutationMock = action === 'delete' ? deleteMock : restoreMock;
      mutationMock.mockImplementation(() => mutation.promise);
      const read = deferred<Response>();
      const readStarted = deferred<void>();
      const normalFetch = fetchMock.getMockImplementation()!;
      let holdRead = false;
      fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
        if (
          holdRead &&
          new URL(path, 'http://localhost').pathname === '/api/sidebar' &&
          (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice'
        ) {
          holdRead = false;
          readStarted.resolve();
          return read.promise;
        }
        return normalFetch(path, options);
      });
      renderPage();
      await screen.findByText('Bob chat');
      fireEvent.click(within(sectionFor('Alice 0')).getByText('settings.archived.loadMore'));
      await waitFor(() => expect(pageMock).toHaveBeenCalledTimes(1));
      const bobRow = screen.getByText('Bob chat').closest('.group') as HTMLElement;
      let operation: Promise<unknown> | undefined;
      if (action === 'delete') {
        fireEvent.click(within(bobRow).getAllByRole('button')[0]);
        await act(async () => {
          operation = Promise.resolve(confirmSpy.mock.calls.at(-1)![0].onOk?.());
        });
      } else {
        fireEvent.click(within(bobRow).getByText('settings.archived.restore'));
      }
      await waitFor(() => expect(mutationMock).toHaveBeenCalledTimes(1));
      holdRead = true;
      await act(async () => {
        page.resolve(nextPage);
        // Drain the page's HTTP/JSON microtasks while act holds its queued render.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        mutation.resolve();
        await readStarted.promise;
        expect(screen.queryByText('Alice later 9')).toBeNull();
      });
      await screen.findByText('Alice later 9');
      fireEvent.click(screen.getByText('settings.archived.multiSelect'));
      chooseRow('Alice later 9');
      expect(
        within(screen.getByText('Alice later 9').closest('.group') as HTMLElement).getByRole('checkbox')
      ).toBeChecked();
      await act(async () => {
        read.resolve(response(firstWindow));
        await operation;
      });
      await waitFor(() => expect(successSpy).toHaveBeenCalledWith(`settings.archived.${action}Success`));
      const laterRow = screen.queryByText('Alice later 9')?.closest('.group');
      expect({
        loadedRows: within(sectionFor('Alice 0')).getAllByRole('checkbox').length - 1,
        laterSelected: laterRow
          ? within(laterRow as HTMLElement).getByRole<HTMLInputElement>('checkbox').checked
          : false,
        selectedCount: screen.getByText(/settings.archived.selectedCount:/).textContent,
        bobVisible: Boolean(screen.queryByText('Bob chat')),
      }).toEqual({
        loadedRows: 15,
        laterSelected: true,
        selectedCount: 'settings.archived.selectedCount:1',
        bobVisible: false,
      });
    }
  );

  it('does not use a read started before a failed result to disprove it while other deletes are pending', async () => {
    seedAdmin();
    const aliceDelete = deferred<void>();
    const bobDelete = deferred<void>();
    deleteMock.mockImplementation((owner: string) => (owner === 'alice' ? aliceDelete.promise : bobDelete.promise));
    const normalFetch = fetchMock.getMockImplementation()!;
    const read = deferred<Response>();
    let holdRead = false;
    fetchMock.mockImplementation((path: string, options: RequestInit = {}) => {
      if (
        holdRead &&
        new URL(path, 'http://localhost').pathname === '/api/sidebar' &&
        (options.headers as Record<string, string>)?.['x-aionui-act-as'] === 'alice'
      ) {
        holdRead = false;
        return read.promise;
      }
      return normalFetch(path, options);
    });
    const view = renderPage();
    await screen.findByText('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    chooseRow('Alice chat');
    chooseRow('Bob chat');
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = Promise.resolve(confirmSpy.mock.calls.at(-1)![0].onOk?.());
    });
    sources.set('alice', source());
    holdRead = true;
    let revalidation!: Promise<unknown>;
    await act(async () => {
      revalidation = view.beginRevalidation();
    });
    await waitFor(() => expect(holdRead).toBe(false));
    await act(async () => {
      aliceDelete.reject(new Error('fixture interrupted delete'));
    });
    await act(async () => {
      read.resolve(response(source()));
      await revalidation;
    });
    const retainedBeforeTerminal = Boolean(screen.queryByText('Alice chat'));
    const messagesBeforeTerminal = errorSpy.mock.calls.length + successSpy.mock.calls.length;
    await act(async () => {
      bobDelete.resolve();
      await operation;
    });
    expect({ retainedBeforeTerminal, messagesBeforeTerminal }).toEqual({
      retainedBeforeTerminal: true,
      messagesBeforeTerminal: 0,
    });
    expect(screen.queryByText('Alice chat')).toBeNull();
    expect(deleteMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the next-page entry when all five loaded rows are deleted and the users refresh fails', async () => {
    authState.user = admin;
    sources.set('self', source());
    sources.set('bob', source());
    sources.set(
      'alice',
      source(
        projectGroup(
          'same',
          'Remaining project',
          Array.from({ length: 5 }, (_, i) => conv(`a${i}`, `Alice ${i}`)),
          true,
          'alice-5'
        )
      )
    );
    const normalFetch = fetchMock.getMockImplementation()!;
    let usersUnavailable = false;
    fetchMock.mockImplementation((path: string, options: RequestInit = {}) =>
      usersUnavailable && new URL(path, 'http://localhost').pathname === '/api/admin/users'
        ? Promise.resolve(response(null, 503))
        : normalFetch(path, options)
    );
    pageMock.mockResolvedValue({ items: [conv('unselected', 'Unselected next page')], has_more: false });
    renderPage();
    await screen.findByText('Alice 0');
    fireEvent.click(screen.getByText('settings.archived.multiSelect'));
    fireEvent.click(within(sectionFor('Alice 0')).getAllByRole('checkbox')[0]);
    usersUnavailable = true;
    fireEvent.click(screen.getByText('settings.archived.deleteSelected'));
    await confirmDeletion();
    expect(screen.queryByText('settings.archived.empty')).toBeNull();
    fireEvent.click(within(sectionFor('Remaining project')).getByText('settings.archived.loadMore'));
    await screen.findByText('Unselected next page');
    expect(deleteMock.mock.calls.map(([owner, path]) => [owner, path])).toEqual(
      Array.from({ length: 5 }, (_, i) => ['alice', `/api/sidebar/archived/conversation/a${i}`])
    );
    expect(pageMock.mock.calls.map(([owner, params]) => [owner, params.cursor])).toEqual([['alice', 'alice-5']]);
  });

  it('accepts fresh reads when returning to a role whose previous page had a later local read sequence', async () => {
    seedAdmin();
    const view = renderPage();
    await screen.findByText('Alice chat');
    await view.revalidate();
    await view.revalidate();
    authState.user = { ...admin, is_super_admin: false };
    view.rerenderArchive();
    await screen.findByText('Admin chat');
    sources.set('alice', source(projectGroup('same', 'Same project', [conv('new-a', 'Alice current archive')], false)));
    authState.user = admin;
    view.rerenderArchive();
    await screen.findByText('Alice current archive');
    expect(screen.queryByText('Alice chat')).toBeNull();
  });

  it('blocks archive mutation when a CSRF cookie cannot be established', async () => {
    seedAdmin();
    document.cookie = 'aionui-csrf-token=; Max-Age=0; path=/';
    renderPage();
    await screen.findByText('Alice chat');
    fireEvent.click(within(sectionFor('Alice chat')).getAllByRole('button')[0]);
    await confirmDeletion();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('settings.archived.deleteFailed');
  });

  it('drops cached owner rows, appended pages and selections when the account or role changes', async () => {
    seedAdmin();
    const view = renderPage();
    await screen.findByText('Alice chat');
    authState.user = { id: 'new-user', username: 'New user', is_super_admin: false };
    sources.set('new-user', source(projectGroup('P2', 'New project', [conv('n1', 'New account chat')], false)));
    view.rerenderArchive();
    expect(screen.queryByText('Alice chat')).toBeNull();
    await screen.findByText('New account chat');
    authState.user = { ...authState.user, is_super_admin: true };
    view.rerenderArchive();
    await screen.findByText('Alice chat');
    authState.user = { ...authState.user, is_super_admin: false };
    view.rerenderArchive();
    expect(screen.queryByText('Alice chat')).toBeNull();
  });
});
