/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';

const mocks = vi.hoisted(() => ({
  getFilesByDir: vi.fn(),
  createDir: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { systemInfo: { invoke: vi.fn().mockResolvedValue({ workDir: '/' }) } },
    fs: {
      getFilesByDir: { invoke: mocks.getFilesByDir },
      createDir: { invoke: mocks.createDir },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import { WebFsPicker } from '@/renderer/components/workspace/webFsPicker';

beforeEach(() => {
  mocks.getFilesByDir.mockReset().mockResolvedValue([]);
  mocks.createDir.mockReset();
});

afterEach(() => cleanup());

const openDirectoryPicker = () =>
  render(<WebFsPicker options={{ properties: ['openDirectory'], defaultPath: '/srv' }} onDone={vi.fn()} />);

describe('WebFsPicker responsive dialog', () => {
  it('keeps the picker inside a narrow WebUI viewport', async () => {
    render(<WebFsPicker options={{ properties: ['openDirectory'] }} onDone={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    const modal = dialog.closest<HTMLElement>('.arco-modal');

    expect(modal?.style.width).toBe('calc(100vw - 32px)');
    expect(modal?.style.maxWidth).toBe('640px');
  });
});

describe('WebFsPicker new folder', () => {
  it('creates a folder in the current directory and enters it', async () => {
    mocks.createDir.mockResolvedValueOnce({ path: '/srv/new-folder' });
    openDirectoryPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), { target: { value: ' new-folder ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mocks.createDir).toHaveBeenCalledWith({ parent: '/srv', name: 'new-folder' }));
    await waitFor(() =>
      expect(mocks.getFilesByDir).toHaveBeenLastCalledWith({ dir: '/srv/new-folder', root: '/srv/new-folder' })
    );
    expect(screen.queryByPlaceholderText('Folder name')).toBeNull();
  });

  it.each([
    [409, 'A file or folder with this name already exists'],
    [403, 'No permission to create a folder here'],
    [400, 'Invalid folder name'],
    [500, 'Could not create the folder'],
  ])('shows a readable error for HTTP %i', async (status, message) => {
    mocks.createDir.mockRejectedValueOnce(
      new BackendHttpError({ method: 'POST', path: '/api/fs/mkdir', status, body: { error: 'x' } })
    );
    openDirectoryPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    const input = screen.getByPlaceholderText('Folder name');
    fireEvent.change(input, { target: { value: 'dup' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Folder name')).toBeInTheDocument();
  });

  it('does not call the backend for a blank name', async () => {
    openDirectoryPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(mocks.createDir).not.toHaveBeenCalled();
  });

  it('Escape closes only the name field, not the picker', async () => {
    const onDone = vi.fn();
    render(<WebFsPicker options={{ properties: ['openDirectory'], defaultPath: '/srv' }} onDone={onDone} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Folder name'), { key: 'Escape', code: 'Escape', keyCode: 27 });

    expect(screen.queryByPlaceholderText('Folder name')).toBeNull();
    expect(mocks.createDir).not.toHaveBeenCalled();
    // A closing picker calls onDone 200ms after settling; give it time to.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('is not offered when picking files', async () => {
    render(<WebFsPicker options={{ properties: ['openFile'], defaultPath: '/srv' }} onDone={vi.fn()} />);

    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });
});
