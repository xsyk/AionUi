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

import { setActAsUser } from '@/common/adapter/httpBridge';
import { PROJECT_UPLOAD_MAX_BYTES, UPLOAD_ABORTED_ERROR, uploadFileToProject } from '@/renderer/services/FileService';

type Listener = (event?: unknown) => void;

class FakeXMLHttpRequest {
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
    FakeXMLHttpRequest.instances.push(this);
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

  progress(loaded: number, total: number) {
    for (const listener of this.uploadListeners.progress ?? []) listener({ lengthComputable: true, loaded, total });
  }

  networkError() {
    this.fire('error');
  }

  private fire(name: string) {
    for (const listener of this.listeners[name] ?? []) listener();
  }
}

const lastXhr = (): FakeXMLHttpRequest => {
  const xhr = FakeXMLHttpRequest.instances.at(-1);
  expect(xhr, 'expected an XHR to /api/fs/upload-to-project').toBeDefined();
  return xhr!;
};

const sentForm = (): FormData => lastXhr().sentBody as FormData;

const okBody = (data: Record<string, unknown>) => JSON.stringify({ success: true, data });

const file = (name = 'a.txt') => new File(['abc'], name, { type: 'text/plain' });
const target = { pe_id: 'peA', relative_path: 'docs' };

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
});

afterEach(() => {
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
    lastXhr().respond(200, okBody({ name: 'a (1).txt', relative_path: 'docs/a (1).txt', size: 3, renamed: true }));
    await expect(pending).resolves.toEqual({
      name: 'a (1).txt',
      relative_path: 'docs/a (1).txt',
      size: 3,
      renamed: true,
    });
  });

  it('maps 413 to FILE_TOO_LARGE', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(413, 'length limit exceeded', 'Payload Too Large');
    await expect(pending).rejects.toThrow('FILE_TOO_LARGE');
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
    const error = await pending.catch((e: unknown) => e as Error);
    expect(error.message).toContain('502');
    expect(error.message).not.toContain('<html>');
  });

  it('rejects a 2xx response that is not a successful envelope', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, JSON.stringify({ success: false }));
    await expect(pending).rejects.toThrow(/unsuccessful/);
  });

  it('rejects a 2xx response whose body is not JSON', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().respond(200, 'ok');
    await expect(pending).rejects.toThrow(/invalid server response/);
  });

  it('rejects on a network error', async () => {
    const pending = uploadFileToProject(file(), target);
    lastXhr().networkError();
    await expect(pending).rejects.toThrow(/network error/);
  });
});

describe('uploadFileToProject progress and cancel', () => {
  it('reports upload progress as a rounded percentage', () => {
    const onProgress = vi.fn();
    void uploadFileToProject(file(), target, onProgress);
    lastXhr().progress(1, 3);
    expect(onProgress).toHaveBeenCalledWith(33);
  });

  it('aborts the request and rejects with UPLOAD_ABORTED_ERROR when the signal fires', async () => {
    const controller = new AbortController();
    const pending = uploadFileToProject(file(), target, undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(UPLOAD_ABORTED_ERROR);
    expect(lastXhr().aborted).toBe(true);
  });

  it('never opens a request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadFileToProject(file(), target, undefined, { signal: controller.signal })).rejects.toThrow(
      UPLOAD_ABORTED_ERROR
    );
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  });
});

describe('PROJECT_UPLOAD_MAX_BYTES', () => {
  it('matches the server-side per-file ceiling of 100 MiB', () => {
    expect(PROJECT_UPLOAD_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});
