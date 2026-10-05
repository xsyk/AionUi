/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isSuppressedTip, type TMessage } from '@/common/chat/chatLib';

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
