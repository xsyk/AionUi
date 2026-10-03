/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lets the super admin open another user's conversation.
 *
 * Conversation APIs are scoped to the caller, so before the page renders (and
 * its hooks fetch) this gate resolves the conversation's owner and switches
 * `httpBridge` to act as that owner. The switch happens during render — not in
 * an effect — because child effects run before parent effects and would
 * otherwise fire their first requests as the admin.
 */

import { Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { adminApi, lookupConversationOwner, rememberConversationOwners } from './adminApi';
import type { AdminConversation } from './adminApi';
import { getActAsUser, setActAsUser } from '@/common/adapter/httpBridge';
import { useAuth } from '@renderer/hooks/context/AuthContext';

type Owner = AdminConversation['owner'];

/** `undefined` = still resolving; `null` = the admin's own conversation. */
type Resolution = Owner | null | undefined;

const ActAsGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.is_super_admin);
  const [fetched, setFetched] = useState<Record<string, Owner | null>>({});

  let resolution: Resolution = null;
  if (isSuperAdmin) {
    resolution = lookupConversationOwner(id) ?? (id in fetched ? fetched[id] : undefined);
  }

  useEffect(() => {
    if (!isSuperAdmin || resolution !== undefined) return;
    let cancelled = false;
    void adminApi
      .listAllConversations()
      .then((items) => {
        rememberConversationOwners(items);
        if (!cancelled) setFetched((prev) => ({ ...prev, [id]: lookupConversationOwner(id) ?? null }));
      })
      .catch(() => {
        if (!cancelled) setFetched((prev) => ({ ...prev, [id]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [id, isSuperAdmin, resolution]);

  // Stop acting when leaving the conversation page entirely.
  useEffect(() => () => setActAsUser(null), []);

  if (resolution === undefined) {
    return (
      <div className='size-full flex-center'>
        <Spin />
      </div>
    );
  }

  const actingOwner = resolution && resolution.id !== user?.id ? resolution : null;

  if (actingOwner?.deleted) {
    if (getActAsUser() !== null) setActAsUser(null);
    return (
      <div className='size-full flex-center text-t-secondary' data-testid='act-as-unavailable'>
        {t('settings.userManagement.actAsUnavailable', { username: actingOwner.username })}
      </div>
    );
  }

  const wanted = actingOwner ? actingOwner.id : null;
  if (getActAsUser() !== wanted) setActAsUser(wanted);

  // Own conversation (or not a super admin): render the page untouched.
  if (!actingOwner) return <React.Fragment key='self'>{children}</React.Fragment>;

  return (
    <div className='size-full flex flex-col min-h-0'>
      <div
        className='shrink-0 px-16px py-6px text-12px bg-[rgb(var(--warning-1))] text-[rgb(var(--warning-6))]'
        data-testid='act-as-banner'
      >
        {t('settings.userManagement.actingAs', { username: actingOwner.username })}
      </div>
      {/* Keyed by owner so per-conversation state never mixes identities. */}
      <div key={actingOwner.id} className='flex-1 min-h-0 flex flex-col'>
        {children}
      </div>
    </div>
  );
};

export default ActAsGate;
