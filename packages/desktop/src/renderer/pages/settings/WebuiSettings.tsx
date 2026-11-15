/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import WebuiModalContent from '@/renderer/components/settings/SettingsModal/contents/WebuiModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const WebuiSettings: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.is_super_admin);

  if (!isSuperAdmin) {
    return user ? <Navigate to='/settings/agent' replace /> : null;
  }

  return (
    <SettingsPageWrapper>
      <WebuiModalContent />
    </SettingsPageWrapper>
  );
};

export default WebuiSettings;
