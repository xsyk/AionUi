/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_NAME } from '@/common/config/constants';
import AppLoader from '@renderer/components/layout/AppLoader';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/context/AuthContext';
import FeishuPanel from './FeishuPanel';
import { feishuErrorKey, fetchFeishuLoginStatus, startFeishuLogin } from './feishuLogin';
import type { FeishuLoginStatus } from './feishuLogin';
import LoginCard from './LoginCard';
import type { LoginNotice } from './LoginMessage';
import PasswordPanel from './PasswordPanel';
import RedirectingPanel from './RedirectingPanel';

type LoginView = 'feishu' | 'password' | 'redirecting';

/** How long a failed username/password attempt stays on screen. */
const AUTO_CLEAR_NOTICE_MS = 5000;

/** Give the Feishu view back if the browser still hasn't left by then (navigation cancelled). */
const REDIRECT_FALLBACK_MS = 15000;

const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [feishu, setFeishu] = useState<FeishuLoginStatus | null>(null);
  const [view, setView] = useState<LoginView>('password');
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  // Set once the user comes back from the password form, so focus lands on the Feishu button
  // instead of dropping to the page; the first visit leaves focus alone.
  const [returnedFromPassword, setReturnedFromPassword] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  const showNotice = useCallback((next: LoginNotice | null, autoClear = false) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && autoClear) {
      noticeTimer.current = window.setTimeout(() => setNotice(null), AUTO_CLEAR_NOTICE_MS);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  useEffect(() => {
    let alive = true;
    void fetchFeishuLoginStatus().then((value) => {
      if (!alive) return;
      setFeishu(value);
      setView(value.enabled ? 'feishu' : 'password');
    });
    return () => {
      alive = false;
    };
  }, []);

  // The Feishu callback redirects back here with `?feishu_error=<code>` on failure. The message
  // stays until the user acts, so a long one (pending approval) can be read in full.
  useEffect(() => {
    const key = feishuErrorKey(searchParams.get('feishu_error'));
    if (!key) return;
    showNotice({ type: 'error', text: t(key) });
    const next = new URLSearchParams(searchParams);
    next.delete('feishu_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, showNotice, t]);

  // Pressing Back on the Feishu page restores this page from the back/forward cache, spinner and all.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setView((current) => (current === 'redirecting' ? 'feishu' : current));
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Leave only once the redirecting view has been committed, so it is what stays on screen.
  useEffect(() => {
    if (view === 'redirecting' && feishu?.enabled) startFeishuLogin(feishu);
  }, [feishu, view]);

  // Esc or Stop cancels the navigation and leaves this page as it was; don't spin forever.
  useEffect(() => {
    if (view !== 'redirecting') return undefined;
    const timer = window.setTimeout(() => setView('feishu'), REDIRECT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [view]);

  const switchView = useCallback(
    (next: LoginView) => {
      showNotice(null);
      setView(next);
    },
    [showNotice]
  );

  if (status === 'checking' || !feishu) {
    return <AppLoader />;
  }

  if (view === 'redirecting') {
    return (
      <LoginCard title={t('login.feishu.redirectingTitle')}>
        <RedirectingPanel />
      </LoginCard>
    );
  }

  if (view === 'feishu') {
    return (
      <LoginCard brand title={t('login.brand')} subtitle={t('login.subtitle', { appName: APP_NAME })}>
        <FeishuPanel
          notice={notice}
          autoFocus={returnedFromPassword}
          onStart={() => switchView('redirecting')}
          onUsePassword={() => switchView('password')}
        />
      </LoginCard>
    );
  }

  return (
    <LoginCard title={t('login.passwordTitle')}>
      <PasswordPanel
        notice={notice}
        onNotice={showNotice}
        onBackToFeishu={
          feishu.enabled
            ? () => {
                setReturnedFromPassword(true);
                switchView('feishu');
              }
            : undefined
        }
      />
    </LoginCard>
  );
};

export default LoginPage;
