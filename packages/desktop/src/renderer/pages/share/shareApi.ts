import type { TMessage } from '@/common/chat/chatLib';
import type { IConversationArtifact, MessageCursorPage } from '@/common/adapter/ipcBridge';

export type SharedConversation = { id: string; name: string; type: string; created_at: number; modified_at: number };
export type ShareState = { enabled: boolean; token: string | null };
export type FeishuBinding = { chat_id: string; chat_type: 'p2p' | 'group'; bound_at: number };
export type FeishuBindingCode = { bind_code: string; expires_at: number };

/** Keep public requests separate from the authenticated bridge and its refresh handling. */
async function publicGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'X-Share-Token': token },
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) throw new Error(`Share unavailable (${response.status})`);
  const body = (await response.json()) as { success?: boolean; data?: T };
  if (body.success === false || !body.data) throw new Error('Share unavailable');
  return body.data;
}

export function readPublicShare(token: string, signal?: AbortSignal): Promise<SharedConversation> {
  return publicGet('/api/public/shares/current', token, signal);
}

export function readPublicMessages(
  token: string,
  before?: string,
  signal?: AbortSignal
): Promise<MessageCursorPage<TMessage>> {
  const query = new URLSearchParams({ limit: '100' });
  if (before) query.set('before', before);
  return publicGet(`/api/public/shares/current/messages?${query}`, token, signal);
}

export function publicResourceUrl(_token: string, path: string, download = false): string {
  return `/api/public/shares/current/resources?path=${encodeURIComponent(path)}${download ? '&download=true' : ''}`;
}

export function buildShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/#/share/${encodeURIComponent(token)}`;
}

/** Read the Core double-submit cookie for management requests. */
export function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('aionui-csrf-token='));
  if (!value) return '';
  try {
    return decodeURIComponent(value.slice('aionui-csrf-token='.length));
  } catch {
    return '';
  }
}

/** Existing authenticated sessions may not have visited the login bootstrap. */
export async function ensureCsrfCookie(): Promise<void> {
  if (readCsrfCookie()) return;
  const response = await fetch('/api/auth/feishu/status', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || !readCsrfCookie()) throw new Error('CSRF token unavailable');
}

/** Read resources with the bearer token in a header, never in a URL or access log. */
export async function readPublicResource(
  token: string,
  path: string,
  download: boolean,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(publicResourceUrl(token, path, download), {
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'X-Share-Token': token },
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) throw new Error(`Share resource unavailable (${response.status})`);
  return response.blob();
}

export function readPublicArtifacts(token: string, signal?: AbortSignal): Promise<IConversationArtifact[]> {
  return publicGet('/api/public/shares/current/artifacts', token, signal);
}
