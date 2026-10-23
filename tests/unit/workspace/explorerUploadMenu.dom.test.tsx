/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Explorer's "Upload files" context-menu item: offered exactly where
 * new-file / new-folder are (directory nodes, pe roots included), never on a
 * file leaf, listed right before "New file", and handing the clicked directory
 * to `onUpload` as the upload target.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
// WebUI runtime (no Electron shell): the item must not depend on desktop-only gating.
vi.mock('@/renderer/utils/platform', () => ({ isMacOS: () => true, isElectronDesktop: () => false }));

import type { DirRef, Entry, PeKey } from '@/renderer/pages/conversation/explorer/explorerModel';
import { peKey, refToKey } from '@/renderer/pages/conversation/explorer/explorerModel';
import type { MonitorPort } from '@/renderer/pages/conversation/explorer/explorerStore';
import {
  configureExplorerStore,
  resetExplorerStoreForTest,
} from '@/renderer/pages/conversation/explorer/explorerStore';
import type { ExplorerPanelProps } from '@/renderer/pages/conversation/explorer/ExplorerPanel';
import { ExplorerPanel } from '@/renderer/pages/conversation/explorer/ExplorerPanel';

const UPLOAD_LABEL = 'conversation.explorer.contextMenu.upload';
const NEW_FILE_LABEL = 'conversation.explorer.contextMenu.newFile';
const RENAME_LABEL = 'conversation.explorer.contextMenu.rename';

const makePort = (snapshots: Record<PeKey, Entry[]>): MonitorPort => ({
  subscribe: async (refs: DirRef[]) => ({
    snapshots: refs.map((r) => ({ target: r, entries: snapshots[refToKey(r)] ?? [] })),
  }),
  remount: async (refs: DirRef[]) => ({
    snapshots: refs.map((r) => ({ target: r, entries: snapshots[refToKey(r)] ?? [] })),
  }),
  unsubscribe: () => {},
});

const renderPanel = (props: Partial<ExplorerPanelProps>) => {
  configureExplorerStore(
    makePort({
      [peKey('pe1', '')]: [
        { name: 'docs', kind: 'dir' },
        { name: 'a.ts', kind: 'file' },
      ],
      [peKey('pe1', 'docs')]: [],
    })
  );
  render(
    <ExplorerPanel
      projectId='p1'
      roots={[{ pe_id: 'pe1', title: 'app', role: 'workspace' }]}
      onNewFile={vi.fn()}
      onRename={vi.fn()}
      {...props}
    />
  );
};

const openMenuOn = async (label: string) => {
  fireEvent.contextMenu(await screen.findByText(label));
  // Every node offers new-file or rename here, so this proves the menu is open.
  await screen.findByText(label === 'a.ts' ? RENAME_LABEL : NEW_FILE_LABEL);
};

beforeEach(() => {
  resetExplorerStoreForTest();
  localStorage.clear();
});
afterEach(() => cleanup());

describe('Explorer "Upload files" context-menu item', () => {
  it('uploads into the right-clicked directory', async () => {
    const onUpload = vi.fn();
    renderPanel({ onUpload });
    await openMenuOn('docs');
    fireEvent.click(screen.getByText(UPLOAD_LABEL));
    expect(onUpload).toHaveBeenCalledWith('pe1', 'docs');
  });

  it('uploads into the root itself (relative path "") when opened on a pe root', async () => {
    const onUpload = vi.fn();
    renderPanel({ onUpload });
    await openMenuOn('app');
    fireEvent.click(screen.getByText(UPLOAD_LABEL));
    expect(onUpload).toHaveBeenCalledWith('pe1', '');
  });

  it('is not offered on a file node', async () => {
    renderPanel({ onUpload: vi.fn() });
    await openMenuOn('a.ts');
    expect(screen.queryByText(UPLOAD_LABEL)).toBeNull();
  });

  it('is listed directly before "New file"', async () => {
    renderPanel({ onUpload: vi.fn() });
    await openMenuOn('docs');
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toEqual([UPLOAD_LABEL, NEW_FILE_LABEL, RENAME_LABEL]);
  });

  it('is hidden when no upload handler is wired', async () => {
    renderPanel({});
    await openMenuOn('docs');
    expect(screen.queryByText(UPLOAD_LABEL)).toBeNull();
  });

  it('is also offered from the WebUI row "more" (⋮) button', async () => {
    const onUpload = vi.fn();
    renderPanel({ onUpload });
    const row = (await screen.findByText('docs')).closest('.arco-tree-node') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('common.more'));
    fireEvent.click(await screen.findByText(UPLOAD_LABEL));
    expect(onUpload).toHaveBeenCalledWith('pe1', 'docs');
  });
});
