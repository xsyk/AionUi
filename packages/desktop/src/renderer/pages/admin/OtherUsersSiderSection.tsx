/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Super-admin only sider section: every other user's conversations, grouped by
 * owner. Opening one starts acting as its owner (see `ActAsGate`).
 */

import { Message } from '@arco-design/web-react';
import { MessageOne, Right, User } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { setActAsUser } from '@/common/adapter/httpBridge';
import SiderItem from '@renderer/components/layout/Sider/SiderItem';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { adminApi, rememberConversationOwners } from './adminApi';
import type { AdminConversation } from './adminApi';

const SWR_KEY = 'admin-all-conversations';
const EXPANDED_KEY = 'other-users-section-expanded';
const REFRESH_INTERVAL_MS = 30_000;

type OwnerGroup = { owner: AdminConversation['owner']; items: AdminConversation[] };

type OtherUsersSiderSectionProps = {
  collapsed: boolean;
  pathname: string;
  onSessionClick?: () => void;
};

function groupByOwner(items: AdminConversation[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  for (const item of items) {
    const group = groups.get(item.owner.id) ?? { owner: item.owner, items: [] };
    group.items.push(item);
    groups.set(item.owner.id, group);
  }
  return [...groups.values()].toSorted((a, b) => a.owner.username.localeCompare(b.owner.username));
}

const OtherUsersSiderSection: React.FC<OtherUsersSiderSectionProps> = ({ collapsed, pathname, onSessionClick }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.is_super_admin);

  const { data, mutate } = useSWR(
    isSuperAdmin ? SWR_KEY : null,
    async () => {
      const items = await adminApi.listAllConversations();
      rememberConversationOwners(items);
      return items;
    },
    { refreshInterval: REFRESH_INTERVAL_MS, revalidateOnFocus: true }
  );

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    return ipcBridge.conversation.listChanged.on(() => {
      void mutate();
    });
  }, [isSuperAdmin, mutate]);

  const [expanded, setExpanded] = useState<boolean>(() => localStorage.getItem(EXPANDED_KEY) !== 'false');
  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, String(expanded));
  }, [expanded]);
  const [openOwners, setOpenOwners] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupByOwner(data ?? []), [data]);

  const openConversation = useCallback(
    (item: AdminConversation) => {
      if (item.owner.deleted) {
        Message.info(t('settings.userManagement.actAsUnavailable', { username: item.owner.username }));
        return;
      }
      cleanupSiderTooltips();
      blurActiveElement();
      // Start acting before the page mounts; ActAsGate keeps it in sync after.
      setActAsUser(item.owner.id);
      void navigate(`/conversation/${item.id}`);
      onSessionClick?.();
    },
    [navigate, onSessionClick, t]
  );

  if (!isSuperAdmin || collapsed || groups.length === 0) return null;

  return (
    <div className='shrink-0 flex flex-col gap-2px' data-testid='other-users-section'>
      <div
        className='group/label sider-section-label flex items-center px-12px h-28px select-none sticky top-0 z-10 mt-8px cursor-pointer'
        onClick={() => setExpanded((v) => !v)}
      >
        <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
          {t('settings.userManagement.otherUsers')}
        </span>
        <span className='ms-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
          <Right
            theme='outline'
            size={12}
            className={classNames('transition-transform duration-150', { 'rotate-90': expanded })}
          />
        </span>
      </div>
      {expanded &&
        groups.map((group) => {
          const open = openOwners[group.owner.id] ?? false;
          const label = group.owner.deleted
            ? `${group.owner.username} ${t('settings.userManagement.deletedSuffix')}`
            : group.owner.username;
          return (
            <div
              key={group.owner.id}
              className='flex flex-col gap-2px'
              data-testid={`other-user-${group.owner.username}`}
            >
              <SiderItem
                icon={<User theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />}
                name={`${label} (${group.items.length})`}
                onClick={() => setOpenOwners((prev) => ({ ...prev, [group.owner.id]: !open }))}
              />
              {open &&
                group.items.map((item) => (
                  <div key={item.id} className='ps-16px'>
                    <SiderItem
                      icon={<MessageOne theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />}
                      name={item.name}
                      selected={pathname === `/conversation/${item.id}`}
                      onClick={() => openConversation(item)}
                    />
                  </div>
                ))}
            </div>
          );
        })}
    </div>
  );
};

export default OtherUsersSiderSection;
