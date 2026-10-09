/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist for built-in image generation tool.
 *
 * The tool supports two request styles:
 * - "form B": OpenAI chat completions multimodal output (the model returns images
 *   via `message.images` or markdown) — Gemini / OpenRouter / Antigravity.
 * - "form A": the OpenAI Images API (`/v1/images/generations` and `/v1/images/edits`)
 *   — `gpt-image-*` and `dall-e-*` models on OpenAI-protocol providers.
 *
 * It does NOT support async/polling image APIs.
 *
 * Model selection therefore must be a platform+model allowlist of providers
 * known to work, rather than a coarse name-substring match. Otherwise users
 * see options like `sd-3.5` in the dropdown that are guaranteed to fail at runtime.
 *
 * The form B rules below mirror `useConfigModelListWithImage.ts` — the same
 * providers we auto-supplement with default image models.
 */

type ProviderShape = {
  platform?: string;
  base_url?: string;
  name?: string;
  /** Per-model protocol overrides (new-api gateways): model name -> protocol. */
  model_protocols?: Record<string, string>;
};

/**
 * `gpt-image-*` and `dall-e-*`, optionally behind a vendor prefix (`openai/gpt-image-1`). The last path
 * segment has to start with the family name, so `my-gpt-image-1` and the chat model `openai/gpt-5-image` do not match.
 */
const OPENAI_IMAGES_MODEL_PATTERN = /^(?:[^/]+\/)*(?:gpt-image|dall-e)-/i;

const IMAGE_NAME_PATTERN = /(image|banana|imagine)/i;

const RULES: Array<{
  id: string;
  match: (provider: ProviderShape) => boolean;
}> = [
  {
    id: 'gemini',
    match: (p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai',
  },
  {
    id: 'openrouter',
    match: (p) => !!p.base_url?.includes('openrouter.ai'),
  },
  {
    id: 'antigravity',
    match: (p) => !!p.name?.toLowerCase().includes('antigravity'),
  },
];

/** Whether the model is served by the OpenAI Images API (`gpt-image-*`, `dall-e-*`), with or without a vendor prefix. */
export const isOpenAiImagesModel = (modelName: string): boolean => OPENAI_IMAGES_MODEL_PATTERN.test(modelName);

/** OpenAI-protocol provider: the `openai` / `custom` platforms, or a gateway that maps this model to `openai`. */
const speaksOpenAiProtocol = (provider: ProviderShape, modelName: string): boolean => {
  const platform = provider.platform?.toLowerCase();
  if (platform === 'openai' || platform === 'custom') return true;
  return provider.model_protocols?.[modelName]?.toLowerCase() === 'openai';
};

export const isImageGenSupported = (provider: ProviderShape, modelName: string): boolean => {
  // Checked first: `dall-e-*` names carry no "image", so IMAGE_NAME_PATTERN would turn them away.
  if (isOpenAiImagesModel(modelName) && speaksOpenAiProtocol(provider, modelName)) return true;
  if (!IMAGE_NAME_PATTERN.test(modelName)) return false;
  return RULES.some((rule) => rule.match(provider));
};
