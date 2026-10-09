/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isImageGenSupported, isOpenAiImagesModel } from '@/common/utils/imageModelAllowlist';

describe('isImageGenSupported', () => {
  it('accepts native Gemini image models', () => {
    const provider = { platform: 'gemini', name: 'Gemini' };
    expect(isImageGenSupported(provider, 'gemini-2.5-flash-image-preview')).toBe(true);
  });

  it('accepts Vertex AI Gemini image models', () => {
    const provider = { platform: 'gemini-vertex-ai', name: 'Vertex AI' };
    expect(isImageGenSupported(provider, 'gemini-2.5-flash-image')).toBe(true);
  });

  it('accepts OpenRouter image chat models via base_url', () => {
    const provider = { platform: 'custom', base_url: 'https://openrouter.ai/api/v1', name: 'OpenRouter' };
    expect(isImageGenSupported(provider, 'google/gemini-2.5-flash-image-preview')).toBe(true);
    expect(isImageGenSupported(provider, 'nano-banana')).toBe(true);
  });

  it('accepts AntigravityTools by name', () => {
    const provider = { platform: 'custom', name: 'AntigravityTools' };
    expect(isImageGenSupported(provider, 'gemini-3-pro-image-1x1')).toBe(true);
  });

  it('rejects models without an image-style suffix even on supported providers', () => {
    const provider = { platform: 'gemini', name: 'Gemini' };
    expect(isImageGenSupported(provider, 'gemini-2.5-pro')).toBe(false);
  });

  it('rejects image-style names on providers that are not on the allowlist', () => {
    const provider = { platform: 'custom', base_url: 'https://api.stability.ai', name: 'Stability AI' };
    expect(isImageGenSupported(provider, 'stable-image-ultra')).toBe(false);
    expect(isImageGenSupported(provider, 'sd-3.5-image')).toBe(false);
  });

  it('rejects unknown providers regardless of model name', () => {
    const provider = { platform: 'custom', base_url: 'https://api.stability.ai', name: 'Stability AI' };
    expect(isImageGenSupported(provider, 'sd3.5-large')).toBe(false);
  });
});

describe('isOpenAiImagesModel', () => {
  it.each(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-2.5-flare', 'dall-e-2', 'dall-e-3'])(
    'recognises %s',
    (model) => {
      expect(isOpenAiImagesModel(model)).toBe(true);
    }
  );

  it('ignores letter case', () => {
    expect(isOpenAiImagesModel('GPT-Image-1')).toBe(true);
    expect(isOpenAiImagesModel('DALL-E-3')).toBe(true);
  });

  it.each(['openai/gpt-image-1', 'openai/dall-e-3', 'vendor/team/gpt-image-1'])(
    'recognises the vendor-prefixed name %s',
    (model) => {
      expect(isOpenAiImagesModel(model)).toBe(true);
    }
  );

  it.each([
    'gpt-4o',
    'gpt-5-image',
    'openai/gpt-5-image',
    'gemini-2.5-flash-image',
    'nano-banana',
    'my-gpt-image-1',
    'sd3.5-large',
    '',
  ])('rejects %s', (model) => {
    expect(isOpenAiImagesModel(model)).toBe(false);
  });
});

describe('isImageGenSupported for OpenAI Images API models', () => {
  it('accepts gpt-image models on the openai platform', () => {
    const provider = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };
    expect(isImageGenSupported(provider, 'gpt-image-1')).toBe(true);
  });

  it('accepts dall-e models even though their names do not contain "image"', () => {
    const provider = { platform: 'openai', name: 'OpenAI' };
    expect(isImageGenSupported(provider, 'dall-e-3')).toBe(true);
  });

  it('accepts gpt-image models on OpenAI-compatible custom providers', () => {
    const provider = { platform: 'custom', base_url: 'https://relay.example.com/v1', name: 'Relay' };
    expect(isImageGenSupported(provider, 'gpt-image-2.5-flare')).toBe(true);
  });

  it('accepts a vendor-prefixed model name on a custom provider', () => {
    const provider = { platform: 'custom', base_url: 'https://relay.example.com/v1', name: 'Relay' };
    expect(isImageGenSupported(provider, 'openai/gpt-image-1')).toBe(true);
  });

  it('ignores letter case in the platform', () => {
    expect(isImageGenSupported({ platform: 'OpenAI' }, 'gpt-image-1')).toBe(true);
    expect(isImageGenSupported({ platform: 'Custom' }, 'gpt-image-1')).toBe(true);
  });

  it('accepts a model that the provider maps to the openai protocol', () => {
    const provider = { platform: 'new-api', name: 'Gateway', model_protocols: { 'gpt-image-1': 'openai' } };
    expect(isImageGenSupported(provider, 'gpt-image-1')).toBe(true);
  });

  it('rejects a model that the provider maps to another protocol', () => {
    const provider = { platform: 'new-api', name: 'Gateway', model_protocols: { 'gpt-image-1': 'gemini' } };
    expect(isImageGenSupported(provider, 'gpt-image-1')).toBe(false);
  });

  it('rejects the model when only another model of the provider has the openai protocol', () => {
    const provider = { platform: 'new-api', name: 'Gateway', model_protocols: { 'gpt-4o': 'openai' } };
    expect(isImageGenSupported(provider, 'gpt-image-1')).toBe(false);
  });

  it('rejects gpt-image models on providers that do not speak the OpenAI protocol', () => {
    expect(isImageGenSupported({ platform: 'anthropic', name: 'Anthropic' }, 'gpt-image-1')).toBe(false);
    expect(isImageGenSupported({ platform: 'anthropic', name: 'Anthropic' }, 'dall-e-3')).toBe(false);
  });

  it('rejects OpenAI models that are not image models', () => {
    const provider = { platform: 'openai', name: 'OpenAI' };
    expect(isImageGenSupported(provider, 'gpt-4o')).toBe(false);
  });
});
