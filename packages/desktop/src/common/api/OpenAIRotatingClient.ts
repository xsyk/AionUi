import OpenAI from 'openai';
import { AuthType } from '@/common/types/provider/authType';
import type { RotatingApiClientOptions } from './RotatingApiClient';
import { RotatingApiClient } from './RotatingApiClient';

export interface OpenAIClientConfig {
  baseURL?: string;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  httpAgent?: unknown;
}

export class OpenAIRotatingClient extends RotatingApiClient<OpenAI> {
  private readonly baseConfig: OpenAIClientConfig;

  constructor(api_keys: string, config: OpenAIClientConfig = {}, options: RotatingApiClientOptions = {}) {
    const createClient = (api_key: string) => {
      const cleanedApiKey = api_key.replace(/[\s\r\n\t]/g, '').trim();
      const openaiConfig: any = {
        baseURL: config.baseURL,
        apiKey: cleanedApiKey,
        defaultHeaders: config.defaultHeaders,
      };

      if (config.httpAgent) {
        openaiConfig.httpAgent = config.httpAgent;
      }

      return new OpenAI(openaiConfig);
    };

    super(api_keys, AuthType.USE_OPENAI, createClient, options);
    this.baseConfig = config;
  }

  protected getCurrentApiKey(): string | undefined {
    if (this.apiKeyManager?.hasMultipleKeys()) {
      // For OpenAI, try to get from environment first
      return process.env.OPENAI_API_KEY || this.apiKeyManager.getCurrentKey();
    }
    // Use base class method for single key
    return super.getCurrentApiKey();
  }

  // Convenience methods for common OpenAI operations
  async createChatCompletion(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return await this.executeWithRetry(async (client) => {
      const result = await client.chat.completions.create(params, options);
      return result as OpenAI.Chat.Completions.ChatCompletion;
    });
  }

  /**
   * Generates image(s) with the OpenAI Images API (`POST /images/generations`), with the same key rotation and
   * retries as {@link createChatCompletion}. Non-streaming only: the response is returned as `ImagesResponse`.
   */
  async generateImage(
    params: OpenAI.Images.ImageGenerateParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Images.ImagesResponse> {
    return await this.executeWithRetry(async (client) => {
      const result = await client.images.generate(params, options);
      return result as OpenAI.Images.ImagesResponse;
    });
  }

  /**
   * Edits image(s) with the OpenAI Images API (`POST /images/edits`), with the same key rotation and retries as
   * {@link createChatCompletion}. Non-streaming only. Pass files that can be read again (e.g. from `toFile`), as a
   * retry sends the request body once more.
   */
  async editImage(
    params: OpenAI.Images.ImageEditParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Images.ImagesResponse> {
    return await this.executeWithRetry(async (client) => {
      const result = await client.images.edit(params, options);
      return result as OpenAI.Images.ImagesResponse;
    });
  }

  /** Same as {@link generateImage}; kept for existing callers. */
  async createImage(
    params: OpenAI.Images.ImageGenerateParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Images.ImagesResponse> {
    return await this.generateImage(params, options);
  }

  async createEmbedding(
    params: OpenAI.Embeddings.EmbeddingCreateParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    return await this.executeWithRetry((client) => {
      return client.embeddings.create(params, options);
    });
  }
}
