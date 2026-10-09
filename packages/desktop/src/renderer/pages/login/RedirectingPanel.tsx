/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_NAME } from '@/common/config/constants';
import { Protect } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './LoginPage.module.css';

/** Shown between the Feishu button click and the browser leaving for Feishu. */
const RedirectingPanel: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className={styles.redirectingPanel} role='status' aria-live='polite' data-testid='feishu-redirecting'>
      <svg className={styles.spinner} viewBox='0 0 88 88' aria-hidden='true'>
        <circle className={styles.spinnerTrack} cx='44' cy='44' r='38' />
        <circle className={styles.spinnerArc} cx='44' cy='44' r='38' />
      </svg>
      <p className={styles.hint}>{t('login.feishu.redirectingHint')}</p>
      <div className={styles.privacyNote}>
        <Protect theme='filled' size={26} className={styles.privacyIcon} />
        <span>{t('login.feishu.privacyNote', { appName: APP_NAME })}</span>
      </div>
    </div>
  );
};

export default RedirectingPanel;
