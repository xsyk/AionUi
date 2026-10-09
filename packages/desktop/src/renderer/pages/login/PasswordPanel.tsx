/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Input } from '@arco-design/web-react';
import { ArrowLeft, Lock, PreviewCloseOne, PreviewOpen, User } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/context/AuthContext';
import LoginMessage from './LoginMessage';
import type { LoginNotice } from './LoginMessage';
import styles from './LoginPage.module.css';
import { forgetCredentials, readRememberedCredentials, rememberCredentials } from './rememberedCredentials';

type PasswordPanelProps = {
  notice: LoginNotice | null;
  /** Shows or clears the page notice; `autoClear` hides it again after a few seconds. */
  onNotice: (notice: LoginNotice | null, autoClear?: boolean) => void;
  /** Present only when Feishu sign-in is enabled. */
  onBackToFeishu?: () => void;
};

/** Username/password form. */
const PasswordPanel: React.FC<PasswordPanelProps> = ({ notice, onNotice, onBackToFeishu }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const remembered = readRememberedCredentials();
    if (!remembered) return;
    setUsername(remembered.username);
    setPassword(remembered.password);
    setRememberMe(true);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedUsername = username.trim();

      if (!trimmedUsername || !password) {
        onNotice({ type: 'error', text: t('login.errors.empty') }, true);
        return;
      }

      setLoading(true);
      onNotice(null);

      const result = await login({ username: trimmedUsername, password, remember: rememberMe });

      if (result.success) {
        if (rememberMe) {
          rememberCredentials({ username: trimmedUsername, password });
        } else {
          forgetCredentials();
        }
        onNotice({ type: 'success', text: t('login.success') });
        window.setTimeout(() => {
          void navigate('/guid', { replace: true });
        }, 600);
      } else {
        const errorText = (() => {
          switch (result.code) {
            case 'invalidCredentials':
              return t('login.errors.invalidCredentials');
            case 'tooManyAttempts':
              return t('login.errors.tooManyAttempts');
            case 'networkError':
              return t('login.errors.networkError');
            case 'serverError':
              return t('login.errors.serverError');
            case 'unknown':
            default:
              return result.message ?? t('login.errors.unknown');
          }
        })();
        onNotice({ type: 'error', text: errorText }, true);
      }

      setLoading(false);
    },
    [login, navigate, onNotice, password, rememberMe, t, username]
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        autoFocus
        className={styles.field}
        name='username'
        autoComplete='username'
        prefix={<User />}
        placeholder={t('login.username')}
        aria-label={t('login.username')}
        value={username}
        onChange={setUsername}
      />
      <Input
        className={styles.field}
        name='password'
        type={passwordVisible ? 'text' : 'password'}
        autoComplete='current-password'
        prefix={<Lock />}
        suffix={
          <Button
            type='text'
            className={styles.visibilityToggle}
            icon={passwordVisible ? <PreviewOpen /> : <PreviewCloseOne />}
            aria-label={passwordVisible ? t('login.hidePassword') : t('login.showPassword')}
            onClick={() => setPasswordVisible((prev) => !prev)}
          />
        }
        placeholder={t('login.password')}
        aria-label={t('login.password')}
        value={password}
        onChange={setPassword}
      />
      <Checkbox className={styles.remember} checked={rememberMe} onChange={setRememberMe}>
        {t('login.rememberMe')}
      </Checkbox>
      <Button
        long
        type='primary'
        htmlType='submit'
        loading={loading}
        className={classNames(styles.primaryButton, styles.submitButton)}
        data-testid='password-login-submit'
      >
        {loading ? t('login.submitting') : t('login.submit')}
      </Button>
      <LoginMessage notice={notice} />
      {onBackToFeishu && (
        <div className={styles.footer}>
          <Button type='text' className={styles.switchLink} data-testid='back-to-feishu' onClick={onBackToFeishu}>
            <ArrowLeft className='rtl-mirror' />
            <span>{t('login.feishu.back')}</span>
          </Button>
        </div>
      )}
    </form>
  );
};

export default PasswordPanel;
