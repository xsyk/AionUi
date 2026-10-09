/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The image generation model is one server-wide setting. These tests pin the wire contract the Tools settings
 * page depends on: where the setting lives, how it is read and written, and that the backend envelope is unwrapped.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() })),
  },
}));

import { imageGeneration } from '@/common/adapter/ipcBridge';

const SETTINGS_URL = 'http://127.0.0.1:13400/api/settings/image-generation';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ipcBridge.imageGeneration', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the shared setting with a plain GET and unwraps the response envelope', async () => {
    const settings = { provider_id: 'p1', model: 'gemini-2.5-flash-image', enabled: true, supported: true };
    fetchMock.mockResolvedValue(jsonResponse(settings));

    await expect(imageGeneration.get.invoke()).resolves.toEqual(settings);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SETTINGS_URL);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('writes the shared setting with a PUT whose JSON body is exactly the update', async () => {
    const update = { provider_id: 'p1', model: 'gemini-2.5-flash-image', enabled: true };
    fetchMock.mockResolvedValue(jsonResponse({ ...update, supported: true }));

    await expect(imageGeneration.update.invoke(update)).resolves.toEqual({ ...update, supported: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SETTINGS_URL);
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(update);
  });

  it('can clear the choice by sending nulls', async () => {
    const update = { provider_id: null, model: null, enabled: false };
    fetchMock.mockResolvedValue(jsonResponse({ ...update, supported: true }));

    await imageGeneration.update.invoke(update);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(update);
  });

  it('surfaces the backend refusal as a structured error the page can read', async () => {
    // httpRequest logs every failed call; keep the expected one out of the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, code: 'FORBIDDEN', error: 'Only the administrator' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(
      imageGeneration.update.invoke({ provider_id: null, model: null, enabled: false })
    ).rejects.toMatchObject({ name: 'BackendHttpError', status: 403, code: 'FORBIDDEN' });
  });
});
