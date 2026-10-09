/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared image generation logic used by both:
 * - The built-in MCP server (imageGenServer.ts)
 * - The legacy Gemini-specific tool (img-gen.ts)
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import { jsonrepair } from 'jsonrepair';
import type OpenAI from 'openai';
import { toFile } from 'openai';
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import type { TProviderWithModel } from '@/common/config/storage';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, MIME_TO_EXT_MAP, DEFAULT_IMAGE_EXTENSION } from '@/common/config/constants';
import { isOpenAiImagesModel } from '@/common/utils/imageModelAllowlist';

const API_TIMEOUT_MS = 120000; // 2 minutes for image generation API calls
const DEFAULT_IMAGE_DESCRIPTION = 'Image generated successfully.';

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

// ===== Path Boundary Helpers =====

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/**
 * Resolve `candidate` against `workspaceDir` and verify the result stays inside
 * the workspace. A lexical containment check always applies; when the target
 * exists, it is additionally canonicalized with `realpath` so symlinks inside
 * the workspace cannot escape to arbitrary files outside it. Missing targets
 * resolve lexically — the caller's existence check reports "not found".
 */
const resolveSafePath = async (workspaceDir: string, candidate: string): Promise<string> => {
  const resolved = path.resolve(workspaceDir, candidate);
  if (!isWithin(workspaceDir, resolved)) {
    throw new Error(`Path traversal blocked: "${candidate}" resolves outside workspace`);
  }

  const realWorkspaceDir = await fs.promises.realpath(workspaceDir);
  let realTarget: string;
  try {
    realTarget = await fs.promises.realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved;
    }
    throw error;
  }
  if (!isWithin(realWorkspaceDir, realTarget)) {
    throw new Error(`Path traversal blocked: "${candidate}" resolves outside workspace`);
  }
  return realTarget;
};

// ===== Utility Functions =====

export function safeJsonParse<T = unknown>(jsonString: string, fallbackValue: T): T {
  if (!jsonString || typeof jsonString !== 'string') {
    return fallbackValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (_error) {
    try {
      const repairedJson = jsonrepair(jsonString);
      return JSON.parse(repairedJson) as T;
    } catch (_repairError) {
      console.warn('[ImageGen] JSON parse failed:', jsonString.substring(0, 50));
      return fallbackValue;
    }
  }
}

export function isImageFile(file_path: string): boolean {
  const ext = path.extname(file_path).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext as ImageExtension);
}

export function isHttpUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

export async function fileToBase64(file_path: string): Promise<string> {
  try {
    const fileBuffer = await fs.promises.readFile(file_path);
    return fileBuffer.toString('base64');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      throw new Error(`Image file not found: ${file_path}`, { cause: error });
    }
    throw new Error(`Failed to read image file: ${errorMessage}`, { cause: error });
  }
}

export function getImageMimeType(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return MIME_TYPE_MAP[ext] || MIME_TYPE_MAP[DEFAULT_IMAGE_EXTENSION];
}

export function getFileExtensionFromDataUrl(dataUrl: string): string {
  const mimeTypeMatch = dataUrl.match(/^data:image\/([^;]+);base64,/);
  if (mimeTypeMatch && mimeTypeMatch[1]) {
    const mimeType = mimeTypeMatch[1].toLowerCase();
    return MIME_TO_EXT_MAP[mimeType] || DEFAULT_IMAGE_EXTENSION;
  }
  return DEFAULT_IMAGE_EXTENSION;
}

export async function saveGeneratedImage(base64Data: string, workspaceDir: string): Promise<string> {
  const timestamp = Date.now();
  const fileExtension = getFileExtensionFromDataUrl(base64Data);
  const file_name = `img-${timestamp}${fileExtension}`;
  const resolvedDir = path.resolve(workspaceDir);
  const file_path = path.join(resolvedDir, file_name);

  const base64WithoutPrefix = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
  const imageBuffer = Buffer.from(base64WithoutPrefix, 'base64');

  try {
    await fs.promises.writeFile(file_path, imageBuffer);
    return file_path;
  } catch (error) {
    console.error('[ImageGen] Failed to save image file:', error);
    throw new Error(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

// ===== Image Content Processing =====

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'low' | 'high';
  };
}

export async function processImageUri(imageUri: string, workspaceDir: string): Promise<ImageContent | null> {
  if (isHttpUrl(imageUri)) {
    return {
      type: 'image_url',
      image_url: { url: imageUri, detail: 'auto' },
    };
  }

  let processedUri = imageUri;
  if (imageUri.startsWith('@')) {
    processedUri = imageUri.substring(1);
  }

  const fullPath = await resolveSafePath(workspaceDir, processedUri);

  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);

    if (!isImageFile(fullPath)) {
      throw new Error(`File is not a supported image type: ${fullPath}`);
    }

    const base64Data = await fileToBase64(fullPath);
    const mimeType = getImageMimeType(fullPath);
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'auto' },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('Path traversal blocked') ||
      errorMessage.includes('Image file not found') ||
      errorMessage.includes('not a supported image type')
    ) {
      throw error;
    }

    const possiblePaths = [imageUri, path.resolve(workspaceDir, imageUri)].filter((p, i, arr) => arr.indexOf(p) === i);
    throw new Error(
      `Image file not found. Searched paths:\n${possiblePaths.map((p) => `- ${p}`).join('\n')}\n\nPlease ensure the image file exists and has a valid image extension (.jpg, .png, .gif, .webp, etc.)`,
      { cause: error }
    );
  }
}

// ===== Core Execution =====

export interface ImageGenParams {
  prompt: string;
  image_uris?: string[] | string;
}

export interface ImageGenResult {
  success: boolean;
  text: string;
  imagePath?: string;
  relativeImagePath?: string;
  error?: string;
}

/** Resolves every requested image. Unreadable ones are listed in `errors` and do not fail the others. */
async function processImageUris(
  imageUris: string[],
  workspaceDir: string
): Promise<{ images: ImageContent[]; errors: string[] }> {
  const imageResults = await Promise.allSettled(imageUris.map((uri) => processImageUri(uri, workspaceDir)));

  const images: ImageContent[] = [];
  const errors: string[] = [];

  imageResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      images.push(result.value);
    } else {
      const error = result.status === 'rejected' ? result.reason : 'Unknown error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Image ${index + 1} (${imageUris[index]}): ${errorMessage}`);
    }
  });

  return { images, errors };
}

const failedToProcessImages = (errors: string[]): ImageGenResult => ({
  success: false,
  text: `Error: Failed to process any images. Errors:\n${errors.join('\n')}`,
  error: errors.join('\n'),
});

// ===== OpenAI Images API ("form A": gpt-image-*, dall-e-*) =====

/** An edit request takes at most 16 input images (gpt-image-1's documented limit). */
const MAX_INPUT_IMAGES = 16;
/** gpt-image takes input images of up to 50MB each; anything bigger is not worth holding in memory. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const BASE64_DATA_URL_PREFIX = /^data:([^;,]+);base64,/;
/** Sent on every download, whichever route it takes: Node's fetch would add headers of its own, http.get none. */
const DOWNLOAD_HEADERS = { 'User-Agent': 'AionUi', Accept: 'image/*,*/*;q=0.8' };

type LoadedImage = { data: Buffer; mimeType: string };
type RawDownload = { data: Buffer; contentType: string | undefined };
/**
 * How downloads are made: through `proxy` when set, abandoned when `signal` fires, and with every URL it requests
 * (the first one and each redirect) handed to `assertAllowedUrl` beforehand.
 */
type DownloadOptions = { proxy?: string; signal?: AbortSignal; assertAllowedUrl?: (url: string) => void };

/**
 * An image URL that was refused, could not be fetched, or did not serve an image. Kept apart from the errors of the
 * Images API itself so that the failure log can say which of the two it was.
 */
class ImageSourceError extends Error {
  override name = 'ImageSourceError';
}

// ----- Where an input URL may point -----

/** Loopback, "this host", link-local and private ranges. IPv4-mapped IPv6 addresses are matched by the IPv4 rules. */
const PRIVATE_NETWORKS = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv4');
}
PRIVATE_NETWORKS.addAddress('::', 'ipv6');
PRIVATE_NETWORKS.addAddress('::1', 'ipv6');
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_NETWORKS.addSubnet('fe80::', 10, 'ipv6');

/**
 * Whether `hostname`, as `new URL()` reports it, is localhost or a private literal address. That is a name, a dotted
 * IPv4 address (the URL parser also turns 2130706433 or 0x7f.1 into one) or a bracketed IPv6 address.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const family = net.isIP(address);
  return family !== 0 && PRIVATE_NETWORKS.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Input URLs are the model's choice, so they must not be a way to make this process request services on its own
 * network (cloud metadata, admin pages, ...). Only the literal host is looked at, nothing is resolved. Not applied to
 * the URL the provider answers with: a self-hosted relay can legitimately sit on a private address.
 */
function assertPublicImageUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch (error) {
    throw new ImageSourceError(`Invalid image URL: ${url}`, { cause: error });
  }
  if (isPrivateHost(hostname)) {
    throw new ImageSourceError(
      `Refusing to download from ${hostname}: input image URLs must not point to localhost, loopback, link-local or private network addresses. Save the image into the workspace and pass its file path instead.`
    );
  }
}

// ----- Telling images from everything else -----

/** The size field of a BMP's DIB header, which follows the 14-byte file header, has one of these values. */
const BMP_DIB_HEADER_SIZES: ReadonlySet<number> = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/** The type the first bytes say this is, for the formats the Images API and this tool deal with. */
function sniffImageMimeType(data: Buffer): string | undefined {
  const head = data.toString('latin1', 0, 12);
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.startsWith('WEBP', 8)) return 'image/webp';
  // "BM" alone is just two letters of text, so the header size has to fit as well
  if (head.startsWith('BM') && data.length >= 18 && BMP_DIB_HEADER_SIZES.has(data.readUInt32LE(14))) return 'image/bmp';
  if (head.startsWith('II*\x00') || head.startsWith('MM\x00*')) return 'image/tiff';
  return undefined;
}

/**
 * The MIME type of downloaded bytes, taken from their signature and from nothing else: neither the Content-Type the
 * server announced nor the extension of the URL can make something an image.
 */
function requireImageMimeType(data: Buffer, announcedType: string | undefined): string {
  const mimeType = sniffImageMimeType(data);
  if (mimeType) {
    return mimeType;
  }
  const announced = announcedType?.split(';')[0].trim().toLowerCase();
  // The header is the server's to write and this message goes back to the model: only quote it if it is a media type
  const quoted =
    announced && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(announced) ? `the server announced ${announced}; ` : '';
  throw new Error(
    `The downloaded content is not an image (${quoted}supported formats: PNG, JPEG, GIF, WEBP, BMP, TIFF)`
  );
}

/** Collects a body stream, giving up as soon as it grows past MAX_IMAGE_BYTES. */
async function readBounded(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of body) {
    received += chunk.byteLength;
    if (received > MAX_IMAGE_BYTES) {
      throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const describeStatus = (status: number, statusText: string | undefined): string =>
  `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;

/** The statuses that fetch itself follows. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Where an answer to a request for `from` sends the client, or undefined when the answer is not a redirect.
 * Throws when the `Location` is unusable, or leads somewhere that is not http(s).
 */
function redirectTarget(status: number, location: string | null | undefined, from: string): string | undefined {
  if (!REDIRECT_STATUSES.has(status) || !location) {
    return undefined;
  }
  const target = new URL(location, from).toString();
  if (!isHttpUrl(target)) {
    throw new Error('Redirected to a URL that is not http(s)');
  }
  return target;
}

/** Redirects are followed here rather than by fetch itself, so that every hop passes `assertAllowedUrl` first. */
async function downloadWithFetch(
  url: string,
  signal: AbortSignal,
  assertAllowedUrl: DownloadOptions['assertAllowedUrl'],
  redirectsLeft: number
): Promise<RawDownload> {
  assertAllowedUrl?.(url);
  const response = await fetch(url, { signal, headers: DOWNLOAD_HEADERS, redirect: 'manual' });
  const next = redirectTarget(response.status, response.headers.get('location'), url);
  if (next) {
    await response.body?.cancel();
    if (redirectsLeft === 0) {
      throw new Error('Too many redirects');
    }
    return downloadWithFetch(next, signal, assertAllowedUrl, redirectsLeft - 1);
  }
  if (!response.ok) {
    throw new Error(describeStatus(response.status, response.statusText));
  }
  if (!response.body) {
    throw new Error('The server returned an empty response');
  }
  return {
    data: await readBounded(response.body as unknown as AsyncIterable<Uint8Array>),
    contentType: response.headers.get('content-type') ?? undefined,
  };
}

function requestThroughProxy(
  url: string,
  agent: http.Agent,
  signal: AbortSignal,
  assertAllowedUrl: DownloadOptions['assertAllowedUrl'],
  redirectsLeft: number
): Promise<RawDownload> {
  return new Promise<RawDownload>((resolve, reject) => {
    assertAllowedUrl?.(url);
    const transport = new URL(url).protocol === 'https:' ? https : http;
    const request = transport.get(url, { agent, signal, headers: DOWNLOAD_HEADERS }, (response) => {
      const status = response.statusCode ?? 0;
      let next: string | undefined;
      try {
        next = redirectTarget(status, response.headers.location, url);
      } catch (error) {
        // Thrown from an event callback this would be an uncaught exception, so hand it to the promise.
        response.resume();
        reject(error);
        return;
      }
      if (next) {
        response.resume();
        if (redirectsLeft === 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        resolve(requestThroughProxy(next, agent, signal, assertAllowedUrl, redirectsLeft - 1));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(describeStatus(status, response.statusMessage)));
        return;
      }
      readBounded(response).then((data) => resolve({ data, contentType: response.headers['content-type'] }), reject);
    });
    request.on('error', reject);
  });
}

/**
 * Node's global fetch cannot use an http.Agent, so when a proxy is configured the download goes through
 * https-proxy-agent (the same agent ClientFactory builds for the API client) with http(s).get instead.
 */
async function downloadThroughProxy(
  url: string,
  proxy: string,
  signal: AbortSignal,
  assertAllowedUrl: DownloadOptions['assertAllowedUrl']
): Promise<RawDownload> {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  return requestThroughProxy(url, new HttpsProxyAgent(proxy), signal, assertAllowedUrl, MAX_REDIRECTS);
}

/** Downloads an http(s) URL and checks that what came back is an image, whatever the server says it is. */
async function downloadImage(url: string, { proxy, signal, assertAllowedUrl }: DownloadOptions): Promise<LoadedImage> {
  if (!isHttpUrl(url)) {
    throw new Error('Only http(s) image URLs are supported');
  }

  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const { data, contentType } = proxy
    ? await downloadThroughProxy(url, proxy, requestSignal, assertAllowedUrl)
    : await downloadWithFetch(url, requestSignal, assertAllowedUrl, MAX_REDIRECTS);
  if (data.length === 0) {
    throw new Error('The server returned an empty response');
  }
  return { data, mimeType: requireImageMimeType(data, contentType) };
}

/**
 * Bytes and MIME type of a base64 data URL or an http(s) image URL. Downloads honour the caller's abort signal,
 * the API timeout, the proxy, and the size limit, and only ever yield bytes that are really an image.
 */
async function loadImageBytes(url: string, options: DownloadOptions): Promise<LoadedImage> {
  const inline = BASE64_DATA_URL_PREFIX.exec(url);
  if (inline) {
    return { mimeType: inline[1], data: Buffer.from(url.slice(inline[0].length), 'base64') };
  }
  try {
    return await downloadImage(url, options);
  } catch (error) {
    throw error instanceof ImageSourceError
      ? error
      : new ImageSourceError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/** An input image as the file the Images API edit endpoint wants. */
async function toUploadFile(image: ImageContent, index: number, download: DownloadOptions): Promise<File> {
  const { url } = image.image_url;
  let loaded: LoadedImage;
  try {
    loaded = await loadImageBytes(url, download);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const label = isHttpUrl(url) ? `Image ${index + 1} (${url})` : `Image ${index + 1}`;
    throw new ImageSourceError(`${label}: ${errorMessage}`, { cause: error });
  }
  const extension = MIME_TO_EXT_MAP[loaded.mimeType.replace(/^image\//, '')] ?? DEFAULT_IMAGE_EXTENSION;
  // The type has to be set: without it the file is sent as application/octet-stream, which the API refuses.
  return toFile(loaded.data, `image-${index + 1}${extension}`, { type: loaded.mimeType });
}

/** The generated (first) image of an Images API response as a data URL, downloading it when only a URL came back. */
async function imagesResponseToDataUrl(
  response: OpenAI.Images.ImagesResponse,
  download: DownloadOptions
): Promise<string> {
  const generated = response.data?.[0];
  if (generated?.b64_json) {
    // Some OpenAI-compatible gateways already return a full data URL here.
    return generated.b64_json.startsWith('data:')
      ? generated.b64_json
      : `data:image/${response.output_format ?? 'png'};base64,${generated.b64_json}`;
  }
  if (generated?.url) {
    const { data, mimeType } = await loadImageBytes(generated.url, download);
    return `data:${mimeType};base64,${data.toString('base64')}`;
  }
  throw new Error('The API response contained no image data');
}

type OpenAiImagesRequest = Pick<DownloadOptions, 'proxy' | 'signal'> & {
  prompt: string;
  imageUris: string[];
  provider: TProviderWithModel;
  workspaceDir: string;
};

/**
 * Generates (no input images) or edits (with input images) through the OpenAI Images API.
 * Neither `size` nor `response_format` is sent: gpt-image models reject `response_format` and always answer with
 * base64, dall-e models answer with a URL by default, so both kinds of answer are handled.
 */
async function executeOpenAiImagesGeneration({
  prompt,
  imageUris,
  provider,
  workspaceDir,
  proxy,
  signal,
}: OpenAiImagesRequest): Promise<ImageGenResult> {
  // Counted as requested, before anything is read, fetched or sent
  if (imageUris.length > MAX_INPUT_IMAGES) {
    const message = `Too many input images: ${imageUris.length} were given, but the OpenAI Images API accepts at most ${MAX_INPUT_IMAGES} per request`;
    return { success: false, text: `Image generation failed: ${message}`, error: message };
  }

  try {
    let inputImages: ImageContent[] = [];
    if (imageUris.length > 0) {
      const { images, errors } = await processImageUris(imageUris, workspaceDir);
      if (images.length === 0) {
        return failedToProcessImages(errors);
      }
      inputImages = images;
      // Every URL is checked before the first download starts, so one refused URL means no request at all
      for (const { image_url } of inputImages) {
        if (isHttpUrl(image_url.url)) {
          assertPublicImageUrl(image_url.url);
        }
      }
    }

    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
    });
    if (!(rotatingClient instanceof OpenAIRotatingClient)) {
      throw new Error(
        `"${provider.use_model}" is an OpenAI Images API model and needs an OpenAI-compatible provider, but platform "${provider.platform}" uses a different protocol`
      );
    }

    const requestOptions = { signal, timeout: API_TIMEOUT_MS };
    let response: OpenAI.Images.ImagesResponse;
    if (inputImages.length === 0) {
      response = await rotatingClient.generateImage({ model: provider.use_model, prompt, n: 1 }, requestOptions);
    } else {
      const inputDownload: DownloadOptions = { proxy, signal, assertAllowedUrl: assertPublicImageUrl };
      const files = await Promise.all(inputImages.map((image, index) => toUploadFile(image, index, inputDownload)));
      // One image goes as the plain `image` field every model accepts; several need the `image[]` form (gpt-image).
      response = await rotatingClient.editImage(
        { model: provider.use_model, prompt, image: files.length === 1 ? files[0] : files },
        requestOptions
      );
    }

    const dataUrl = await imagesResponseToDataUrl(response, { proxy, signal });
    const imagePath = await saveGeneratedImage(dataUrl, workspaceDir);
    const description = response.data?.[0]?.revised_prompt?.trim() || DEFAULT_IMAGE_DESCRIPTION;

    return {
      success: true,
      text: `${description}\n\nGenerated image saved to: ${imagePath}`,
      imagePath,
      relativeImagePath: path.relative(workspaceDir, imagePath),
    };
  } catch (error) {
    if (signal?.aborted) {
      return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failure =
      error instanceof ImageSourceError ? 'Image download or validation failed' : 'OpenAI Images API call failed';
    console.error(`[ImageGen] ${failure}:`, error);
    return { success: false, text: `Image generation failed: ${errorMessage}`, error: errorMessage };
  }
}

/**
 * Core image generation function shared between MCP server and Gemini tool.
 */
export async function executeImageGeneration(
  params: ImageGenParams,
  provider: TProviderWithModel,
  workspaceDir: string,
  proxy?: string,
  signal?: AbortSignal
): Promise<ImageGenResult> {
  if (signal?.aborted) {
    return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
  }

  // Resolve and validate workspaceDir once to prevent path traversal
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  // fs.realpath would reject if the directory does not exist, but we should
  // fail fast so the caller gets a clear error rather than a cascade.
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolvedWorkspaceDir);
  } catch {
    return {
      success: false,
      text: `Workspace directory not found: ${resolvedWorkspaceDir}`,
      error: `Workspace directory not found: ${resolvedWorkspaceDir}`,
    };
  }
  if (!stat.isDirectory()) {
    return {
      success: false,
      text: `Workspace path is not a directory: ${resolvedWorkspaceDir}`,
      error: `Workspace path is not a directory: ${resolvedWorkspaceDir}`,
    };
  }

  try {
    // Parse image URIs
    let imageUris: string[] = [];
    if (params.image_uris) {
      if (typeof params.image_uris === 'string') {
        const parsed = safeJsonParse<string[]>(params.image_uris, null);
        imageUris = Array.isArray(parsed) ? parsed : [params.image_uris];
      } else if (Array.isArray(params.image_uris)) {
        imageUris = params.image_uris;
      }
    }

    // gpt-image-* / dall-e-* are served by the Images API, everything else answers chat completions
    if (isOpenAiImagesModel(provider.use_model)) {
      return await executeOpenAiImagesGeneration({
        prompt: params.prompt,
        imageUris,
        provider,
        workspaceDir: resolvedWorkspaceDir,
        proxy,
        signal,
      });
    }

    const hasImages = imageUris.length > 0;
    let enhancedPrompt: string;
    if (hasImages) {
      enhancedPrompt = `Analyze/Edit image: ${params.prompt}`;
    } else {
      enhancedPrompt = `Generate image: ${params.prompt}`;
    }

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: enhancedPrompt }];

    // Process image URIs
    if (hasImages) {
      const { images: inputImages, errors } = await processImageUris(imageUris, resolvedWorkspaceDir);
      if (inputImages.length === 0) {
        return failedToProcessImages(errors);
      }
      contentParts.push(...inputImages);
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: contentParts }];

    // Create client and call API
    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
    });

    const completion: UnifiedChatCompletionResponse = await rotatingClient.createChatCompletion(
      { model: provider.use_model, messages: messages as any },
      { signal, timeout: API_TIMEOUT_MS }
    );

    const choice = completion.choices[0];
    if (!choice) {
      return { success: false, text: 'No response from image generation API', error: 'No response' };
    }

    const responseText = choice.message.content || DEFAULT_IMAGE_DESCRIPTION;
    let images = choice.message.images;

    // Extract images from markdown in content if not in images field
    if ((!images || images.length === 0) && responseText) {
      const dataUrlRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      const dataUrlMatches = [...responseText.matchAll(dataUrlRegex)];
      if (dataUrlMatches.length > 0) {
        images = dataUrlMatches.map((match) => ({
          type: 'image_url' as const,
          image_url: { url: match[1] },
        }));
      } else {
        const file_pathRegex = /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|svg))\)/gi;
        const file_pathMatches = [...responseText.matchAll(file_pathRegex)];
        if (file_pathMatches.length > 0) {
          const processedImages: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
          for (const match of file_pathMatches) {
            const file_path = match[1];
            try {
              const fullPath = await resolveSafePath(resolvedWorkspaceDir, file_path);
              await fs.promises.access(fullPath);
              const base64Data = await fileToBase64(fullPath);
              const mimeType = getImageMimeType(fullPath);
              processedImages.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
              });
            } catch (_fileError) {
              console.warn(`[ImageGen] Could not load image file: ${file_path}`);
            }
          }
          if (processedImages.length > 0) {
            images = processedImages;
          }
        }
      }
    }

    if (!images || images.length === 0) {
      const warningMessage = `Image generation did not produce any images.\n\nModel response: ${responseText}\n\nTip: Make sure your image generation model supports this type of request. Current model: ${provider.use_model}`;
      return { success: true, text: warningMessage };
    }

    const firstImage = images[0];
    if (firstImage.type === 'image_url' && firstImage.image_url?.url) {
      const imagePath = await saveGeneratedImage(firstImage.image_url.url, resolvedWorkspaceDir);
      const relativeImagePath = path.relative(resolvedWorkspaceDir, imagePath);

      // Strip any inline base64 data URLs from the human-readable text before
      // returning. The image is already saved to disk and referenced by path,
      // so re-emitting hundreds of MB of base64 in the MCP tool response just
      // forces the parent process to ship that payload through framed TCP again
      // (which is where the 2026-04-14 commit-charge blow-up happened).
      const cleanText = responseText.replace(
        /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]+\)/g,
        '[embedded image extracted]'
      );

      return {
        success: true,
        text: `${cleanText}\n\nGenerated image saved to: ${imagePath}`,
        imagePath,
        relativeImagePath,
      };
    }

    return { success: true, text: responseText };
  } catch (error) {
    if (signal?.aborted) {
      return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageGen] API call failed:`, error);
    return { success: false, text: `Error generating image: ${errorMessage}`, error: errorMessage };
  }
}
