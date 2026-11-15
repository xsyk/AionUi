/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACT_AS_HEADER, httpRequest } from '@/common/adapter/httpBridge';
import { fromApiSidebar, fromApiSidebarItems, scopeToToken } from '@/common/adapter/sidebarMapper';
import type { OrderItemType, SidebarItemsResponse, SidebarResponse } from '@/common/types/sidebar';
import type { AuthUser } from '@/renderer/hooks/context/AuthContext';
import { adminApi } from '@/renderer/pages/admin/adminApi';
import { ensureCsrfCookie, readCsrfCookie } from '@/renderer/pages/share/shareApi';

export type ArchivedOwner = Pick<AuthUser, 'id' | 'username'>;
export type ArchivedSource = { owner: ArchivedOwner; sidebar: SidebarResponse };
export type ArchivedData = { owners: ArchivedOwner[]; sources: ArchivedSource[]; hasFailures: boolean };

const ownerHeaders = (callerId: string, owner: ArchivedOwner): Record<string, string> =>
  owner.id === callerId ? {} : { [ACT_AS_HEADER]: owner.id };

/** Scope windows must remain distinct across owners, including the shared chats token. */
export const archivedWindowKey = (owner: ArchivedOwner, token: string): string => JSON.stringify([owner.id, token]);

/** Read one archived window using an immutable, per-request owner context. */
export async function getArchivedItems(
  callerId: string,
  owner: ArchivedOwner,
  scope: string,
  cursor: string
): Promise<SidebarItemsResponse> {
  const query = new URLSearchParams({ scope, cursor, limit: '10', archived: 'true' });
  return fromApiSidebarItems(
    await httpRequest<SidebarItemsResponse>('GET', `/api/sidebar/items?${query}`, undefined, {
      headers: ownerHeaders(callerId, owner),
    })
  );
}

/** Load active owners only; a failed owner never hides successful archive sources. */
export async function getArchivedSources(
  caller: AuthUser,
  windowSizes: ReadonlyMap<string, number>
): Promise<ArchivedData> {
  const owners: ArchivedOwner[] = [caller];
  if (caller.is_super_admin === true) {
    const users = await adminApi.listUsers();
    owners.push(...users.filter((user) => user.status === 'active' && user.id !== caller.id));
  }
  const results: PromiseSettledResult<ArchivedSource>[] = [];
  // Limit concurrent owner reads while retaining every active owner in the result.
  for (let start = 0; start < owners.length; start += 4) {
    results.push(
      ...(await Promise.allSettled(
        owners.slice(start, start + 4).map(async (owner): Promise<ArchivedSource> => {
          const sidebar = fromApiSidebar(
            await httpRequest<SidebarResponse>('GET', '/api/sidebar?limit=5&archived=true', undefined, {
              headers: ownerHeaders(caller.id, owner),
            })
          );
          // Re-read loaded windows after mutations so failed selections on later pages
          // remain available, with fresh server cursors rather than stale appended data.
          await Promise.all(
            sidebar.groups.map(async (group) => {
              const token = scopeToToken(group.scope);
              const wanted = windowSizes.get(archivedWindowKey(owner, token)) ?? 0;
              while (group.items.length < wanted && group.has_more && group.next_cursor) {
                const cursor = group.next_cursor;
                const page = await getArchivedItems(caller.id, owner, token, cursor);
                group.items.push(...page.items);
                group.has_more = page.has_more;
                group.next_cursor = page.next_cursor;
                if (page.items.length === 0 || page.next_cursor === cursor) break;
              }
            })
          );
          return { owner, sidebar };
        })
      ))
    );
  }
  return {
    // A successful user-list read distinguishes inactive owners from temporary sidebar failures.
    owners,
    sources: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    hasFailures: results.some((result) => result.status === 'rejected'),
  };
}

/** Mutate exactly one archive unit, retaining both CSRF and ownership checks. */
export async function mutateArchivedItem(
  callerId: string,
  owner: ArchivedOwner,
  item: { item_type: OrderItemType; item_id: string },
  action: 'delete' | 'restore'
): Promise<void> {
  await ensureCsrfCookie();
  const unit = `${item.item_type}/${encodeURIComponent(item.item_id)}`;
  const path = action === 'delete' ? `/api/sidebar/archived/${unit}` : `/api/sidebar/${unit}/unarchive`;
  await httpRequest<void>(action === 'delete' ? 'DELETE' : 'POST', path, undefined, {
    headers: { ...ownerHeaders(callerId, owner), 'x-csrf-token': readCsrfCookie() },
  });
}
