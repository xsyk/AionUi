/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { isElectronDesktop } from '@/renderer/utils/platform';

/**
 * Whether the current user may change the configuration shared by the whole
 * server: model providers, agents and the image generation model. Only the
 * super admin can; everyone else sees those settings read-only.
 *
 * A signed-in user is decided by the flag the server reports (it stays true
 * while the admin acts as someone else). The desktop app has no sign-in:
 * AuthProvider reports `user: null` there and the renderer talks to its local
 * backend as the built-in admin, so the desktop keeps full control.
 */
export function useCanManageSharedConfig(): boolean {
  const { user } = useAuth();
  if (user) return Boolean(user.is_super_admin);
  return isElectronDesktop();
}
