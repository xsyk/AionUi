/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemSettings from '@/renderer/pages/settings/SystemSettings';

const mockUseLocation = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent', () => ({
  default: () => <div data-testid='system-modal-content'>SystemModalContent</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children, contentClassName }: { children: React.ReactNode; contentClassName?: string }) => (
    <div data-testid='settings-page-wrapper' {...(contentClassName ? { 'data-content-class': contentClassName } : {})}>
      {children}
    </div>
  ),
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SystemModalContent', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('system-modal-content')).toBeInTheDocument();
  });

  it('renders the system settings even on the retired /settings/about path', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    expect(screen.getByTestId('system-modal-content')).toBeInTheDocument();
  });

  it('does not apply contentClassName for system page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).not.toHaveAttribute('data-content-class');
  });

  it('wraps content in SettingsPageWrapper', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('settings-page-wrapper')).toBeInTheDocument();
  });
});
