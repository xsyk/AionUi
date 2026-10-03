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
};

export type AdminConversation = {
  id: string;
  name: string;
  type: string;
  backend: string | null;
  updated_at: number;
  owner: { id: string; username: string; deleted: boolean };
};

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
