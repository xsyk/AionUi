/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Full-page navigation target; the backend redirects on to Feishu. */
export const FEISHU_START_URL = '/api/auth/feishu/start';

const KNOWN_ERRORS = new Set(['disabled', 'state', 'cancelled', 'tenant', 'account_disabled', 'upstream', 'server']);

/**
 * Public, pre-login check. Uses plain fetch (not httpBridge) so a failure
 * never triggers the session-refresh path or error logging noise.
 */
export async function fetchFeishuLoginEnabled(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/feishu/status', { credentials: 'same-origin' });
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { enabled?: boolean } };
    return body.data?.enabled === true;
  } catch {
    return false;
  }
}

/** i18n key for a `feishu_error` value from the callback redirect. */
export function feishuErrorKey(code: string | null): string | null {
  if (!code) return null;
  return KNOWN_ERRORS.has(code) ? `login.feishu.errors.${code}` : 'login.feishu.errors.unknown';
}
