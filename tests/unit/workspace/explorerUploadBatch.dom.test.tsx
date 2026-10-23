/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ExplorerContainer's "Upload files" batch: the context-menu action opens the
 * hidden multi-select picker for the clicked folder, the picked files go up one
 * at a time (oversized ones are skipped up front), a single in-place toast
 * tracks progress (with a cancel button) and ends as one summary, and a batch
 * with any success reveals the folder — if the tree still shows it. The HTTP
 * helper itself is mocked (its contract has its own suite).
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import type { ProjectDetailDto } from '@/common/types/project';
import type { ProjectUploadFailure, ProjectUploadResult } from '@/renderer/services/FileService';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  projectGet: vi.fn(),
}));

// `t` echoes the key plus its params (sorted, so assertions do not depend on the
// order the code builds them in) — enough to assert the exact summary rendered.
const t = (key: string, params?: Record<string, unknown>): string =>
  params
    ? `${key}{${Object.keys(params)
        .toSorted()
        .map((name) => `${name}=${String(params[name])}`)
        .join(',')}}`
    : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en-US' } }) }));

vi.mock('@/renderer/services/FileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/services/FileService')>()),
  uploadFileToProject: (...args: unknown[]) => mocks.upload(...args),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ openPreview: vi.fn() }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('@/renderer/pages/conversation/explorer/currentConversationStore', () => ({
  useCurrentConversation: () => null,
}));
vi.mock('@/renderer/pages/conversation/SourceControl/ScmPanel', () => ({
  ScmPanel: () => <div data-testid='scm-panel-stub' />,
}));
vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspaceOpenButton', () => ({ default: () => null }));
vi.mock('@/common', () => ({
  ipcBridge: { project: { get: { invoke: (p: unknown) => mocks.projectGet(p) } } },
}));

// The tree is mocked so the suite exercises only the container's upload wiring:
// the buttons stand in for the "Upload files" menu item on a folder / a pe root.
vi.mock('@/renderer/pages/conversation/explorer/ExplorerPanel', () => ({
  ExplorerPanel: ({ onUpload }: { onUpload?: (peId: string, dirRel: string) => void }) => (
    <div>
      <span data-testid='upload-enabled'>{onUpload ? 'yes' : 'no'}</span>
      <button data-testid='do-upload' onClick={() => onUpload?.('peA', 'docs')}>
        upload
      </button>
      <button data-testid='do-upload-root' onClick={() => onUpload?.('peA', '')}>
        upload-root
      </button>
    </div>
  ),
}));

import { ExplorerContainer } from '@/renderer/pages/conversation/explorer/ExplorerContainer';
import * as explorerStore from '@/renderer/pages/conversation/explorer/explorerStore';
import { openProject, resetExplorerStoreForTest } from '@/renderer/pages/conversation/explorer/explorerStore';
import { PROJECT_UPLOAD_MAX_BYTES, ProjectUploadError, UPLOAD_ABORTED_ERROR } from '@/renderer/services/FileService';

const detail: ProjectDetailDto = {
  project_id: 'p1',
  name: 'Proj',
  explorer: {
    workspace_pe_id: 'peA',
    entries: [
      {
        pe_id: 'peA',
        role: 'workspace',
        display_name: 'Root',
        display_path: '/x',
        order_index: 0,
        runtime_status: 'available',
      },
    ],
  },
};

const tree = (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ExplorerContainer projectId='p1' />
  </SWRConfig>
);
const renderIt = () => render(tree);

const pickedFile = (name: string) => new File(['x'], name, { type: 'text/plain' });
const oversizedFile = (name: string) => {
  const file = pickedFile(name);
  Object.defineProperty(file, 'size', { value: PROJECT_UPLOAD_MAX_BYTES + 1 });
  return file;
};
const stored = (name: string, renamed = false): ProjectUploadResult => ({
  name,
  relative_path: `docs/${name}`,
  size: 1,
  renamed,
});
const failure = (reason: ProjectUploadFailure, status = 0) =>
  new ProjectUploadError(reason, `failed: ${reason}`, status);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const uploadInput = () => screen.getByTestId('explorer-upload-input') as HTMLInputElement;

/** Click the menu action for `button`'s folder, then "choose" `files` in the picker. */
const pickFiles = async (files: File[], button = 'do-upload') => {
  fireEvent.click(await screen.findByTestId(button));
  fireEvent.change(uploadInput(), { target: { files } });
};

type MessageArg = string | { id?: string; content?: unknown; duration?: number };
const argsOf = (spy: unknown): MessageArg[] => (spy as MockInstance).mock.calls.map((call) => call[0] as MessageArg);
const contentsOf = (spy: unknown): unknown[] => argsOf(spy).map((arg) => (typeof arg === 'string' ? arg : arg.content));
const idsOf = (spy: unknown): unknown[] => argsOf(spy).map((arg) => (typeof arg === 'string' ? undefined : arg.id));

/** Render the latest progress toast's content (text + cancel button) on its own. */
const latestProgressToast = (): HTMLElement =>
  render(<>{contentsOf(Message.loading).at(-1) as React.ReactNode}</>, {
    container: document.body.appendChild(document.createElement('div')),
  }).container;

/** Resolves once the batch has shown its summary (whatever its tone). */
const batchFinished = () =>
  waitFor(() =>
    expect(
      argsOf(Message.success).length +
        argsOf(Message.warning).length +
        argsOf(Message.error).length +
        argsOf(Message.info).filter((arg) => typeof arg !== 'string').length
    ).toBe(1)
  );

/** `uploadFailedItem` as the mocked `t` renders it. */
const failedItem = (name: string, reason: string) =>
  `conversation.explorer.uploadFailedItem{name=${name},reason=conversation.explorer.uploadReason.${reason}}`;

let pickerClick: MockInstance;
let revealSpy: MockInstance;

beforeEach(() => {
  resetExplorerStoreForTest();
  localStorage.clear();
  // The real tree opens its project in the store; the reveal guard reads that.
  openProject('p1', [{ pe_id: 'peA', title: 'Root', role: 'workspace' }]);
  mocks.projectGet.mockReset().mockResolvedValue(detail);
  mocks.upload.mockReset();
  // jsdom has no native file chooser; record the click that would open it.
  pickerClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  revealSpy = vi.spyOn(explorerStore, 'reveal').mockImplementation(() => {});
  for (const tone of ['loading', 'success', 'warning', 'error', 'info'] as const) {
    vi.spyOn(Message, tone).mockImplementation(() => (() => {}) as never);
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ExplorerContainer upload: picking files', () => {
  it('wires the upload action into the tree', async () => {
    renderIt();
    expect(await screen.findByTestId('upload-enabled')).toHaveTextContent('yes');
  });

  it('opens the hidden multi-select file picker from the menu action', async () => {
    renderIt();
    fireEvent.click(await screen.findByTestId('do-upload'));
    expect(pickerClick).toHaveBeenCalledTimes(1);
    expect(pickerClick.mock.contexts[0]).toBe(uploadInput());
    expect(uploadInput()).toHaveAttribute('multiple');
  });

  it('uploads into the folder the menu was opened on', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    const file = pickedFile('a.txt');
    renderIt();
    await pickFiles([file]);
    await batchFinished();
    expect(mocks.upload).toHaveBeenCalledWith(
      file,
      { pe_id: 'peA', relative_path: 'docs' },
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('uploads into the root itself when the menu was opened on a pe root', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    renderIt();
    await pickFiles([pickedFile('a.txt')], 'do-upload-root');
    await batchFinished();
    expect(mocks.upload.mock.calls[0][1]).toEqual({ pe_id: 'peA', relative_path: '' });
  });

  it('clears the picker after reading it so the same files can be picked again', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    renderIt();
    fireEvent.click(await screen.findByTestId('do-upload'));
    const setValue = vi.fn();
    Object.defineProperty(uploadInput(), 'value', { configurable: true, get: () => '', set: setValue });
    fireEvent.change(uploadInput(), { target: { files: [pickedFile('a.txt')] } });
    expect(setValue).toHaveBeenCalledWith('');
    await batchFinished();
  });

  it('does nothing when the picker reports no files', async () => {
    renderIt();
    await pickFiles([]);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(Message.loading).not.toHaveBeenCalled();
  });
});

describe('ExplorerContainer upload: running the batch', () => {
  it('uploads the picked files one at a time, starting the next only after the previous settles', async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise).mockResolvedValueOnce(stored('b.txt'));
    const [a, b] = [pickedFile('a.txt'), pickedFile('b.txt')];
    renderIt();
    await pickFiles([a, b]);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    first.resolve(stored('a.txt'));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    expect(mocks.upload.mock.calls.map((call) => call[0])).toEqual([a, b]);
  });

  it('skips a file over 100 MB without sending it', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    const small = pickedFile('a.txt');
    renderIt();
    await pickFiles([oversizedFile('big.bin'), small]);
    await batchFinished();
    expect(mocks.upload.mock.calls.map((call) => call[0])).toEqual([small]);
  });

  it('shows a single "uploading n/m" toast that stays up (duration 0) while the batch runs', async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise).mockResolvedValueOnce(stored('b.txt'));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await waitFor(() => expect(Message.loading).toHaveBeenCalled());
    expect(argsOf(Message.loading)[0]).toMatchObject({ id: expect.any(String), duration: 0 });
    expect(latestProgressToast().textContent).toContain('conversation.explorer.uploading{current=1,percent=0,total=2}');
    first.resolve(stored('a.txt'));
    await batchFinished();
  });

  it("updates that same toast with the current file's progress", async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise);
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    const onProgress = mocks.upload.mock.calls[0][2] as (percent: number) => void;
    onProgress(42);
    expect(latestProgressToast().textContent).toContain(
      'conversation.explorer.uploading{current=1,percent=42,total=1}'
    );
    expect(new Set(idsOf(Message.loading)).size).toBe(1);
    first.resolve(stored('a.txt'));
    await batchFinished();
  });

  it('refuses to start a second batch while one is running', async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise);
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    fireEvent.click(screen.getByTestId('do-upload'));
    expect(Message.info).toHaveBeenCalledWith('conversation.explorer.uploadBusy');
    expect(pickerClick).toHaveBeenCalledTimes(1); // only the first batch opened the picker
    first.resolve(stored('a.txt'));
    await batchFinished();
  });

  it('shares that guard between two mounted explorers (one toast, one batch app-wide)', async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise);
    render(
      <>
        {tree}
        {tree}
      </>
    );
    const [uploadInFirst, uploadInSecond] = await screen.findAllByTestId('do-upload');
    fireEvent.click(uploadInFirst);
    fireEvent.change(screen.getAllByTestId('explorer-upload-input')[0], { target: { files: [pickedFile('a.txt')] } });
    fireEvent.click(uploadInSecond);
    expect(Message.info).toHaveBeenCalledWith('conversation.explorer.uploadBusy');
    expect(pickerClick).toHaveBeenCalledTimes(1);
    first.resolve(stored('a.txt'));
    await batchFinished();
  });

  it('accepts a new batch once the previous one has finished', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await batchFinished();
    fireEvent.click(screen.getByTestId('do-upload'));
    expect(Message.info).not.toHaveBeenCalled();
    expect(pickerClick).toHaveBeenCalledTimes(2);
  });

  it('still releases the batch and replaces the toast when the loop breaks off unexpectedly', async () => {
    vi.mocked(Message.loading).mockImplementationOnce(() => {
      throw new Error('toast broke');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await batchFinished();
    expect(contentsOf(Message.error)).toEqual([
      `conversation.explorer.uploadFailed{names=${failedItem('a.txt', 'server')}}`,
    ]);
    fireEvent.click(screen.getByTestId('do-upload'));
    expect(pickerClick).toHaveBeenCalledTimes(2); // not refused as busy
  });
});

describe('ExplorerContainer upload: cancel', () => {
  /** An upload that only ends when its signal is aborted, like a real in-flight XHR. */
  const uploadUntilAborted = (
    _file: File,
    _target: unknown,
    _onProgress: unknown,
    options?: { signal?: AbortSignal }
  ) =>
    new Promise<ProjectUploadResult>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new ProjectUploadError('aborted', UPLOAD_ABORTED_ERROR)));
    });

  const startAndCancel = async () => {
    mocks.upload.mockImplementation(uploadUntilAborted);
    renderIt();
    await pickFiles(['a.txt', 'b.txt', 'c.txt'].map(pickedFile));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    fireEvent.click(within(latestProgressToast()).getByRole('button', { name: 'common.cancel' }));
    await batchFinished();
  };

  it('aborts the file in flight from the progress toast and never sends the rest', async () => {
    await startAndCancel();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect((mocks.upload.mock.calls[0][3] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });

  it('sums up a cancelled batch as how far it got', async () => {
    await startAndCancel();
    expect(contentsOf(Message.info)).toContain('conversation.explorer.uploadCancelled{skipped=3,uploaded=0}');
  });
});

describe('ExplorerContainer upload: summary', () => {
  it('reports the uploaded count when every file went up', async () => {
    mocks.upload.mockResolvedValueOnce(stored('a.txt')).mockResolvedValueOnce(stored('b.txt'));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(contentsOf(Message.success)).toEqual(['conversation.explorer.uploaded{count=2}']);
  });

  it('says how many files were auto-renamed because of a name conflict', async () => {
    mocks.upload.mockResolvedValueOnce(stored('a copy.txt', true)).mockResolvedValueOnce(stored('b.txt'));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(contentsOf(Message.success)).toEqual(['conversation.explorer.uploadedRenamed{count=2,renamed=1}']);
  });

  it('warns with both counts and each failed name with its reason when some files failed', async () => {
    mocks.upload.mockResolvedValueOnce(stored('a.txt')).mockRejectedValueOnce(failure('badRequest', 400));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(contentsOf(Message.warning)).toEqual([
      `conversation.explorer.uploadPartialFailed{failed=1,names=${failedItem('b.txt', 'badRequest')},uploaded=1}`,
    ]);
  });

  it('keeps the auto-renamed note when some files failed', async () => {
    mocks.upload.mockResolvedValueOnce(stored('a copy.txt', true)).mockRejectedValueOnce(failure('server', 500));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(contentsOf(Message.warning)).toEqual([
      `conversation.explorer.uploadPartialFailedRenamed{failed=1,names=${failedItem('b.txt', 'server')},renamed=1,uploaded=1}`,
    ]);
  });

  it.each<[string, unknown, string]>([
    ['the server refused it as too large (413)', failure('tooLarge', 413), 'tooLarge'],
    ['the session stayed expired after a refresh (401)', failure('unauthorized', 401), 'unauthorized'],
    ['the entry or folder is not accessible (403/404)', failure('forbidden', 404), 'forbidden'],
    ['the folder or file name was rejected (400)', failure('badRequest', 400), 'badRequest'],
    ['the connection dropped or stalled', failure('network'), 'network'],
    ['the server failed (5xx)', failure('server', 500), 'server'],
    ['something unrecognisable was thrown', 'surprise', 'server'],
  ])('names the reason when %s', async (_case, error, reason) => {
    mocks.upload.mockRejectedValue(error);
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await batchFinished();
    expect(contentsOf(Message.error)).toEqual([
      `conversation.explorer.uploadFailed{names=${failedItem('a.txt', reason)}}`,
    ]);
  });

  it('labels a file skipped for being over 100 MB as too large', async () => {
    mocks.upload.mockResolvedValue(stored('a.txt'));
    renderIt();
    await pickFiles([oversizedFile('big.bin'), pickedFile('a.txt')]);
    await batchFinished();
    expect(contentsOf(Message.warning)).toEqual([
      `conversation.explorer.uploadPartialFailed{failed=1,names=${failedItem('big.bin', 'tooLarge')},uploaded=1}`,
    ]);
  });

  it('reports an error listing the names when every file failed', async () => {
    mocks.upload.mockRejectedValue(failure('network'));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(contentsOf(Message.error)).toEqual([
      `conversation.explorer.uploadFailed{names=${failedItem('a.txt', 'network')} and ${failedItem('b.txt', 'network')}}`,
    ]);
  });

  it('lists at most three failed names, then "and more"', async () => {
    mocks.upload.mockRejectedValue(failure('server', 500));
    renderIt();
    await pickFiles(['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map(pickedFile));
    await batchFinished();
    const listed = `${failedItem('a.txt', 'server')}, ${failedItem('b.txt', 'server')}, and ${failedItem('c.txt', 'server')}`;
    expect(contentsOf(Message.error)).toEqual([
      `conversation.explorer.uploadFailed{names=conversation.explorer.uploadNamesMore{names=${listed}}}`,
    ]);
  });

  it('sends nothing and shows no progress when every picked file is over 100 MB', async () => {
    renderIt();
    await pickFiles([oversizedFile('big.bin')]);
    await batchFinished();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(Message.loading).not.toHaveBeenCalled();
  });

  it.each<[string, () => void, 'success' | 'warning' | 'error']>([
    ['success', () => mocks.upload.mockResolvedValue(stored('a.txt')), 'success'],
    [
      'partial failure',
      () => mocks.upload.mockResolvedValueOnce(stored('a.txt')).mockRejectedValueOnce(failure('server', 500)),
      'warning',
    ],
    ['total failure', () => mocks.upload.mockRejectedValue(failure('server', 500)), 'error'],
  ])('puts the %s summary in place of the progress toast (same id)', async (_case, arrange, tone) => {
    arrange();
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(idsOf(Message[tone])).toEqual([idsOf(Message.loading)[0]]);
  });
});

describe('ExplorerContainer upload: tree refresh', () => {
  it('expands the target folder after a batch with at least one upload', async () => {
    mocks.upload.mockResolvedValueOnce(stored('a.txt')).mockRejectedValueOnce(failure('server', 500));
    renderIt();
    await pickFiles([pickedFile('a.txt'), pickedFile('b.txt')]);
    await batchFinished();
    expect(revealSpy).toHaveBeenCalledWith({ pe_id: 'peA', relative_path: 'docs' });
  });

  it('leaves the tree alone when nothing was uploaded', async () => {
    mocks.upload.mockRejectedValue(failure('server', 500));
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await batchFinished();
    expect(revealSpy).not.toHaveBeenCalled();
  });

  it('does not reveal into another project that the tree switched to mid-batch', async () => {
    const first = deferred<ProjectUploadResult>();
    mocks.upload.mockReturnValueOnce(first.promise);
    renderIt();
    await pickFiles([pickedFile('a.txt')]);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    act(() => openProject('p2', [{ pe_id: 'peB', title: 'Other', role: 'workspace' }]));
    first.resolve(stored('a.txt'));
    await batchFinished();
    expect(revealSpy).not.toHaveBeenCalled();
  });
});
