/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert } from '@arco-design/web-react';
import React from 'react';

type SharedConfigNoticeProps = {
  /** True when the current user can edit the shared configuration. */
  canManage: boolean;
  /** Shown to the admin, who edits the configuration for everyone. */
  adminText: string;
  /** Shown to everyone else, for whom the page is read-only. */
  readonlyText: string;
};

/**
 * Info banner at the top of a settings page whose configuration is shared by
 * all users (models, agents, image model). Tells the admin their changes reach
 * everyone, and tells other users the page is managed by the admin.
 */
const SharedConfigNotice: React.FC<SharedConfigNoticeProps> = ({ canManage, adminText, readonlyText }) => {
  return (
    <Alert
      type='info'
      content={canManage ? adminText : readonlyText}
      className='!rounded-8px'
      data-testid='shared-config-notice'
    />
  );
};

export default SharedConfigNotice;
