/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FEISHU_START_URL, fetchFeishuLoginEnabled } from './feishuLogin';

/** "Sign in with Feishu" — shown only when the backend reports it enabled. */
const FeishuLoginButton: React.FC = () => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchFeishuLoginEnabled().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className='login-page__alt'>
      <div className='login-page__alt-divider'>
        <span>{t('login.feishu.or')}</span>
      </div>
      <Button
        long
        size='large'
        className='login-page__feishu'
        data-testid='feishu-login-button'
        onClick={() => window.location.assign(FEISHU_START_URL)}
      >
        {t('login.feishu.button')}
      </Button>
    </div>
  );
};

export default FeishuLoginButton;
