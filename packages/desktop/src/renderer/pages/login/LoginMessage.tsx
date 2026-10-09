/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';
import styles from './LoginPage.module.css';

export type LoginNotice = { type: 'error' | 'success'; text: string };

/** Result line under the main action; renders nothing while there is no notice. */
const LoginMessage: React.FC<{ notice: LoginNotice | null }> = ({ notice }) => {
  if (!notice) return null;
  return (
    <div
      role='alert'
      className={classNames(styles.message, notice.type === 'success' ? styles.messageSuccess : styles.messageError)}
    >
      {notice.text}
    </div>
  );
};

export default LoginMessage;
