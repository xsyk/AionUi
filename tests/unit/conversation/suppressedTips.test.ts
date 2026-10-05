/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isSuppressedTip, type TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { buildConversationExportText } from '@/renderer/utils/chat/conversationExport';

const tip = (code?: string): TMessage => ({
  id: 't1',
  conversation_id: 'c1',
  type: 'tips',
  position: 'center',
  content: { content: 'x', type: 'info', ...(code ? { code } : {}) },
});

describe('isSuppressedTip', () => {
  it('hides stored "CLI newer than verified" notices', () => {
    expect(isSuppressedTip(tip('CLI_VERSION_NEWER'))).toBe(true);
  });

  it('keeps every other tip, including the older-CLI notice', () => {
    expect(isSuppressedTip(tip('CLI_VERSION_OLDER'))).toBe(false);
    expect(isSuppressedTip(tip())).toBe(false);
  });

  it('never hides other message types', () => {
    const text: TMessage = {
      id: 'm1',
      conversation_id: 'c1',
      type: 'text',
      position: 'left',
      content: { content: 'CLI_VERSION_NEWER' },
    };
    expect(isSuppressedTip(text)).toBe(false);
  });
});

describe('conversation export', () => {
  it('leaves hidden tips out of the exported transcript', () => {
    const labels = {
      conversation: 'Conversation',
      conversation_id: 'ID',
      exportedAt: 'Exported',
      type: 'Type',
      noMessages: 'No messages',
      user: 'User',
      assistant: 'Assistant',
      system: 'System',
    };
    const newer = {
      ...tip('CLI_VERSION_NEWER'),
      content: { content: 'newer CLI notice', type: 'info' as const, code: 'CLI_VERSION_NEWER' },
    };
    const older = {
      ...tip('CLI_VERSION_OLDER'),
      id: 't2',
      content: { content: 'older CLI notice', type: 'info' as const, code: 'CLI_VERSION_OLDER' },
    };
    const text = buildConversationExportText(
      { id: 'c1', name: 'Chat', type: 'acp' } as TChatConversation,
      [newer as TMessage, older as TMessage],
      labels
    );

    expect(text).not.toContain('newer CLI notice');
    expect(text).toContain('older CLI notice');
  });
});
