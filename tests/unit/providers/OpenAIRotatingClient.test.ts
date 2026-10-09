/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';

const openAIConstructorMock = vi.hoisted(() =>
  vi.fn(function OpenAIMock(_config: Record<string, unknown>) {
    return {};
  })
);

vi.mock('openai', () => ({
  __esModule: true,
  default: openAIConstructorMock,
}));

describe('OpenAIRotatingClient', () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    openAIConstructorMock.mockClear();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  it('passes the cleaned configured key to the OpenAI SDK using camelCase apiKey', () => {
    const httpAgent = { name: 'proxy-agent' };

    const client = new OpenAIRotatingClient(' \n sk-configured-key\t ', {
      baseURL: 'https://gateway.example.com/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://aionui.com',
      },
      httpAgent,
    });

    expect(client.hasMultipleKeys()).toBe(false);
    expect(openAIConstructorMock).toHaveBeenCalledTimes(1);
    const firstCall = openAIConstructorMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const config = firstCall?.[0] as Record<string, unknown>;
    expect(config).toMatchObject({
      apiKey: 'sk-configured-key',
      baseURL: 'https://gateway.example.com/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://aionui.com',
      },
      httpAgent,
    });
    expect(config).not.toHaveProperty('api_key');
  });

  it('rejects API operations when no configured key can initialize a client', async () => {
    const client = new OpenAIRotatingClient('');

    await expect(client.createChatCompletion({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(
      /Client not initialized/
    );
    expect(openAIConstructorMock).not.toHaveBeenCalled();
  });

  describe('image operations', () => {
    const imagesResponse = { created: 1, data: [{ b64_json: 'AAAA' }] };

    /** Makes the next OpenAI SDK instance expose the given `images` resource. */
    const nextSdkClientHas = (images: { generate?: ReturnType<typeof vi.fn>; edit?: ReturnType<typeof vi.fn> }) => {
      openAIConstructorMock.mockImplementationOnce(function () {
        return { images };
      });
    };

    it('generateImage forwards the params and request options to images.generate and returns its response', async () => {
      const generate = vi.fn().mockResolvedValue(imagesResponse);
      nextSdkClientHas({ generate });
      const client = new OpenAIRotatingClient('sk-key');
      const params = { model: 'gpt-image-1', prompt: 'a red cat', n: 1 };
      const options = { signal: new AbortController().signal, timeout: 5000 };

      const response = await client.generateImage(params, options);

      expect(response).toBe(imagesResponse);
      expect(generate).toHaveBeenCalledWith(params, options);
    });

    it('editImage forwards the params and request options to images.edit and returns its response', async () => {
      const edit = vi.fn().mockResolvedValue(imagesResponse);
      nextSdkClientHas({ edit });
      const client = new OpenAIRotatingClient('sk-key');
      const params = {
        model: 'gpt-image-1',
        prompt: 'add a hat',
        image: new File(['x'], 'in.png', { type: 'image/png' }),
      };
      const options = { timeout: 5000 };

      const response = await client.editImage(params, options);

      expect(response).toBe(imagesResponse);
      expect(edit).toHaveBeenCalledWith(params, options);
    });

    it('generateImage rotates to the next API key and retries after a rate limit', async () => {
      const limited = vi.fn().mockRejectedValue(Object.assign(new Error('429 Too Many Requests'), { status: 429 }));
      const accepted = vi.fn().mockResolvedValue(imagesResponse);
      nextSdkClientHas({ generate: limited });
      nextSdkClientHas({ generate: accepted });
      const client = new OpenAIRotatingClient('sk-one,sk-two', {}, { maxRetries: 3, retryDelay: 0 });

      const response = await client.generateImage({ model: 'gpt-image-1', prompt: 'a red cat' });

      expect(response).toBe(imagesResponse);
      expect(limited).toHaveBeenCalledTimes(1);
      expect(accepted).toHaveBeenCalledTimes(1);
      const keysUsed = openAIConstructorMock.mock.calls.map(([config]) => (config as { apiKey: string }).apiKey);
      expect(new Set(keysUsed)).toEqual(new Set(['sk-one', 'sk-two']));
    });

    it('editImage retries a transient server error and returns the later success', async () => {
      const edit = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('503 Service Unavailable'), { status: 503 }))
        .mockResolvedValueOnce(imagesResponse);
      nextSdkClientHas({ edit });
      const client = new OpenAIRotatingClient('sk-key', {}, { maxRetries: 3, retryDelay: 0 });

      const response = await client.editImage({
        model: 'gpt-image-1',
        prompt: 'add a hat',
        image: new File(['x'], 'in.png', { type: 'image/png' }),
      });

      expect(response).toBe(imagesResponse);
      expect(edit).toHaveBeenCalledTimes(2);
    });

    it('generateImage gives up on an error that is not retryable', async () => {
      const generate = vi.fn().mockRejectedValue(Object.assign(new Error('400 Bad Request'), { status: 400 }));
      nextSdkClientHas({ generate });
      const client = new OpenAIRotatingClient('sk-key', {}, { maxRetries: 3, retryDelay: 0 });

      await expect(client.generateImage({ model: 'gpt-image-1', prompt: 'a red cat' })).rejects.toThrow(
        '400 Bad Request'
      );
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('rejects the image operations when no configured key can initialize a client', async () => {
      const client = new OpenAIRotatingClient('');

      await expect(client.generateImage({ model: 'gpt-image-1', prompt: 'a red cat' })).rejects.toThrow(
        /Client not initialized/
      );
      await expect(
        client.editImage({ model: 'gpt-image-1', prompt: 'x', image: new File(['x'], 'in.png') })
      ).rejects.toThrow(/Client not initialized/);
    });
  });
});
