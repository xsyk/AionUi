/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Super-admin endpoints (`/api/admin/*`). The backend authorizes them on the
 * real caller and rejects act-as, so `httpBridge` never attaches the act-as
 * header to these paths (see `shouldAttachActAs`).
 */

import { httpRequest } from '@/common/adapter/httpBridge';

export type AdminUser = {
  id: string;
  username: string;
  status: 'active' | 'disabled';
  created_at: number;
  last_login: number | null;
  is_super_admin: boolean;
  source: 'password' | 'feishu';
  email: string | null;
  avatar_url: string | null;
};

export type AdminConversation = {
  id: string;
  name: string;
  type: string;
  backend: string | null;
  updated_at: number;
  owner: { id: string; username: string; deleted: boolean };
};

export type FeishuSignupPolicy = 'approval' | 'open';

export type FeishuLoginConfig = {
  enabled: boolean;
  app_id: string;
  app_secret_set: boolean;
  tenant_key: string | null;
  public_base_url: string;
  api_base: string | null;
  accounts_base: string | null;
  callback_url: string;
  signup_policy: FeishuSignupPolicy;
};

export type FeishuLoginForm = {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  public_base_url: string;
  api_base: string;
  accounts_base: string;
  signup_policy: FeishuSignupPolicy;
};

const blankToNull = (value: string) => (value.trim() ? value.trim() : null);

/** PUT body for `/api/admin/feishu-login`; a blank secret is omitted so the stored one is kept. */
export function buildFeishuConfigPayload(form: FeishuLoginForm, clearTenantKey: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    enabled: form.enabled,
    app_id: form.app_id.trim(),
    public_base_url: form.public_base_url.trim(),
    api_base: blankToNull(form.api_base),
    accounts_base: blankToNull(form.accounts_base),
    signup_policy: form.signup_policy,
    clear_tenant_key: clearTenantKey,
  };
  if (form.app_secret.trim()) payload.app_secret = form.app_secret.trim();
  return payload;
}

/** A Feishu account that is disabled and has never signed in is waiting for approval. */
export function isPendingApproval(user: Pick<AdminUser, 'source' | 'status' | 'last_login'>): boolean {
  return user.source === 'feishu' && user.status === 'disabled' && !user.last_login;
}

const enc = encodeURIComponent;

export const adminApi = {
  listUsers: () => httpRequest<AdminUser[]>('GET', '/api/admin/users'),
  createUser: (username: string, password: string) =>
    httpRequest<AdminUser>('POST', '/api/admin/users', { username, password }),
  resetPassword: (id: string, password: string) =>
    httpRequest<void>('POST', `/api/admin/users/${enc(id)}/password`, { password }),
  disableUser: (id: string) => httpRequest<AdminUser>('POST', `/api/admin/users/${enc(id)}/disable`),
  enableUser: (id: string) => httpRequest<AdminUser>('POST', `/api/admin/users/${enc(id)}/enable`),
  deleteUser: (id: string) => httpRequest<void>('DELETE', `/api/admin/users/${enc(id)}`),
  getFeishuLogin: () => httpRequest<FeishuLoginConfig>('GET', '/api/admin/feishu-login'),
  saveFeishuLogin: (payload: Record<string, unknown>) =>
    httpRequest<FeishuLoginConfig>('PUT', '/api/admin/feishu-login', payload),
  listAllConversations: (limit = 500) =>
    httpRequest<AdminConversation[]>('GET', `/api/admin/conversations?limit=${limit}`),
};

/**
 * conversation id → owner, filled from the admin listing so opening another
 * user's conversation can start acting as its owner before the page fetches.
 */
const ownerByConversation = new Map<string, AdminConversation['owner']>();

export function rememberConversationOwners(items: AdminConversation[]): void {
  for (const item of items) ownerByConversation.set(item.id, item.owner);
}

export function lookupConversationOwner(conversationId: string): AdminConversation['owner'] | undefined {
  return ownerByConversation.get(conversationId);
}
