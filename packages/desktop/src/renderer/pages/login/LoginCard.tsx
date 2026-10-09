/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import loginLogo from '@renderer/assets/logos/brand/app.png';
import LanguageSwitcher from '@renderer/components/settings/LanguageSwitcher';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './LoginPage.module.css';

type LoginCardProps = {
  title: string;
  subtitle?: string;
  /** Set the title as the large brand heading (the Feishu view). */
  brand?: boolean;
  children: React.ReactNode;
};

/** Backdrop and card shared by every login view: language picker, logo and heading. */
const LoginCard: React.FC<LoginCardProps> = ({ title, subtitle, brand = false, children }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden='true'>
        <div className={classNames(styles.glow, styles.glowTopEnd)} />
        <div className={classNames(styles.glow, styles.glowBottomStart)} />
      </div>
      <div className={styles.stage}>
        <main className={styles.card}>
          <div className={styles.toolbar}>
            <LanguageSwitcher />
          </div>
          <header className={styles.header}>
            <img className={styles.logo} src={loginLogo} alt={t('login.brand')} />
            <h1 className={classNames(styles.title, brand && styles.brandTitle)}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
};

export default LoginCard;
