/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert } from '@arco-design/web-react';
import React from 'react';
import { isElectronDesktop } from '@/renderer/utils/platform';

type SharedConfigNoticeProps = {
  /** True when the current user can edit the shared configuration. */
  canManage: boolean;
  /** Shown to the admin, who edits the configuration for everyone. */
  adminText: string;
  /** Shown to everyone else, for whom the page is read-only. */
  readonlyText: string;
};

// Arco's Alert puts role="alert" on its root, which screen readers announce assertively, but lets any extra prop
// override it (AlertProps just does not declare `role`, hence the spread). A banner or hint that is static is a
// status, so settings pages spread this into theirs.
export const STATUS_ROLE_PROPS = { role: 'status' };

/**
 * Info banner at the top of a settings page whose configuration is shared by
 * all users (models, agents, image model). Tells the admin their changes reach
 * everyone, and tells other users the page is managed by the admin.
 *
 * The desktop app has a single user, so "available to all users" means nothing
 * there and the banner is not shown.
 */
const SharedConfigNotice: React.FC<SharedConfigNoticeProps> = ({ canManage, adminText, readonlyText }) => {
  if (isElectronDesktop()) return null;

  return (
    <Alert
      type='info'
      {...STATUS_ROLE_PROPS}
      content={canManage ? adminText : readonlyText}
      className='!rounded-8px'
      data-testid='shared-config-notice'
    />
  );
};

export default SharedConfigNotice;
