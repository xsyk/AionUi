/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Form, Tooltip } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const FIELD_CLASS_NAME =
  'aion-dir-input h-[32px] flex items-center rounded-8px border border-solid border-transparent ps-14px bg-[var(--fill-0)]';

/**
 * Directory selection input component
 * Used for selecting and displaying system directory paths
 */
const DirInputItem: React.FC<{
  label: string;
  field: string;
  /**
   * Show the path and nothing else: no folder button, and no reaction to a click or a key press.
   * The web UI sets it. There the server's launcher fixes the directories at installation, and the
   * save behind the picker (`update-system-info`, `restart-app`) is Electron-only IPC that never
   * answers over the web bridge.
   */
  readOnly?: boolean;
}> = ({ label, field, readOnly = false }) => {
  const { t } = useTranslation();
  return (
    <Form.Item label={label} field={field}>
      {(value, form) => {
        const current_value = form.getFieldValue(field) || '';

        // The tooltip stays in read-only mode: the field truncates a long path, and hovering is how to read all of it.
        const pathText = (
          <Tooltip content={current_value || t('settings.dirNotConfigured')} position='top'>
            {/* Paths are code-like; without dir=ltr the leading slash flips to the end under RTL. */}
            <div dir='ltr' className='flex-1 min-w-0 text-13px text-t-primary truncate rtl-text-right'>
              {current_value || t('settings.dirNotConfigured')}
            </div>
          </Tooltip>
        );

        if (readOnly) {
          // Nothing to operate, so no tab stop either; `pe` takes the place of the button's width.
          return <div className={`${FIELD_CLASS_NAME} pe-14px`}>{pathText}</div>;
        }

        const actionTooltip = field === 'workDir' ? t('settings.changeWorkDir') : t('settings.changeLogDir');

        const handlePick = () => {
          ipcBridge.dialog.showOpen
            .invoke({
              defaultPath: current_value,
              properties: ['openDirectory', 'createDirectory'],
            })
            .then((data) => {
              if (data?.[0]) {
                form.setFieldValue(field, data[0]);
              }
            })
            .catch((error) => {
              console.error('Failed to open directory dialog:', error);
            });
        };

        const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handlePick();
        };

        return (
          <div
            className={`${FIELD_CLASS_NAME} cursor-pointer`}
            tabIndex={0}
            onClick={handlePick}
            onKeyDown={handleKeyDown}
          >
            {pathText}
            <Tooltip content={actionTooltip} position='top'>
              <Button
                type='text'
                aria-label={actionTooltip}
                style={{
                  borderInlineStart: '1px solid var(--color-border-2)',
                  borderStartStartRadius: 0,
                  borderStartEndRadius: 8,
                  borderEndEndRadius: 8,
                  borderEndStartRadius: 0,
                }}
                icon={<FolderOpen theme='outline' size='18' fill={iconColors.primary} />}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePick();
                }}
              />
            </Tooltip>
          </div>
        );
      }}
    </Form.Item>
  );
};

export default DirInputItem;
