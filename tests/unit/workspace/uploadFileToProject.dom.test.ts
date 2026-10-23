/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contract tests for `uploadFileToProject` — the HTTP half of the Explorer's
 * "Upload files" (POST /api/fs/upload-to-project). The backend reads multipart
 * fields in arrival order and rejects a `file` part that arrives before `pe_id`
 * and `relative_path`, so the field order is part of the contract, not a detail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refreshSession: vi.fn<() => Promise<boolean>>() }));

vi.mock('@/common/adapter/sessionRefresh', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/sessionRefresh')>()),
  refreshSession: () => mocks.refreshSession(),
}));

import { setActAsUser } from '@/common/adapter/httpBridge';
import type { ProjectUploadFailure } from '@/renderer/services/FileService';
import {
  PROJECT_UPLOAD_MAX_BYTES,
  ProjectUploadError,
  UPLOAD_ABORTED_ERROR,
  projectUploadFailureOf,
  uploadFileToProject,
} from '@/renderer/services/FileService';

type Listener = (event?: unknown) => void;

class FakeXMLHttpRequest {
  /** Every request constructed, in order. */
  static instances: FakeXMLHttpRequest[] = [];

  method = '';
  url = '';
  status = 0;
  statusText = '';
  responseText = '';
  sentBody: unknown;
  headers: Record<string, string> = {};
  aborted = false;

  private listeners: Record<string, Listener[]> = {};
  private uploadListeners: Record<string, Listener[]> = {};

  upload = {
    addEventListener: (name: string, listener: Listener) => {
      (this.uploadListeners[name] ??= []).push(listener);
    },
  };

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  addEventListener(name: string, listener: Listener) {
    (this.listeners[name] ??= []).push(listener);
  }

  send(body: unknown) {
    this.sentBody = body;
  }

  abort() {
    this.aborted = true;
    this.fire('abort');
  }

  respond(status: number, body: string, statusText = '') {
    this.status = status;
    this.statusText = statusText;
    this.responseText = body;
    this.fire('load');
  }

  /** Request bytes leaving the browser. */
  progress(loaded: number, total: number) {
    for (const listener of this.uploadListeners.progress ?? []) listener({ lengthComputable: true, loaded, total });
  }

  /** The whole request body has been sent; the response has not started yet. */
  bodySent() {
    for (const listener of this.uploadListeners.load ?? []) listener();
  }

  networkError() {
    this.fire('error');
  }

  private fire(name: string) {
    for (const listener of this.listeners[name] ?? []) listener();
  }
}

const xhrAt = (index: number): FakeXMLHttpRequest => {
  const xhr = FakeXMLHttpRequest.instances.at(index);
  expect(xhr, 'expected an XHR to /api/fs/upload-to-project').toBeDefined();
  return xhr!;
};
const lastXhr = () => xhrAt(-1);
const formOf = (xhr: FakeXMLHttpRequest): FormData => xhr.sentBody as FormData;
const sentForm = (): FormData => formOf(lastXhr());

const okBody = (data: Record<string, unknown>) => JSON.stringify({ success: true, data });
const stored = { name: 'a.txt', relative_path: 'docs/a.txt', size: 3, renamed: false };

const file = (name = 'a.txt') => new File(['abc'], name, { type: 'text/plain' });
const target = { pe_id: 'peA', relative_path: 'docs' };

/** The settled rejection of `pending`, for asserting on its fields. */
const rejectionOf = (pending: Promise<unknown>) =>
  pending.then(
    () => {
      throw new Error('expected the upload to fail');
    },
    (error: unknown) => error as ProjectUploadError
  );

/** Resolves once the n-th request (1-based) has been sent — the 401 retry goes out asynchronously. */
const requestCount = (n: number) => vi.waitFor(() => expect(FakeXMLHttpRequest.instances).toHaveLength(n));

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  mocks.refreshSession.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setActAsUser(null);
});

describe('uploadFileToProject request', () => {
  it('POSTs to /api/fs/upload-to-project', () => {
    void uploadFileToProject(file(), target);
    expect(lastXhr().method).toBe('POST');
    expect(lastXhr().url).toMatch(/\/api\/fs\/upload-to-project$/);
  });

  it('appends pe_id and relative_path before the file part (the server rejects a file that comes first)', () => {
    void uploadFileToProject(file(), target);
    expect(Array.from(sentForm().keys())).toEqual(['pe_id', 'relative_path', 'file']);
  });

  it('carries the target entry, the target directory and the picked file', () => {
    void uploadFileToProject(file('report.pdf'), target);
    expect(sentForm().get('pe_id')).toBe('peA');
    expect(sentForm().get('relative_path')).toBe('docs');
    expect((sentForm().get('file') as File).name).toBe('report.pdf');
  });

  it('sends an empty relative_path for the entry root instead of dropping the field', () => {
    void uploadFileToProject(file(), { pe_id: 'peA', relative_path: '' });
    expect(sentForm().get('relative_path')).toBe('');
  });

  it('sends the act-as header while the super admin acts as another user', () => {
    setActAsUser('user-2');
    void uploadFileToProject(file(), target);
    expect(lastXhr().headers['x-aionui-act-as']).toBe('user-2');
  });

  it('sends no act-as header when acting as nobody', () => {
    void uploadFileToProject(file(), target);
    expect(lastXhr().headers).not.toHaveProperty('x-aionui-act-as');
  });
});

describe('uploadFileToProject response', () => {
  it('resolves the stored file reported by the server', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, okBody({ name: 'a copy.txt', relative_path: 'docs/a copy.txt', size: 3, renamed: true }));
    await expect(pending).resolves.toEqual({
      name: 'a copy.txt',
      relative_path: 'docs/a copy.txt',
      size: 3,
      renamed: true,
    });
  });

  it('maps 413 to FILE_TOO_LARGE, classified as too large', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(413, 'length limit exceeded', 'Payload Too Large');
    const error = await rejectionOf(pending);
    expect(error.message).toBe('FILE_TOO_LARGE');
    expect(error.reason).toBe('tooLarge');
  });

  it("rejects with the server's error text on other failures", async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(400, JSON.stringify({ success: false, error: 'Target is not a directory', code: 'BAD_REQUEST' }));
    await expect(pending).rejects.toThrow('Target is not a directory');
  });

  it('falls back to a `msg` field when the error body has no `error`', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(403, JSON.stringify({ msg: 'Entry belongs to another user' }));
    await expect(pending).rejects.toThrow('Entry belongs to another user');
  });

  it('reports the status, not the page, when the error body is not JSON (e.g. a proxy error page)', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(502, '<html><body>Bad Gateway</body></html>', 'Bad Gateway');
    const error = await rejectionOf(pending);
    expect(error.message).toContain('502');
    expect(error.message).not.toContain('<html>');
  });

  it.each<[number, ProjectUploadFailure]>([
    [400, 'badRequest'],
    [403, 'forbidden'],
    [404, 'forbidden'],
    [500, 'server'],
    [502, 'server'],
  ])('classifies a %i response as %s', async (status, reason) => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(status, JSON.stringify({ success: false, error: 'nope' }));
    expect((await rejectionOf(pending)).reason).toBe(reason);
  });

  it('rejects a 2xx response that is not a successful envelope as a server failure', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, JSON.stringify({ success: false }));
    const error = await rejectionOf(pending);
    expect(error.message).toMatch(/unsuccessful/);
    expect(error.reason).toBe('server');
  });

  it('rejects a 2xx response whose body is not JSON as a server failure', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, 'ok');
    const error = await rejectionOf(pending);
    expect(error.message).toMatch(/invalid server response/);
    expect(error.reason).toBe('server');
  });

  it('rejects a network error as a network failure', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().networkError();
    const error = await rejectionOf(pending);
    expect(error.message).toMatch(/network error/);
    expect(error.reason).toBe('network');
  });
});

describe('uploadFileToProject expired session (401)', () => {
  it('refreshes the session once and resends the upload after a 401', async () => {
    mocks.refreshSession.mockResolvedValue(true);
    const pending = uploadFileToProject(file(), target);
    xhrAt(0).respond(401, JSON.stringify({ success: false, error: 'Invalid or expired token' }));
    await requestCount(2);
    xhrAt(1).respond(200, okBody(stored));
    await expect(pending).resolves.toEqual(stored);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('resends a freshly built body with the same fields in the same order', async () => {
    mocks.refreshSession.mockResolvedValue(true);
    void uploadFileToProject(file(), target);
    xhrAt(0).respond(401, '');
    await requestCount(2);
    expect(formOf(xhrAt(1))).not.toBe(formOf(xhrAt(0)));
    expect(Array.from(formOf(xhrAt(1)).keys())).toEqual(['pe_id', 'relative_path', 'file']);
  });

  it('gives up as unauthorized when the resent upload is refused again — no third attempt', async () => {
    mocks.refreshSession.mockResolvedValue(true);
    const pending = uploadFileToProject(file(), target);
    xhrAt(0).respond(401, '');
    await requestCount(2);
    xhrAt(1).respond(401, JSON.stringify({ success: false, error: 'Invalid authentication session' }));
    expect((await rejectionOf(pending)).reason).toBe('unauthorized');
    expect(FakeXMLHttpRequest.instances).toHaveLength(2);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not resend when the session cannot be refreshed', async () => {
    const pending = uploadFileToProject(file(), target);
    xhrAt(0).respond(401, '');
    expect((await rejectionOf(pending)).reason).toBe('unauthorized');
    expect(FakeXMLHttpRequest.instances).toHaveLength(1);
  });
});

describe('uploadFileToProject progress, stalls and cancel', () => {
  it('reports upload progress as a rounded percentage', () => {
    const onProgress = vi.fn();
    void uploadFileToProject(file(), target, onProgress);
    lastXhr().progress(1, 3);
    expect(onProgress).toHaveBeenCalledWith(33);
  });

  it('aborts an upload that shows no sign of progress for 60 s and reports it as a network failure', async () => {
    vi.useFakeTimers();
    const pending = uploadFileToProject(file(), target);
    vi.advanceTimersByTime(60_000);
    expect(lastXhr().aborted).toBe(true);
    expect((await rejectionOf(pending)).reason).toBe('network');
  });

  it('keeps a slow upload alive while progress keeps arriving, and while it waits for the reply', async () => {
    vi.useFakeTimers();
    const pending = uploadFileToProject(file(), target);
    vi.advanceTimersByTime(59_000);
    lastXhr().progress(1, 2);
    vi.advanceTimersByTime(59_000);
    lastXhr().bodySent();
    vi.advanceTimersByTime(59_000);
    lastXhr().respond(200, okBody(stored));
    await expect(pending).resolves.toEqual(stored);
    expect(lastXhr().aborted).toBe(false);
  });

  it('stops watching once the upload has settled', async () => {
    vi.useFakeTimers();
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, okBody(stored));
    await pending;
    vi.advanceTimersByTime(120_000);
    expect(lastXhr().aborted).toBe(false);
  });

  it('aborts the request and rejects with UPLOAD_ABORTED_ERROR when the signal fires', async () => {
    const controller = new AbortController();
    const pending = uploadFileToProject(file(), target, undefined, { signal: controller.signal });
    controller.abort();
    const error = await rejectionOf(pending);
    expect(error.message).toBe(UPLOAD_ABORTED_ERROR);
    expect(error.reason).toBe('aborted');
    expect(lastXhr().aborted).toBe(true);
  });

  it('never opens a request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await rejectionOf(uploadFileToProject(file(), target, undefined, { signal: controller.signal }));
    expect(error.reason).toBe('aborted');
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  });
});

describe('projectUploadFailureOf', () => {
  it.each<[unknown, ProjectUploadFailure]>([
    [new ProjectUploadError('forbidden', 'Entry not found', 404), 'forbidden'],
    [new Error('FILE_TOO_LARGE'), 'tooLarge'],
    [new Error(UPLOAD_ABORTED_ERROR), 'aborted'],
    [new Error('something else'), 'server'],
    ['not even an Error', 'server'],
  ])('classifies %o as %s', (error, reason) => {
    expect(projectUploadFailureOf(error)).toBe(reason);
  });
});

describe('PROJECT_UPLOAD_MAX_BYTES', () => {
  it('matches the server-side per-file ceiling of 100 MiB', () => {
    expect(PROJECT_UPLOAD_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});
