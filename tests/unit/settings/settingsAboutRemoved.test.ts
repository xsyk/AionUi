/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf-8');

describe('About page removal', () => {
  it('has no About tab in the settings sider', () => {
    expect(BUILTIN_TAB_IDS).not.toContain('about');
  });

  it('redirects old /settings/about links to the agent settings', () => {
    const router = read('packages/desktop/src/renderer/components/layout/Router.tsx');
    expect(router).toMatch(/path='\/settings\/about' element=\{<Navigate to='\/settings\/agent' replace \/>\}/);
  });

  it('deletes the About panel component', () => {
    const file = 'packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx';
    expect(fs.existsSync(path.join(repoRoot, file))).toBe(false);
  });
});
