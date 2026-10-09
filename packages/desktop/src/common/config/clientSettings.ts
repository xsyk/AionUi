import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';

export type GoogleClientSetting = {
  proxy?: string;
};

/**
 * The per-user image generation preference (`tools.imageGenerationModel`). Superseded by the server-wide
 * {@link ImageGenerationSettings}; kept only for the legacy migrations that still read the old value.
 */
export type ImageGenerationModelSetting = TProviderWithModel & {
  switch?: boolean;
};

/**
 * The image generation model, one setting for the whole server (`/api/settings/image-generation`).
 * The super admin chooses it and the backend adds the image generation MCP server to every session.
 */
export type ImageGenerationSettings = {
  /** Provider that serves the image model, or null while none is chosen. */
  provider_id: string | null;
  /** Image model of that provider, or null while none is chosen. */
  model: string | null;
  /** Whether sessions get the image generation tool. Needs a model. */
  enabled: boolean;
  /** Whether this server has the image generation MCP script installed; read-only. */
  supported: boolean;
};

export type ImageGenerationSettingsUpdate = Omit<ImageGenerationSettings, 'supported'>;

export type ClientBusinessSettingMap = {
  'google.config': GoogleClientSetting;
  'mcp.config': IMcpServer[] | undefined;
  /**
   * @deprecated Superseded by the shared `/api/settings/image-generation` setting in 1.0.1
   * ({@link ImageGenerationSettings}); still read by the desktop migration only.
   */
  'tools.imageGenerationModel': ImageGenerationModelSetting | undefined;
  'tools.speechToText': SpeechToTextConfig | undefined;
  'acp.promptTimeout': number | undefined;
  'acp.agentIdleTimeout': number | undefined;
  /**
   * Preview size ceiling for text-like files, **in whole megabytes**.
   *
   * Stored in MB rather than bytes because that is the unit the settings field
   * presents; the byte conversion belongs to the one place that compares against a
   * file size (`resolvePreviewPayload`). Keeping the stored unit and the displayed
   * unit identical means a value read back from storage never has to be
   * reinterpreted.
   *
   * `undefined` means "never configured" and falls back to the built-in default —
   * distinct from any number the user could enter.
   */
  'preview.textSizeLimitMb': number | undefined;
};

export type ClientBusinessSettingKey = keyof ClientBusinessSettingMap;
