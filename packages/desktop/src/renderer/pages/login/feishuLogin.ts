/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Full-page navigation target; the backend redirects on to Feishu. */
export const FEISHU_START_PATH = '/api/auth/feishu/start';

const KNOWN_ERRORS = new Set([
  'disabled',
  'state',
  'cancelled',
  'tenant',
  'account_disabled',
  'pending',
  'upstream',
  'server',
]);

export type FeishuLoginStatus = { enabled: boolean; publicBaseUrl: string | null };

const DISABLED: FeishuLoginStatus = { enabled: false, publicBaseUrl: null };

/** Give up on the status check after this long and fall back to the password form. */
export const FEISHU_STATUS_TIMEOUT_MS = 5000;

/**
 * Public, pre-login check. Uses plain fetch (not httpBridge) so a failure
 * never triggers the session-refresh path or error logging noise.
 */
export async function fetchFeishuLoginStatus(timeoutMs = FEISHU_STATUS_TIMEOUT_MS): Promise<FeishuLoginStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/auth/feishu/status', { credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) return DISABLED;
    const body = (await response.json()) as { data?: { enabled?: boolean; public_base_url?: string | null } };
    if (body.data?.enabled !== true) return DISABLED;
    return { enabled: true, publicBaseUrl: body.data.public_base_url || null };
  } catch {
    return DISABLED;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the button navigates. The state cookie has to live on the configured
 * site, so a page served from another address (LAN IP, alias domain) starts
 * the flow on the site URL instead.
 */
export function feishuStartUrl(publicBaseUrl: string | null, currentOrigin: string): string {
  if (!publicBaseUrl) return FEISHU_START_PATH;
  try {
    if (new URL(publicBaseUrl).origin === currentOrigin) return FEISHU_START_PATH;
  } catch {
    return FEISHU_START_PATH;
  }
  return `${publicBaseUrl.replace(/\/+$/, '')}${FEISHU_START_PATH}`;
}

/** i18n key for a `feishu_error` value from the callback redirect. */
export function feishuErrorKey(code: string | null): string | null {
  if (!code) return null;
  return KNOWN_ERRORS.has(code) ? `login.feishu.errors.${code}` : 'login.feishu.errors.unknown';
}

/** Leaves the app for the Feishu authorization page (full-page navigation). */
export function startFeishuLogin(status: FeishuLoginStatus): void {
  window.location.assign(feishuStartUrl(status.publicBaseUrl, window.location.origin));
}
