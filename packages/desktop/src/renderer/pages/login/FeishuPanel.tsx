/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import FeishuLogo from '@/renderer/assets/channel-logos/lark.svg';
import { Button } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import LoginMessage from './LoginMessage';
import type { LoginNotice } from './LoginMessage';
import styles from './LoginPage.module.css';

type FeishuPanelProps = {
  notice: LoginNotice | null;
  onStart: () => void;
  onUsePassword: () => void;
};

/** First view when Feishu sign-in is enabled. */
const FeishuPanel: React.FC<FeishuPanelProps> = ({ notice, onStart, onUsePassword }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.feishuPanel}>
      <Button
        long
        type='primary'
        className={classNames(styles.primaryButton, styles.feishuButton)}
        data-testid='feishu-login-button'
        onClick={onStart}
      >
        <span className={styles.feishuMark} aria-hidden='true'>
          <img src={FeishuLogo} alt='' />
        </span>
        <span>{t('login.feishu.button')}</span>
      </Button>
      <p className={styles.caption}>{t('login.feishu.caption')}</p>
      <LoginMessage notice={notice} />
      <div className={styles.footer}>
        <Button type='text' className={styles.switchLink} data-testid='use-password-login' onClick={onUsePassword}>
          <span>{t('login.feishu.usePassword')}</span>
          <Right className='rtl-mirror' />
        </Button>
      </div>
    </div>
  );
};

export default FeishuPanel;
