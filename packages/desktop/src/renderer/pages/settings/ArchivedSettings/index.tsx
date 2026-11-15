/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { scopeToToken } from '@/common/adapter/sidebarMapper';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import type { AuthUser } from '@/renderer/hooks/context/AuthContext';
import { archivedWindowKey, getArchivedItems, getArchivedSources, mutateArchivedItem } from './archivedApi';
import type { ArchivedOwner, ArchivedData } from './archivedApi';
import type { SidebarGroup, SidebarItem } from '@/common/types/sidebar';
import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import { emitter } from '@/renderer/utils/emitter';
import { Button, Checkbox, Empty, Message, Modal, Spin } from '@arco-design/web-react';
import { DeleteOne, FolderClose, ListCheckbox, MessageOne, Peoples, Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import SettingsPageHeader from '../components/SettingsPageHeader';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';

const ARCHIVED_SWR_KEY = 'sidebar-archived';

/** Loaded windows belong to one owner/group, independently of other sources. */
type ArchiveWindow = { owner: ArchivedOwner; group: SidebarGroup };

type ArchiveRead = ArchivedData & {
  startedAt: number;
  pageVersions: ReadonlyMap<string, number>;
  paging: ReadonlySet<string>;
};

/** Protect an operation until a newer, complete observation proves absence. */
type ArchiveOutcome = {
  row: ArchivedRow;
  block: Pick<ProjectBlock, 'key' | 'name' | 'scopeToken'>;
  succeeded: boolean;
  settledAt: number;
};

const archivedItemKey = (owner: ArchivedOwner, item: SidebarItem): string =>
  JSON.stringify([owner.id, item.type, item.type === 'conversation' ? item.conversation.id : item.team_id]);

/** A single archived row, resolved from a {@link SidebarItem} for uniform rendering. */
type ArchivedRow = {
  /** Owner/type/id identity, unique across the grouped read model. */
  key: string;
  item_type: 'conversation' | 'team';
  item_id: string;
  owner: ArchivedOwner;
  name: string;
  icon: React.ReactElement;
  updatedAt?: number;
};

/** One archived project bucket. Ordinary chats are grouped into the synthetic no-project bucket. */
type ProjectBlock = {
  key: string;
  name: string;
  owner: ArchivedOwner;
  rows: ArchivedRow[];
  /** Backend scope token, used to page this block via `sidebar.items`. */
  scopeToken: string;
  /** True when the group has archived items beyond the loaded rows. */
  hasMore: boolean;
  /** Keyset cursor for the next page; absent iff `hasMore` is false. */
  cursor?: string;
};

/**
 * Archived management page. Reuses the grouped sidebar read model with the
 * `archived` flag (the same `SidebarResponse` shape as the active sidebar) and
 * mirrors the sidebar's layout: a **Projects** section (grouped by project /
 * pseudo-dir, each shown under its project name) and a flat **Conversations**
 * section (the `chats` group). Restoring an item unarchives it and a
 * `chat.history.refresh` puts it back in the active sidebar.
 */
const ArchivedSettings: React.FC = () => {
  const { user } = useAuth();
  return user ? (
    <ArchivedSettingsContent key={JSON.stringify([user.id, Boolean(user.is_super_admin)])} caller={user} />
  ) : null;
};

const ArchivedSettingsContent: React.FC<{ caller: AuthUser }> = ({ caller }) => {
  const { t, i18n } = useTranslation();
  const logos = useAgentLogos();
  // Read/page sequence metadata is valid only for this mounted page.
  const pageId = React.useId();
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedKeys, setSelectedKeys] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [loadingTokens, setLoadingTokens] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [refreshFailed, setRefreshFailed] = React.useState(false);
  const [view, setView] = React.useState<{
    readAt: number;
    owners: ArchivedOwner[];
    windows: ReadonlyMap<string, ArchiveWindow>;
    outcomes: ReadonlyMap<string, ArchiveOutcome>;
  }>(() => ({ readAt: 0, owners: [], windows: new Map(), outcomes: new Map() }));
  const viewRef = React.useRef(view);
  // Publish loaded windows before React commits so adjacent reads see the latest view.
  const updateView = React.useCallback((update: (prev: typeof view) => typeof view) => {
    const next = update(viewRef.current);
    viewRef.current = next;
    setView(next);
  }, []);
  // One local clock orders read starts, page requests and operation completions.
  const clock = React.useRef(0);
  const pageVersions = React.useRef(new Map<string, number>());
  const paging = React.useRef(new Set<string>());
  const readSources = React.useCallback(async (): Promise<ArchiveRead> => {
    const startedAt = ++clock.current;
    const versions = new Map(pageVersions.current);
    const pending = new Set(paging.current);
    // Count actual loaded items, never retry snapshots or unseen archive rows.
    const sizes = new Map([...viewRef.current.windows].map(([key, { group }]) => [key, group.items.length]));
    return {
      ...(await getArchivedSources(caller, sizes)),
      startedAt,
      pageVersions: versions,
      paging: pending,
    };
  }, [caller]);
  const {
    data,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR<ArchiveRead>([ARCHIVED_SWR_KEY, caller.id, Boolean(caller.is_super_admin), pageId], readSources, {
    keepPreviousData: false,
    onSuccess: () => setRefreshFailed(false),
  });

  const refresh = React.useCallback(async () => {
    try {
      await mutate(readSources, { revalidate: false });
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    }
  }, [mutate, readSources]);

  React.useEffect(() => {
    if (!data) return;
    updateView((prev) => {
      if (data.startedAt <= prev.readAt) return prev;
      const activeOwners = new Set(data.owners.map((owner) => owner.id));
      const windows = new Map([...prev.windows].filter(([, { owner }]) => activeOwners.has(owner.id)));
      const outcomes = new Map([...prev.outcomes].filter(([, { row }]) => activeOwners.has(row.owner.id)));
      // A read cannot replace a group that paged during it, or while a page was
      // pending. Other owners/groups still accept their fresh data immediately.
      const canApply = (key: string) =>
        data.pageVersions.get(key) === pageVersions.current.get(key) &&
        !data.paging.has(key) &&
        !paging.current.has(key);
      for (const { owner, sidebar } of data.sources) {
        const incoming = new Set<string>();
        let ownerApplied = true;
        for (const group of sidebar.groups) {
          const key = archivedWindowKey(owner, scopeToToken(group.scope));
          incoming.add(key);
          if (canApply(key)) windows.set(key, { owner, group });
          else ownerApplied = false;
        }
        for (const [key, window] of prev.windows) {
          if (window.owner.id !== owner.id || incoming.has(key)) continue;
          if (canApply(key) && sidebar.has_more_groups === false) windows.delete(key);
          else ownerApplied = false;
        }
        // Failed reads and partial windows cannot prove absence. Do not scan
        // extra pages to resolve an outcome; use only the normally loaded read.
        if (
          ownerApplied &&
          sidebar.has_more_groups === false &&
          sidebar.groups.every((group) => group.has_more === false)
        ) {
          const present = new Set(
            sidebar.groups.flatMap((group) => group.items.map((item) => archivedItemKey(owner, item)))
          );
          for (const [key, outcome] of outcomes) {
            if (outcome.row.owner.id === owner.id && data.startedAt > outcome.settledAt && !present.has(key))
              outcomes.delete(key);
          }
        }
      }
      return { readAt: data.startedAt, owners: data.owners, windows, outcomes };
    });
  }, [data, updateView]);

  // The active (left) sidebar is an event-driven singleton with no route/focus
  // revalidation, so it only reflects a restore once `chat.history.refresh`
  // fires. We don't fire it per action (that refetches the active list while
  // it's hidden behind the settings route); instead we mark the page dirty on
  // any *restore* — the only op that moves items back into the active list —
  // and emit a single refresh on unmount ("Back to Chat"). Deletes/clear touch
  // archived units only, so they never need to refresh the active list.
  const restoredRef = React.useRef(false);
  React.useEffect(
    () => () => {
      if (restoredRef.current) emitter.emit('chat.history.refresh');
    },
    []
  );

  const { archivedBlocks, total } = React.useMemo(() => {
    const seen = new Set<string>();

    const renderConversationIcon = (item: Extract<SidebarItem, { type: 'conversation' }>): React.ReactElement => {
      const leadingMark = resolveConversationLeadingMark(item.conversation, undefined, logos);
      if (leadingMark.kind === 'emoji') {
        return <span className='text-16px leading-none flex-shrink-0'>{leadingMark.value}</span>;
      }
      if (leadingMark.kind === 'image') {
        return (
          <img
            src={leadingMark.value}
            alt={leadingMark.label}
            className='block w-16px h-16px rounded-50% object-cover flex-shrink-0'
          />
        );
      }
      if (leadingMark.kind === 'assistant_fallback') {
        return <Robot theme='outline' size='16' className='block leading-none text-t-secondary' />;
      }
      return <MessageOne theme='outline' size='16' className='block leading-none text-t-secondary' />;
    };

    // Resolve a sidebar item to a row, deduped across groups. Returns null when
    // the item was already emitted (defensive — archived items are unpinned so a
    // double-render across groups is not expected).
    const toRow = (item: SidebarItem, owner: ArchivedOwner): ArchivedRow | null => {
      const key = archivedItemKey(owner, item);
      if (view.outcomes.get(key)?.succeeded || seen.has(key)) return null;
      seen.add(key);
      if (item.type === 'conversation') {
        return {
          key,
          item_type: 'conversation',
          item_id: item.conversation.id,
          owner,
          name: item.conversation.name || t('conversation.welcome.newConversation'),
          icon: renderConversationIcon(item),
          updatedAt: item.conversation.created_at,
        };
      }
      return {
        key,
        item_type: 'team',
        item_id: item.team_id,
        owner,
        name: item.name,
        icon: <Peoples theme='outline' size='16' className='block leading-none text-t-secondary' />,
        updatedAt: item.updated_at,
      };
    };

    const blocks: ProjectBlock[] = [];
    const activeOwners = new Map(view.owners.map((owner) => [owner.id, owner]));
    for (const [key, window] of view.windows) {
      const owner = activeOwners.get(window.owner.id);
      if (!owner) continue;
      const { group } = window;
      const rows = group.items.flatMap((item) => {
        const row = toRow(item, owner);
        return row ? [row] : [];
      });
      const hasMore = group.has_more && Boolean(group.next_cursor);
      if (rows.length === 0 && !hasMore) continue;
      const scope = group.scope;
      blocks.push({
        key,
        owner,
        name: scope.type === 'project' || scope.type === 'dir' ? scope.name : t('settings.archived.noProject'),
        rows,
        scopeToken: scopeToToken(scope),
        hasMore,
        cursor: group.next_cursor,
      });
    }
    // Retain unresolved failures without expanding the loaded paging window.
    for (const { row, block, succeeded } of view.outcomes.values()) {
      const owner = activeOwners.get(row.owner.id);
      if (!owner || succeeded || seen.has(row.key)) continue;
      seen.add(row.key);
      const retryRow = { ...row, owner };
      const existing = blocks.find((candidate) => candidate.key === block.key);
      if (existing) existing.rows.push(retryRow);
      else blocks.push({ ...block, owner, rows: [retryRow], hasMore: false });
    }
    return { archivedBlocks: blocks, total: seen.size };
  }, [view, logos, t]);

  const recordResult = React.useCallback(
    (row: ArchivedRow, succeeded: boolean) => {
      const block = archivedBlocks.find((candidate) => candidate.rows.some((item) => item.key === row.key));
      const settledAt = ++clock.current;
      updateView((prev) => {
        if (!block || !prev.owners.some((owner) => owner.id === row.owner.id)) return prev;
        if (!succeeded && prev.outcomes.get(row.key)?.succeeded) return prev;
        const outcomes = new Map(prev.outcomes);
        outcomes.set(row.key, {
          row,
          block: { key: block.key, name: block.name, scopeToken: block.scopeToken },
          succeeded,
          settledAt,
        });
        return { ...prev, outcomes };
      });
      if (succeeded)
        setSelectedKeys((prev) => {
          if (!prev.has(row.key)) return prev;
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });
    },
    [archivedBlocks, updateView]
  );

  const allRows = React.useMemo(() => archivedBlocks.flatMap((block) => block.rows), [archivedBlocks]);

  const selectedRows = React.useMemo(() => allRows.filter((row) => selectedKeys.has(row.key)), [allRows, selectedKeys]);
  const allRowsSelected = allRows.length > 0 && allRows.every((row) => selectedKeys.has(row.key));

  React.useEffect(() => {
    const availableKeys = new Set(allRows.map((row) => row.key));
    setSelectedKeys((prev) => {
      const next = new Set([...prev].filter((key) => availableKeys.has(key)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [allRows]);

  const setRowSelected = React.useCallback((row: ArchivedRow, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(row.key);
      } else {
        next.delete(row.key);
      }
      return next;
    });
  }, []);

  const toggleRowSelected = React.useCallback((row: ArchivedRow) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) {
        next.delete(row.key);
      } else {
        next.add(row.key);
      }
      return next;
    });
  }, []);

  const setBlockSelected = React.useCallback((block: ProjectBlock, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const row of block.rows) {
        if (checked) {
          next.add(row.key);
        } else {
          next.delete(row.key);
        }
      }
      return next;
    });
  }, []);

  const handleSelectAll = React.useCallback(() => {
    setSelectedKeys((prev) => {
      if (allRows.length > 0 && allRows.every((row) => prev.has(row.key))) {
        return new Set<string>();
      }
      return new Set(allRows.map((row) => row.key));
    });
  }, [allRows]);

  const handleCancelSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set<string>());
  }, []);

  const handleRestore = React.useCallback(
    async (row: ArchivedRow) => {
      try {
        await mutateArchivedItem(caller.id, row.owner, row, 'restore');
        recordResult(row, true);
        restoredRef.current = true;
        await refresh();
        Message.success(t('settings.archived.restoreSuccess'));
      } catch {
        recordResult(row, false);
        Message.error(t('settings.archived.restoreFailed'));
      }
    },
    [caller.id, recordResult, refresh, t]
  );

  const handleLoadMore = React.useCallback(
    async (block: ProjectBlock) => {
      const token = block.key;
      const window = viewRef.current.windows.get(token);
      if (
        !block.hasMore ||
        !block.cursor ||
        !window ||
        window.group.next_cursor !== block.cursor ||
        paging.current.has(token)
      )
        return;
      paging.current.add(token);
      pageVersions.current.set(token, ++clock.current);
      setLoadingTokens((prev) => new Set(prev).add(token));
      try {
        const page = await getArchivedItems(caller.id, block.owner, block.scopeToken, block.cursor);
        updateView((prev) => {
          // Inactive owners and superseded windows cannot accept a late page.
          if (prev.windows.get(token) !== window) return prev;
          const windows = new Map(prev.windows);
          windows.set(token, {
            owner: window.owner,
            group: {
              ...window.group,
              items: [...window.group.items, ...page.items],
              has_more: page.has_more,
              next_cursor: page.next_cursor,
            },
          });
          return { ...prev, windows };
        });
      } catch {
        Message.error(t('settings.archived.loadMoreFailed'));
      } finally {
        paging.current.delete(token);
        setLoadingTokens((prev) => {
          const next = new Set(prev);
          next.delete(token);
          return next;
        });
      }
    },
    [caller.id, t, updateView]
  );

  const handleDelete = React.useCallback(
    (row: ArchivedRow) => {
      Modal.confirm({
        title: t('settings.archived.deleteConfirmTitle'),
        content: t('settings.archived.deleteConfirmContent', { name: row.name }),
        okText: t('settings.archived.delete'),
        cancelText: t('common.cancel'),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          try {
            await mutateArchivedItem(caller.id, row.owner, row, 'delete');
            recordResult(row, true);
            await refresh();
            Message.success(t('settings.archived.deleteSuccess'));
          } catch {
            recordResult(row, false);
            Message.error(t('settings.archived.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [caller.id, recordResult, refresh, t]
  );

  const handleDeleteSelected = React.useCallback(() => {
    if (selectedRows.length === 0) return;

    Modal.confirm({
      title: t('settings.archived.deleteSelectedConfirmTitle'),
      content: t('settings.archived.deleteSelectedConfirmContent', { count: selectedRows.length }),
      okText: t('settings.archived.deleteSelected'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          // Each request carries its own owner. Never widen a visible selection
          // into deleting a project whose unloaded or newly archived rows differ.
          const results = await Promise.allSettled(
            selectedRows.map(async (row) => {
              try {
                await mutateArchivedItem(caller.id, row.owner, row, 'delete');
                recordResult(row, true);
              } catch (error) {
                recordResult(row, false);
                throw error;
              }
            })
          );
          const failedKeys = new Set(
            selectedRows.filter((_, index) => results[index].status === 'rejected').map((row) => row.key)
          );
          setSelectedKeys(failedKeys);
          setSelectionMode(failedKeys.size > 0);
          await refresh();
          if (failedKeys.size > 0) Message.error(t('settings.archived.deleteFailed'));
          else Message.success(t('settings.archived.deleteSelectedSuccess'));
        } catch {
          Message.error(t('settings.archived.deleteFailed'));
        }
      },
      style: { borderRadius: '12px' },
      alignCenter: true,
      getPopupContainer: () => document.body,
    });
  }, [caller.id, recordResult, refresh, selectedRows, t]);

  const formatArchivedTime = React.useCallback(
    (timestamp?: number) => {
      if (!timestamp) return '';
      return new Intl.DateTimeFormat(i18n.language || 'zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(timestamp));
    },
    [i18n.language]
  );

  const renderRow = (row: ArchivedRow, isLast: boolean) => (
    <div
      key={row.key}
      className={`group box-border flex h-56px items-center gap-10px px-14px py-6px transition-colors hover:bg-fill-2 ${
        selectionMode ? 'cursor-pointer' : ''
      } ${!isLast ? 'border-0 border-b border-solid border-[var(--color-border-2)]' : ''}`}
      onClick={() => {
        if (selectionMode) toggleRowSelected(row);
      }}
    >
      {selectionMode ? (
        <Checkbox
          checked={selectedKeys.has(row.key)}
          onClick={(event) => event.stopPropagation()}
          onChange={(checked) => setRowSelected(row, checked)}
        />
      ) : null}
      <span className='size-20px flex items-center justify-center shrink-0 line-height-0'>{row.icon}</span>
      <div className='min-w-0 flex-1'>
        <div className='overflow-hidden text-ellipsis whitespace-nowrap text-14px font-[600] text-t-primary'>
          {row.name}
        </div>
        {row.updatedAt ? (
          <div className='mt-2px overflow-hidden text-ellipsis whitespace-nowrap text-12px text-t-secondary'>
            {formatArchivedTime(row.updatedAt)}
          </div>
        ) : null}
      </div>
      {!selectionMode ? (
        <div className='shrink-0 flex items-center gap-6px'>
          <Button
            type='text'
            size='small'
            status='danger'
            icon={<DeleteOne theme='outline' size='14' />}
            onClick={() => handleDelete(row)}
          />
          <Button
            type='secondary'
            size='mini'
            className='!h-28px !rounded-8px !px-10px'
            onClick={() => void handleRestore(row)}
          >
            {t('settings.archived.restore')}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <SettingsPageWrapper>
      <SettingsPageHeader
        title={t('settings.archived.navLabel')}
        actions={
          total > 0 ? (
            <div className='flex min-w-0 items-center justify-end gap-10px'>
              {selectionMode ? (
                <div className='flex items-center gap-10px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 px-10px py-6px'>
                  <span className='px-4px text-14px text-t-secondary'>
                    {t('settings.archived.selectedCount', { count: selectedRows.length })}
                  </span>
                  <Checkbox className='!text-14px' checked={allRowsSelected} onChange={handleSelectAll}>
                    {t('settings.archived.selectAll')}
                  </Checkbox>
                  <Button
                    size='small'
                    type='secondary'
                    className='!h-32px !rounded-10px !px-12px !text-14px'
                    onClick={handleCancelSelectionMode}
                  >
                    {t('settings.archived.cancelSelect')}
                  </Button>
                  <Button
                    size='small'
                    status='warning'
                    className='!h-32px !rounded-10px !px-12px !text-14px'
                    disabled={selectedRows.length === 0}
                    onClick={handleDeleteSelected}
                  >
                    {t('settings.archived.deleteSelected')}
                  </Button>
                </div>
              ) : (
                <Button
                  size='default'
                  type='secondary'
                  icon={<ListCheckbox theme='outline' size='16' />}
                  className='!h-34px !rounded-10px !px-14px !text-14px !font-[500]'
                  onClick={() => setSelectionMode(true)}
                >
                  {t('settings.archived.multiSelect')}
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {loadError || refreshFailed || data?.hasFailures ? (
        <div role='alert' className='text-t-secondary py-12px'>
          {t('settings.archived.loadMoreFailed')}
        </div>
      ) : null}

      {isLoading ? (
        <div className='flex items-center justify-center py-64px'>
          <Spin />
        </div>
      ) : archivedBlocks.length === 0 ? (
        <div className='flex items-center justify-center py-64px'>
          <Empty description={t('settings.archived.empty')} />
        </div>
      ) : (
        <div className='mt-18px flex flex-col gap-12px'>
          <div className='flex flex-col gap-20px'>
            {archivedBlocks.map((block) => {
              const blockSelected = block.rows.length > 0 && block.rows.every((row) => selectedKeys.has(row.key));
              const blockPartiallySelected =
                block.rows.some((row) => selectedKeys.has(row.key)) &&
                !block.rows.every((row) => selectedKeys.has(row.key));
              return (
                <section key={block.key} className='flex flex-col gap-8px'>
                  <div className='flex items-center gap-8px px-2px'>
                    {selectionMode ? (
                      <Checkbox
                        checked={blockSelected}
                        indeterminate={blockPartiallySelected}
                        onChange={(checked) => setBlockSelected(block, checked)}
                      />
                    ) : null}
                    <FolderClose theme='outline' size='16' className='shrink-0 text-t-secondary' />
                    <h2 className='m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-16px font-[600] text-t-primary'>
                      {block.name}
                    </h2>
                    {caller.is_super_admin ? (
                      <span className='text-13px text-t-secondary'>{block.owner.username}</span>
                    ) : null}
                    <span className='shrink-0 text-13px text-t-secondary'>
                      {t('settings.archived.chatCount', { count: block.rows.length })}
                    </span>
                  </div>
                  <div className='overflow-hidden rd-12px border border-solid border-[var(--color-border-2)] bg-bg-1'>
                    {block.rows.map((row, index) => renderRow(row, index === block.rows.length - 1))}
                  </div>
                  {block.hasMore ? (
                    <div className='flex justify-center'>
                      <Button
                        type='text'
                        size='small'
                        loading={loadingTokens.has(block.key)}
                        onClick={() => void handleLoadMore(block)}
                      >
                        {t('settings.archived.loadMore')}
                      </Button>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </SettingsPageWrapper>
  );
};

export default ArchivedSettings;
