/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import { basename, join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import type OpenAI from 'openai';
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import { processImageUri, saveGeneratedImage, executeImageGeneration } from '@/common/chat/imageGenCore';
import type { TProviderWithModel } from '@/common/config/storage';

let cleanupDirs: string[] = [];
let openServers: http.Server[] = [];

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aionui-image-gen-test-'));
  cleanupDirs.push(dir);
  return dir;
}

function createImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, PNG_1x1);
  return filePath;
}

function createNonImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, 'hello world');
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    openServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
  openServers = [];
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  cleanupDirs = [];
});

// Minimal valid 1×1 PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const DATA_URL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('processImageUri', () => {
  it('should return image_url for an HTTP URL without filesystem access', async () => {
    const result = await processImageUri('https://example.com/photo.png', '/nonexistent');

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/photo.png', detail: 'auto' },
    });
  });

  it('should resolve a relative path within the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    const result = await processImageUri('test.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
    expect(result!.image_url.url).toContain('base64');
  });

  it('should resolve a path with @ prefix within the workspace', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'test.png');

    const result = await processImageUri('@test.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should block path traversal via ../ from escaping the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('../../../etc/passwd', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block path traversal for ".." (parent without trailing path)', async () => {
    const ws = createWorkspace();
    // ".." triggers relative !== '..' short-circuit branch in isWithin
    await expect(processImageUri('..', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block absolute path outside the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('/etc/passwd', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should allow an absolute path that is inside the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    const result = await processImageUri(imgPath, ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should reject a non-image file even when within the workspace', async () => {
    const ws = createWorkspace();
    createNonImageFile(ws, 'notes.txt');

    await expect(processImageUri('notes.txt', ws)).rejects.toThrow('not a supported image type');
  });

  it('should resolve a "." path to the workspace directory itself', async () => {
    const ws = createWorkspace();
    // "." resolves to workspace dir — isWithin returns true via relative === '' branch
    await expect(processImageUri('.', ws)).rejects.toThrow('not a supported image type');
  });

  it('should resolve a path with dot segments within the workspace', async () => {
    const ws = createWorkspace();
    const subDir = join(ws, 'subdir');
    mkdirSync(subDir);
    createImageFile(subDir, 'image.png');

    const result = await processImageUri('subdir/../subdir/image.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should reject a missing file within the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('nonexistent.png', ws)).rejects.toThrow('Image file not found');
  });

  it('should block a symlink inside the workspace that points outside', async () => {
    const ws = createWorkspace();
    // Secret image lives outside the workspace; a symlink inside the workspace
    // points to it. The lexical containment check passes for the link path, but
    // realpath must reveal the escape and block the read.
    const outsideDir = createWorkspace();
    const secretImg = createImageFile(outsideDir, 'secret.png');
    symlinkSync(secretImg, join(ws, 'linked.png'));

    await expect(processImageUri('linked.png', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block a symlinked directory inside the workspace that points outside', async () => {
    const ws = createWorkspace();
    const outsideDir = createWorkspace();
    createImageFile(outsideDir, 'secret.png');
    symlinkSync(outsideDir, join(ws, 'linked-dir'), 'dir');

    await expect(processImageUri('linked-dir/secret.png', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should allow a symlink inside the workspace that stays inside', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'real.png');
    symlinkSync(imgPath, join(ws, 'alias.png'));

    const result = await processImageUri('alias.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });
});

describe('saveGeneratedImage', () => {
  it('should save an image to the workspace directory', async () => {
    const ws = createWorkspace();

    const filePath = await saveGeneratedImage(DATA_URL_PNG, ws);

    expect(filePath.startsWith(ws)).toBe(true);
    expect(filePath).toMatch(/img-\d+\.png$/);
  });

  it('should resolve a workspace directory with trailing dot segments', async () => {
    const ws = createWorkspace();
    const subDir = join(ws, 'sub');
    mkdirSync(subDir);
    const trickyDir = join(ws, 'sub', '..', 'sub', '.');

    const filePath = await saveGeneratedImage(DATA_URL_PNG, trickyDir);

    expect(filePath.startsWith(pathResolve(ws))).toBe(true);
  });
});

describe('executeImageGeneration', () => {
  it('should return error for a non-existent workspace directory', async () => {
    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      { id: 'test', name: 'test', platform: 'openai', base_url: '', api_key: 'sk-test', use_model: 'dall-e-3' },
      '/nonexistent/workspace'
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain('not found');
  });

  it('should return error when workspace path is a file, not a directory', async () => {
    const ws = createWorkspace();
    const filePath = createImageFile(ws, 'not-a-dir.png');

    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      { id: 'test', name: 'test', platform: 'openai', base_url: '', api_key: 'sk-test', use_model: 'dall-e-3' },
      filePath
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain('not a directory');
  });
});

// ===== OpenAI Images API (gpt-image / dall-e) =====

const PNG_BASE64 = PNG_1x1.toString('base64');

const imagesProvider: TProviderWithModel = {
  id: 'relay',
  name: 'Relay',
  platform: 'custom',
  base_url: 'https://relay.example.com/v1',
  api_key: 'sk-test',
  use_model: 'gpt-image-1',
};

const geminiProvider: TProviderWithModel = {
  id: 'gemini',
  name: 'Gemini',
  platform: 'gemini',
  base_url: '',
  api_key: 'sk-test',
  use_model: 'gemini-2.5-flash-image',
};

const imagesResponse = (...data: OpenAI.Images.Image[]): OpenAI.Images.ImagesResponse => ({ created: 1, data });

const unexpected = (method: string) => () => Promise.reject(new Error(`unexpected ${method} call`));

/**
 * A real OpenAIRotatingClient (so the `instanceof` routing check is exercised) handed out by a stubbed
 * ClientFactory, with every network-facing method replaced by a spy that fails unless the test sets it up.
 */
function useOpenAiClient() {
  const client = new OpenAIRotatingClient('sk-test', { baseURL: 'https://relay.example.com/v1' });
  const generateImage = vi.spyOn(client, 'generateImage').mockImplementation(unexpected('generateImage'));
  const editImage = vi.spyOn(client, 'editImage').mockImplementation(unexpected('editImage'));
  const createChatCompletion = vi
    .spyOn(client, 'createChatCompletion')
    .mockImplementation(unexpected('createChatCompletion'));
  const createRotatingClient = vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue(client);
  return { client, generateImage, editImage, createChatCompletion, createRotatingClient };
}

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const pngResponse = (init: ResponseInit = {}) =>
  new Response(PNG_1x1, { status: 200, headers: { 'content-type': 'image/png' }, ...init });

function listen(server: http.Server): Promise<number> {
  openServers.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  );
}

/** Serves `/out.png` as a PNG, `/moved.png` as a redirect to it, and two redirects that never lead to an image. */
function startImageServer(): Promise<number> {
  return listen(
    http.createServer((req, res) => {
      if (req.url === '/moved.png') {
        res.writeHead(302, { location: '/out.png' });
        res.end();
      } else if (req.url === '/loop.png') {
        res.writeHead(302, { location: '/loop.png' });
        res.end();
      } else if (req.url === '/broken-redirect.png') {
        res.writeHead(302, { location: 'http://' });
        res.end();
      } else if (req.url === '/out.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_1x1);
      } else {
        res.writeHead(404);
        res.end('missing');
      }
    })
  );
}

/** A minimal HTTP proxy that only tunnels CONNECT and records the host:port it was asked for. */
function startConnectProxy(requested: string[]): Promise<number> {
  const proxy = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on('connect', (req, clientSocket, head) => {
    requested.push(req.url ?? '');
    const [host, port] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  return listen(proxy);
}

describe('executeImageGeneration with an OpenAI Images API model', () => {
  describe('without input images', () => {
    it('saves the returned base64 image into the workspace and reports its path', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(result.success).toBe(true);
      expect(result.imagePath).toMatch(/img-\d+\.png$/);
      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
    });

    it('returns the same result shape as the chat path', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(result.relativeImagePath).toBe(basename(result.imagePath!));
      expect(result.text).toBe(`Image generated successfully.\n\nGenerated image saved to: ${result.imagePath}`);
    });

    it('uses the revised prompt as the description', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(
        imagesResponse({ b64_json: PNG_BASE64, revised_prompt: 'A fluffy red cat on a sofa' })
      );

      const result = await executeImageGeneration(
        { prompt: 'a red cat' },
        { ...imagesProvider, use_model: 'dall-e-3' },
        ws
      );

      expect(result.text).toBe(`A fluffy red cat on a sofa\n\nGenerated image saved to: ${result.imagePath}`);
    });

    it('accepts a base64 payload that already is a data URL', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: DATA_URL_PNG }));

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
    });

    it('names the file after the output format the API reports', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue({ ...imagesResponse({ b64_json: PNG_BASE64 }), output_format: 'webp' });

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(result.imagePath).toMatch(/\.webp$/);
    });

    it('asks for exactly one image and leaves size and response_format to the model', async () => {
      const ws = createWorkspace();
      const { generateImage, editImage, createChatCompletion } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(generateImage.mock.calls[0][0]).toStrictEqual({ model: 'gpt-image-1', prompt: 'a red cat', n: 1 });
      expect(editImage).not.toHaveBeenCalled();
      expect(createChatCompletion).not.toHaveBeenCalled();
    });

    it('sends the configured model id as is, vendor prefix included', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'a red cat' }, { ...imagesProvider, use_model: 'openai/gpt-image-1' }, ws);

      expect(generateImage.mock.calls[0][0].model).toBe('openai/gpt-image-1');
    });

    it('passes the abort signal and the API timeout with the request', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));
      const { signal } = new AbortController();

      await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws, undefined, signal);

      expect(generateImage.mock.calls[0][1]).toStrictEqual({ signal, timeout: 120000 });
    });

    it('hands the proxy and the retry settings to the client factory', async () => {
      const ws = createWorkspace();
      const { generateImage, createRotatingClient } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws, 'http://proxy.local:3128');

      expect(createRotatingClient).toHaveBeenCalledWith(imagesProvider, {
        proxy: 'http://proxy.local:3128',
        rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
      });
    });
  });

  describe('when the API answers with an image URL', () => {
    it('downloads the image and saves it into the workspace', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/out.png' }));
      const fetchMock = stubFetch(() => pngResponse());

      const result = await executeImageGeneration(
        { prompt: 'a dog' },
        { ...imagesProvider, use_model: 'dall-e-3' },
        ws
      );

      expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/out.png');
      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
    });

    it('labels the saved file with the type the server announced', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/out' }));
      stubFetch(() => pngResponse({ headers: { 'content-type': 'image/webp' } }));

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.imagePath).toMatch(/\.webp$/);
    });

    it('falls back to the URL extension when the server announces no image type', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/render.jpg' }));
      stubFetch(() => pngResponse({ headers: { 'content-type': 'application/octet-stream' } }));

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.imagePath).toMatch(/\.jpg$/);
    });

    it('saves a data URL returned in the url field without any download', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: DATA_URL_PNG }));
      const fetchMock = stubFetch(() => pngResponse());

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never fetches a URL that is not http(s)', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'file:///etc/passwd' }));
      const fetchMock = stubFetch(() => pngResponse());

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.text).toMatch(/^Image generation failed: .*http/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prefers the base64 data when the response carries both', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64, url: 'https://cdn.example.com/out.png' }));
      const fetchMock = stubFetch(() => pngResponse());

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a failed download as an image generation failure', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/gone.png' }));
      stubFetch(() => new Response('gone', { status: 404, statusText: 'Not Found' }));

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.success).toBe(false);
      expect(result.text).toMatch(/^Image generation failed: .*404/);
    });

    it('refuses a URL that does not serve an image', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/login' }));
      stubFetch(() => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.success).toBe(false);
      expect(result.text).toContain('text/html');
    });

    it('refuses to buffer an unreasonably large download', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: 'https://cdn.example.com/huge.png' }));
      const oneMiB = new Uint8Array(1024 * 1024);
      let sent = 0;
      stubFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                sent += 1;
                controller.enqueue(oneMiB);
                if (sent >= 200) controller.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'image/png' } }
          )
      );

      const result = await executeImageGeneration({ prompt: 'a dog' }, imagesProvider, ws);

      expect(result.text).toMatch(/^Image generation failed: .*larger than 50MB/);
      expect(sent).toBeGreaterThan(0);
      expect(sent).toBeLessThan(200);
    });

    it('downloads through the configured proxy instead of the global fetch', async () => {
      const ws = createWorkspace();
      const requested: string[] = [];
      const imagePort = await startImageServer();
      const proxyPort = await startConnectProxy(requested);
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: `http://127.0.0.1:${imagePort}/out.png` }));
      const fetchMock = stubFetch(() => pngResponse());

      const result = await executeImageGeneration(
        { prompt: 'a dog' },
        imagesProvider,
        ws,
        `http://127.0.0.1:${proxyPort}`
      );

      expect(result.success).toBe(true);
      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
      expect(requested).toEqual([`127.0.0.1:${imagePort}`]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('follows a redirect while downloading through the proxy', async () => {
      const ws = createWorkspace();
      const requested: string[] = [];
      const imagePort = await startImageServer();
      const proxyPort = await startConnectProxy(requested);
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: `http://127.0.0.1:${imagePort}/moved.png` }));

      const result = await executeImageGeneration(
        { prompt: 'a dog' },
        imagesProvider,
        ws,
        `http://127.0.0.1:${proxyPort}`
      );

      expect(result.success).toBe(true);
      expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
    });

    it.each([
      ['a redirect loop', '/loop.png', /Too many redirects/],
      ['a redirect to an invalid address', '/broken-redirect.png', /Invalid URL/],
    ])('fails cleanly on %s while downloading through the proxy', async (_label, urlPath, expected) => {
      const ws = createWorkspace();
      const imagePort = await startImageServer();
      const proxyPort = await startConnectProxy([]);
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: `http://127.0.0.1:${imagePort}${urlPath}` }));

      const result = await executeImageGeneration(
        { prompt: 'a dog' },
        imagesProvider,
        ws,
        `http://127.0.0.1:${proxyPort}`
      );

      expect(result.success).toBe(false);
      expect(result.text).toMatch(expected);
    });

    it('reports an HTTP error status from a download through the proxy', async () => {
      const ws = createWorkspace();
      const imagePort = await startImageServer();
      const proxyPort = await startConnectProxy([]);
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(imagesResponse({ url: `http://127.0.0.1:${imagePort}/missing.png` }));

      const result = await executeImageGeneration(
        { prompt: 'a dog' },
        imagesProvider,
        ws,
        `http://127.0.0.1:${proxyPort}`
      );

      expect(result.success).toBe(false);
      expect(result.text).toMatch(/^Image generation failed: .*404/);
    });
  });

  describe('with input images', () => {
    it('edits instead of generating and uploads every input image', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      createImageFile(ws, 'b.jpg');
      const { generateImage, editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      const result = await executeImageGeneration(
        { prompt: 'merge them', image_uris: ['a.png', '@b.jpg'] },
        imagesProvider,
        ws
      );

      const [params] = editImage.mock.calls[0];
      const files = params.image as File[];
      expect(result.success).toBe(true);
      expect(files.map((file) => [file.name, file.type])).toEqual([
        ['image-1.png', 'image/png'],
        ['image-2.jpg', 'image/jpeg'],
      ]);
      expect(generateImage).not.toHaveBeenCalled();
    });

    it('sends the model and prompt untouched and the file bytes unchanged', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, imagesProvider, ws);

      const [params] = editImage.mock.calls[0];
      const file = params.image as File;
      expect(params).toMatchObject({ model: 'gpt-image-1', prompt: 'add a hat' });
      expect(Buffer.from(await file.arrayBuffer()).equals(PNG_1x1)).toBe(true);
    });

    it('sends a single input image as one file rather than a list', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, imagesProvider, ws);

      expect(Array.isArray(editImage.mock.calls[0][0].image)).toBe(false);
    });

    it('accepts the image list as a JSON string', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      createImageFile(ws, 'b.png');
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      await executeImageGeneration({ prompt: 'merge', image_uris: '["a.png","b.png"]' }, imagesProvider, ws);

      expect(editImage.mock.calls[0][0].image).toHaveLength(2);
    });

    it('downloads an input image given as an HTTP URL and uploads it with the announced type', async () => {
      const ws = createWorkspace();
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));
      const fetchMock = stubFetch(() => pngResponse({ headers: { 'content-type': 'image/webp' } }));

      await executeImageGeneration(
        { prompt: 'restyle', image_uris: ['https://img.example.com/in'] },
        imagesProvider,
        ws
      );

      const file = editImage.mock.calls[0][0].image as File;
      expect(fetchMock.mock.calls[0][0]).toBe('https://img.example.com/in');
      expect([file.name, file.type]).toEqual(['image-1.webp', 'image/webp']);
    });

    it('passes the abort signal to input downloads and to the edit request', async () => {
      const ws = createWorkspace();
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));
      const fetchMock = stubFetch(() => pngResponse());
      const { signal } = new AbortController();

      await executeImageGeneration(
        { prompt: 'restyle', image_uris: ['https://img.example.com/in.png'] },
        imagesProvider,
        ws,
        undefined,
        signal
      );

      expect(editImage.mock.calls[0][1]).toMatchObject({ signal, timeout: 120000 });
      expect(fetchMock.mock.calls[0][1]).toHaveProperty('signal');
    });

    it('blocks an input path that escapes the workspace before calling the API', async () => {
      const ws = createWorkspace();
      const { generateImage, editImage } = useOpenAiClient();

      const result = await executeImageGeneration(
        { prompt: 'steal', image_uris: ['../../../etc/passwd'] },
        imagesProvider,
        ws
      );

      expect(result.success).toBe(false);
      expect(result.text).toContain('Path traversal blocked');
      expect(editImage).not.toHaveBeenCalled();
      expect(generateImage).not.toHaveBeenCalled();
    });

    it('blocks a symlinked input that points outside the workspace', async () => {
      const ws = createWorkspace();
      const outside = createWorkspace();
      symlinkSync(createImageFile(outside, 'secret.png'), join(ws, 'linked.png'));
      const { editImage } = useOpenAiClient();

      const result = await executeImageGeneration({ prompt: 'x', image_uris: ['linked.png'] }, imagesProvider, ws);

      expect(result.text).toContain('Path traversal blocked');
      expect(editImage).not.toHaveBeenCalled();
    });

    it('fails when none of the input images can be read', async () => {
      const ws = createWorkspace();
      useOpenAiClient();

      const result = await executeImageGeneration({ prompt: 'x', image_uris: ['missing.png'] }, imagesProvider, ws);

      expect(result.success).toBe(false);
      expect(result.text).toContain('Failed to process any images');
    });

    it('still edits with the readable images when only some of them are missing', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      const { editImage } = useOpenAiClient();
      editImage.mockResolvedValue(imagesResponse({ b64_json: PNG_BASE64 }));

      const result = await executeImageGeneration(
        { prompt: 'x', image_uris: ['missing.png', 'a.png'] },
        imagesProvider,
        ws
      );

      expect(result.success).toBe(true);
      expect(editImage.mock.calls[0][0].image).not.toBeInstanceOf(Array);
    });

    it('fails when an input image cannot be downloaded', async () => {
      const ws = createWorkspace();
      const { editImage } = useOpenAiClient();
      stubFetch(() => new Response('nope', { status: 403, statusText: 'Forbidden' }));

      const result = await executeImageGeneration(
        { prompt: 'x', image_uris: ['https://img.example.com/private.png'] },
        imagesProvider,
        ws
      );

      expect(result.success).toBe(false);
      expect(result.text).toMatch(/^Image generation failed: .*403/);
      expect(editImage).not.toHaveBeenCalled();
    });
  });

  describe('when something goes wrong', () => {
    it('reports an API error as a failed generation with the message', async () => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockRejectedValue(new Error('400 Billing hard limit has been reached'));

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(result).toEqual({
        success: false,
        text: 'Image generation failed: 400 Billing hard limit has been reached',
        error: '400 Billing hard limit has been reached',
      });
    });

    it('reports an edit API error the same way', async () => {
      const ws = createWorkspace();
      createImageFile(ws, 'a.png');
      const { editImage } = useOpenAiClient();
      editImage.mockRejectedValue(new Error('400 Invalid file format'));

      const result = await executeImageGeneration({ prompt: 'x', image_uris: ['a.png'] }, imagesProvider, ws);

      expect(result.text).toBe('Image generation failed: 400 Invalid file format');
    });

    it.each([
      ['no data entries', imagesResponse()],
      ['an entry with neither base64 data nor a URL', imagesResponse({ revised_prompt: 'only text' })],
    ])('fails when the response carries no image (%s)', async (_label, response) => {
      const ws = createWorkspace();
      const { generateImage } = useOpenAiClient();
      generateImage.mockResolvedValue(response);

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, ws);

      expect(result.success).toBe(false);
      expect(result.text).toMatch(/^Image generation failed: .*no image/i);
    });

    it('reports a cancellation instead of an error when the signal fires during the request', async () => {
      const ws = createWorkspace();
      const controller = new AbortController();
      const { generateImage } = useOpenAiClient();
      generateImage.mockImplementation(async () => {
        controller.abort();
        throw new Error('Request was aborted.');
      });

      const result = await executeImageGeneration(
        { prompt: 'a red cat' },
        imagesProvider,
        ws,
        undefined,
        controller.signal
      );

      expect(result).toEqual({ success: false, text: 'Image generation was cancelled.', error: 'cancelled' });
    });

    it('reports a cancellation when the signal fires during an input download', async () => {
      const ws = createWorkspace();
      const controller = new AbortController();
      const { editImage } = useOpenAiClient();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
              controller.abort();
            })
        )
      );

      const result = await executeImageGeneration(
        { prompt: 'x', image_uris: ['https://img.example.com/slow.png'] },
        imagesProvider,
        ws,
        undefined,
        controller.signal
      );

      expect(result.error).toBe('cancelled');
      expect(editImage).not.toHaveBeenCalled();
    });

    it('explains that the provider must speak the OpenAI protocol when it resolves to another client', async () => {
      const ws = createWorkspace();
      const createChatCompletion = vi.fn();
      vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue({
        createChatCompletion,
      } as unknown as RotatingClient);

      const result = await executeImageGeneration(
        { prompt: 'a red cat' },
        { ...imagesProvider, platform: 'gemini' },
        ws
      );

      expect(result.success).toBe(false);
      expect(result.text).toMatch(/^Image generation failed: .*OpenAI-compatible/);
      expect(createChatCompletion).not.toHaveBeenCalled();
    });

    it('still validates the workspace directory first', async () => {
      const { createRotatingClient } = useOpenAiClient();

      const result = await executeImageGeneration({ prompt: 'a red cat' }, imagesProvider, '/nonexistent/workspace');

      expect(result.text).toContain('not found');
      expect(createRotatingClient).not.toHaveBeenCalled();
    });
  });

  describe('client selection', () => {
    it.each(['openai', 'custom', 'OpenAI'])('resolves a %s provider to the OpenAI client', async (platform) => {
      const client = await ClientFactory.createRotatingClient({ ...imagesProvider, platform });

      expect(client).toBeInstanceOf(OpenAIRotatingClient);
    });
  });
});

describe('executeImageGeneration against an OpenAI-compatible relay', () => {
  type RelayRequest = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

  /** A relay that records what the real OpenAI SDK sends and always answers with the given image. */
  async function startRelay(requests: RelayRequest[]): Promise<TProviderWithModel> {
    const port = await listen(
      http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          requests.push({
            method: req.method ?? '',
            url: req.url ?? '',
            headers: req.headers,
            body: Buffer.concat(chunks),
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG_BASE64 }] }));
        });
      })
    );
    return { ...imagesProvider, base_url: `http://127.0.0.1:${port}/v1` };
  }

  it('posts a JSON generation request that carries only the model, the prompt and n', async () => {
    const ws = createWorkspace();
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    const result = await executeImageGeneration({ prompt: 'a red cat' }, provider, ws);

    expect(result.success).toBe(true);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(['POST /v1/images/generations']);
    expect(JSON.parse(requests[0].body.toString())).toStrictEqual({ model: 'gpt-image-1', prompt: 'a red cat', n: 1 });
  });

  it('authenticates with the configured key', async () => {
    const ws = createWorkspace();
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    await executeImageGeneration({ prompt: 'a red cat' }, provider, ws);

    expect(requests[0].headers.authorization).toBe('Bearer sk-test');
  });

  it('posts a multipart edit request with one image[] part per input image, typed by its format', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'a.png');
    createImageFile(ws, 'b.jpg');
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    const result = await executeImageGeneration({ prompt: 'merge them', image_uris: ['a.png', 'b.jpg'] }, provider, ws);

    const body = requests[0].body.toString('latin1');
    expect(result.success).toBe(true);
    expect(`${requests[0].method} ${requests[0].url}`).toBe('POST /v1/images/edits');
    expect(requests[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(body).toMatch(/name="image\[\]"; filename="image-1\.png"\r\nContent-Type: image\/png/);
    expect(body).toMatch(/name="image\[\]"; filename="image-2\.jpg"\r\nContent-Type: image\/jpeg/);
  });

  it('sends the model and prompt as plain form fields of the edit request', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'a.png');
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, provider, ws);

    const body = requests[0].body.toString('latin1');
    expect(body).toMatch(/name="model"\r\n\r\ngpt-image-1\r\n/);
    expect(body).toMatch(/name="prompt"\r\n\r\nadd a hat\r\n/);
  });

  it('sends a single input image as the plain image field', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'a.png');
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, provider, ws);

    expect(requests[0].body.toString('latin1')).toMatch(/name="image"; filename="image-1\.png"/);
  });

  it('uploads the exact bytes of the input image', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'a.png');
    const requests: RelayRequest[] = [];
    const provider = await startRelay(requests);

    await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, provider, ws);

    expect(requests[0].body.includes(PNG_1x1)).toBe(true);
  });
});

const chatReply = (content: string, images?: Array<{ type: 'image_url'; image_url: { url: string } }>) => ({
  id: 'chat',
  object: 'chat.completion',
  created: 1,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content, images }, finish_reason: 'stop' }],
});

describe('executeImageGeneration with a chat-completions image model', () => {
  it('keeps generating through chat completions for a Gemini image model', async () => {
    const ws = createWorkspace();
    const client = new OpenAIRotatingClient('sk-test');
    const createChatCompletion = vi
      .spyOn(client, 'createChatCompletion')
      .mockResolvedValue(
        chatReply('Here is your cat.', [{ type: 'image_url', image_url: { url: DATA_URL_PNG } }]) as never
      );
    vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue(client);

    const result = await executeImageGeneration({ prompt: 'a red cat' }, geminiProvider, ws);

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(`Here is your cat.\n\nGenerated image saved to: ${result.imagePath}`);
    expect(readFileSync(result.imagePath!).equals(PNG_1x1)).toBe(true);
  });

  it('sends the enhanced prompt and the image parts the chat path always sent', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'a.png');
    const client = new OpenAIRotatingClient('sk-test');
    const createChatCompletion = vi
      .spyOn(client, 'createChatCompletion')
      .mockResolvedValue(chatReply('Done.', [{ type: 'image_url', image_url: { url: DATA_URL_PNG } }]) as never);
    vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue(client);

    await executeImageGeneration({ prompt: 'add a hat', image_uris: ['a.png'] }, geminiProvider, ws);

    const [params] = createChatCompletion.mock.calls[0];
    const parts = (params.messages[0] as { content: Array<{ type: string; text?: string }> }).content;
    expect(params.model).toBe('gemini-2.5-flash-image');
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(parts[0].text).toBe('Analyze/Edit image: add a hat');
  });

  it('keeps using chat completions for a chat-style model that merely has image in its name', async () => {
    const ws = createWorkspace();
    const client = new OpenAIRotatingClient('sk-test');
    const createChatCompletion = vi
      .spyOn(client, 'createChatCompletion')
      .mockResolvedValue(chatReply('Here.', [{ type: 'image_url', image_url: { url: DATA_URL_PNG } }]) as never);
    const generateImage = vi.spyOn(client, 'generateImage');
    vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue(client);

    await executeImageGeneration({ prompt: 'a red cat' }, { ...imagesProvider, use_model: 'openai/gpt-5-image' }, ws);

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('still reports a chat completion error with the original wording', async () => {
    const ws = createWorkspace();
    const client = new OpenAIRotatingClient('sk-test');
    vi.spyOn(client, 'createChatCompletion').mockRejectedValue(new Error('500 upstream exploded'));
    vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue(client);

    const result = await executeImageGeneration({ prompt: 'a red cat' }, geminiProvider, ws);

    expect(result.text).toBe('Error generating image: 500 upstream exploded');
  });
});
