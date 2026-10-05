/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * AionEasiful has no "report an issue" channel: the modal, its provider and
 * every button that opened it are gone. Source-level so a merge that brings
 * one back fails fast.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const src = (relative: string) => path.join(repoRoot, 'packages/desktop/src/renderer', relative);

const REMOVED = [
  'components/base/FeedbackButton.tsx',
  'hooks/context/FeedbackContext.tsx',
  'components/settings/SettingsModal/contents/FeedbackReportModal.tsx',
  'components/settings/SettingsModal/contents/feedbackModules.ts',
  'services/feedback/resolveFeedbackModule.ts',
  'services/feedback/routeContext.ts',
];

const FORMER_ENTRY_POINTS = [
  'components/layout/Titlebar/index.tsx',
  'pages/guid/GuidPage.tsx',
  'pages/guid/components/QuickActionButtons.tsx',
  'components/settings/SettingsModal/contents/SystemModalContent/index.tsx',
  'pages/settings/ToolsSettings/McpServerHeader.tsx',
  'pages/conversation/Messages/components/MessageTips.tsx',
  'pages/conversation/Messages/components/MessageToolGroup.tsx',
  'pages/conversation/Messages/components/MessageAgentStatus.tsx',
  'components/settings/UpdateNotificationCard.tsx',
  'main.tsx',
];

describe('feedback channel removal', () => {
  it.each(REMOVED)('deletes %s', (file) => {
    expect(fs.existsSync(src(file))).toBe(false);
  });

  it.each(FORMER_ENTRY_POINTS)('%s no longer opens feedback', (file) => {
    const code = fs.readFileSync(src(file), 'utf-8');
    expect(code).not.toMatch(
      /FeedbackButton|useFeedback|FeedbackProvider|FeedbackReportModal|openFeedback|onOpenBugReport|oneClickFeedback/
    );
  });

  it.each([
    'pages/conversation/Messages/components/MessageTips.tsx',
    'pages/conversation/Messages/components/MessageToolGroup.tsx',
    'pages/conversation/Messages/components/MessageAgentStatus.tsx',
  ])('%s still offers the Butler diagnose chip on errors', (file) => {
    const code = fs.readFileSync(src(file), 'utf-8');
    expect(code).toMatch(/<ButlerDiagnoseButton/);
  });

  it('drops the GitHub star quick action from the home page', () => {
    const code = fs.readFileSync(src('pages/guid/components/QuickActionButtons.tsx'), 'utf-8');
    expect(code).not.toMatch(/github\.com|quickActionStar|quickActionFeedback/);
  });
});
