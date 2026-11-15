/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Avatar, Button, Form, Input, Message, Modal, Table, Tag } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { adminApi, isPendingApproval } from './adminApi';
import FeishuLoginCard from './FeishuLoginCard';
import type { AdminUser, FeishuDirectorySyncView, FeishuLoginConfig } from './adminApi';
import { BackendHttpError, isBackendHttpError } from '@/common/adapter/httpBridge';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import SettingsPageWrapper from '@renderer/pages/settings/components/SettingsPageWrapper';

type PasswordDialog = { mode: 'create' } | { mode: 'reset'; user: AdminUser } | null;

const DIRECTORY = 'settings.userManagement.feishuDirectory';
const DIRECTORY_COUNTS = ['scanned', 'created', 'updated', 'unchanged', 'skipped', 'failed'] as const;

function directoryErrorKey(code: string | null) {
  switch (code) {
    case 'FEISHU_DIRECTORY_PERMISSION_DENIED':
      return `${DIRECTORY}.errors.permissionDenied` as const;
    case 'FEISHU_DIRECTORY_CONFIG_UNAVAILABLE':
      return `${DIRECTORY}.errors.configUnavailable` as const;
    case 'FEISHU_DIRECTORY_CONFIG_CHANGED':
      return `${DIRECTORY}.errors.configChanged` as const;
    case 'FEISHU_DIRECTORY_TIMEOUT':
      return `${DIRECTORY}.errors.timeout` as const;
    default:
      return `${DIRECTORY}.errors.syncFailed` as const;
  }
}

function directoryRequestError(error: unknown): string {
  return (isBackendHttpError(error) && error.code) || 'FEISHU_DIRECTORY_SYNC_FAILED';
}

function formatTime(ms: number | null, never: string): string {
  return ms ? new Date(ms).toLocaleString() : never;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof BackendHttpError) return error.backendMessage || fallback;
  return fallback;
}

const UserSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<PasswordDialog>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [feishuConfig, setFeishuConfig] = useState<FeishuLoginConfig | null>(null);
  const [syncTask, setSyncTask] = useState<FeishuDirectorySyncView | null>(null);
  const [syncChecking, setSyncChecking] = useState(true);
  const [syncStarting, setSyncStarting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncEpoch = useRef(0);
  const syncStartInFlight = useRef(false);
  const isSuperAdmin = Boolean(user?.is_super_admin);
  const syncId = syncTask?.id;
  const syncStatus = syncTask?.status;
  const syncRunning = syncStatus === 'running';
  const directoryConfigured = Boolean(feishuConfig?.enabled && feishuConfig.app_id && feishuConfig.app_secret_set);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await adminApi.listUsers());
    } catch (error) {
      Message.error(errorText(error, t('settings.userManagement.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isSuperAdmin) void reload();
  }, [isSuperAdmin, reload]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const epoch = ++syncEpoch.current;
    setSyncChecking(true);
    setSyncTask(null);
    setSyncError(null);
    void adminApi
      .getFeishuDirectorySync()
      .then((task) => {
        if (syncEpoch.current === epoch) setSyncTask(task);
      })
      .catch((error: unknown) => {
        if (syncEpoch.current === epoch) setSyncError(directoryRequestError(error));
      })
      .finally(() => {
        if (syncEpoch.current === epoch) setSyncChecking(false);
      });
    return () => {
      ++syncEpoch.current;
    };
  }, [isSuperAdmin, user?.id]);

  useEffect(() => {
    if (!isSuperAdmin || !syncRunning) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let keepPolling = true;
      try {
        const task = await adminApi.getFeishuDirectorySync();
        if (cancelled) return;
        setSyncTask(task);
        setSyncError(null);
        keepPolling = task?.status === 'running';
      } catch (error) {
        if (cancelled) return;
        setSyncError(directoryRequestError(error));
      }
      if (!cancelled && keepPolling) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSuperAdmin, syncId, syncRunning]);

  useEffect(() => {
    if (isSuperAdmin && syncStatus && syncStatus !== 'running') void reload();
  }, [isSuperAdmin, reload, syncId, syncStatus]);

  const startDirectorySync = async () => {
    if (!isSuperAdmin || !directoryConfigured || syncChecking || syncRunning || syncStartInFlight.current) return;
    const epoch = syncEpoch.current;
    syncStartInFlight.current = true;
    setSyncStarting(true);
    setSyncTask(null);
    setSyncError(null);
    try {
      const task = await adminApi.startFeishuDirectorySync();
      if (syncEpoch.current === epoch) setSyncTask(task);
    } catch (error) {
      if (syncEpoch.current === epoch) setSyncError(directoryRequestError(error));
    } finally {
      syncStartInFlight.current = false;
      if (syncEpoch.current === epoch) setSyncStarting(false);
    }
  };

  const openDialog = (next: PasswordDialog) => {
    form.resetFields();
    setDialog(next);
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const values = (await form.validate()) as { username?: string; password: string };
    setSubmitting(true);
    try {
      if (dialog.mode === 'create') {
        await adminApi.createUser(values.username!.trim(), values.password);
        Message.success(t('settings.userManagement.createSuccess'));
      } else {
        await adminApi.resetPassword(dialog.user.id, values.password);
        Message.success(t('settings.userManagement.resetSuccess'));
      }
      setDialog(null);
      await reload();
    } catch (error) {
      if (error instanceof BackendHttpError && error.status === 409) {
        Message.error(t('settings.userManagement.usernameExists'));
      } else {
        Message.error(errorText(error, t('settings.userManagement.operationFailed')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      Message.success(success);
      await reload();
    } catch (error) {
      Message.error(errorText(error, t('settings.userManagement.operationFailed')));
    }
  };

  const confirmDelete = (target: AdminUser) => {
    Modal.confirm({
      title: t('settings.userManagement.deleteConfirmTitle'),
      content: t('settings.userManagement.deleteConfirmContent', { username: target.username }),
      okButtonProps: { status: 'danger' },
      onOk: () => runAction(() => adminApi.deleteUser(target.id), t('settings.userManagement.deleteSuccess')),
    });
  };

  if (!isSuperAdmin) {
    return user ? <Navigate to='/settings/agent' replace /> : null;
  }

  const syncIncomplete = Boolean(syncTask?.partial || syncTask?.failed || syncTask?.error_code);
  const syncResultType =
    syncStatus === 'failed' ? 'error' : syncRunning ? 'info' : syncIncomplete ? 'warning' : 'success';
  const syncResultKey =
    syncStatus === 'failed' ? 'failed' : syncRunning ? 'running' : syncIncomplete ? 'partial' : 'completed';

  const never = t('settings.userManagement.never');
  const columns: TableColumnProps<AdminUser>[] = [
    {
      title: t('settings.userManagement.username'),
      dataIndex: 'username',
      render: (_: unknown, row) => {
        const displayName = row.display_name?.trim() || row.username;
        return (
          <span className='inline-flex items-center gap-8px'>
            {row.avatar_url && (
              <Avatar size={24} style={{ flexShrink: 0 }}>
                <img src={row.avatar_url} alt={displayName} referrerPolicy='no-referrer' />
              </Avatar>
            )}
            <span className='inline-flex flex-col'>
              <span className='inline-flex items-center gap-6px'>
                {displayName}
                {row.is_super_admin && <Tag color='arcoblue'>{t('settings.userManagement.superAdmin')}</Tag>}
              </span>
              {displayName !== row.username && <span className='text-12px text-t-tertiary'>{row.username}</span>}
              {row.email && <span className='text-12px text-t-tertiary'>{row.email}</span>}
            </span>
          </span>
        );
      },
    },
    {
      title: t('settings.userManagement.status'),
      dataIndex: 'status',
      render: (_: unknown, row) =>
        row.status === 'active' ? (
          <Tag color='green'>{t('settings.userManagement.active')}</Tag>
        ) : isPendingApproval(row) ? (
          <Tag color='orange'>{t('settings.userManagement.pending')}</Tag>
        ) : (
          <Tag color='gray'>{t('settings.userManagement.disabled')}</Tag>
        ),
    },
    {
      title: t('settings.userManagement.source'),
      dataIndex: 'source',
      render: (_: unknown, row) =>
        row.source === 'feishu' ? (
          <Tag color='purple'>{t('settings.userManagement.sourceFeishu')}</Tag>
        ) : (
          <Tag>{t('settings.userManagement.sourcePassword')}</Tag>
        ),
    },
    {
      title: t('settings.userManagement.createdAt'),
      dataIndex: 'created_at',
      render: (_: unknown, row) => formatTime(row.created_at, never),
    },
    {
      title: t('settings.userManagement.lastLogin'),
      dataIndex: 'last_login',
      render: (_: unknown, row) => formatTime(row.last_login, never),
    },
    {
      title: t('settings.userManagement.actions'),
      dataIndex: 'actions',
      render: (_: unknown, row) => (
        <span className='inline-flex flex-wrap gap-8px'>
          <Button size='mini' onClick={() => openDialog({ mode: 'reset', user: row })}>
            {t('settings.userManagement.resetPassword')}
          </Button>
          {!row.is_super_admin &&
            (row.status === 'active' ? (
              <Button
                size='mini'
                onClick={() =>
                  void runAction(() => adminApi.disableUser(row.id), t('settings.userManagement.disableSuccess'))
                }
              >
                {t('settings.userManagement.disable')}
              </Button>
            ) : (
              <Button
                size='mini'
                onClick={() =>
                  void runAction(() => adminApi.enableUser(row.id), t('settings.userManagement.enableSuccess'))
                }
              >
                {t('settings.userManagement.enable')}
              </Button>
            ))}
          {!row.is_super_admin && (
            <Button size='mini' status='danger' onClick={() => confirmDelete(row)}>
              {t('settings.userManagement.delete')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px' data-testid='user-management'>
        <FeishuLoginCard onConfigChange={setFeishuConfig} />
        <div className='flex flex-wrap items-center justify-between gap-12px'>
          <div>
            <div className='text-16px font-600 text-t-primary'>{t('settings.userManagement.title')}</div>
            <div className='text-12px text-t-tertiary mt-4px'>{t('settings.userManagement.description')}</div>
          </div>
          <div className='flex flex-wrap gap-8px'>
            <Button
              loading={syncChecking || syncStarting || syncRunning}
              disabled={!directoryConfigured || syncChecking || syncStarting || syncRunning}
              onClick={() => void startDirectorySync()}
            >
              {t(`${DIRECTORY}.${syncStarting ? 'starting' : syncRunning ? 'running' : 'start'}`)}
            </Button>
            <Button type='primary' onClick={() => openDialog({ mode: 'create' })}>
              {t('settings.userManagement.newUser')}
            </Button>
          </div>
        </div>
        <div className='text-12px text-t-tertiary'>
          {t(`${DIRECTORY}.description`)}
          {!directoryConfigured && <div className='mt-4px'>{t(`${DIRECTORY}.configRequired`)}</div>}
        </div>
        <div className='flex flex-col gap-8px' aria-live='polite'>
          {syncError && <Alert type='error' content={t(directoryErrorKey(syncError))} />}
          {syncTask && (
            <div data-testid='feishu-directory-result'>
              <Alert
                type={syncResultType}
                title={t(`${DIRECTORY}.${syncResultKey}`)}
                content={
                  <div className='flex flex-col gap-8px'>
                    <div className='flex flex-wrap gap-x-16px gap-y-8px'>
                      {DIRECTORY_COUNTS.map((key) => (
                        <span key={key}>{t(`${DIRECTORY}.counts.${key}`, { count: syncTask[key] })}</span>
                      ))}
                    </div>
                    {(syncTask.error_code || syncStatus === 'failed') && (
                      <div>{t(directoryErrorKey(syncTask.error_code))}</div>
                    )}
                  </div>
                }
              />
            </div>
          )}
        </div>
        <Table rowKey='id' loading={loading} columns={columns} data={users} pagination={false} border={false} />
      </div>
      <Modal
        title={
          dialog?.mode === 'reset'
            ? t('settings.userManagement.resetPasswordTitle', { username: dialog.user.username })
            : t('settings.userManagement.newUser')
        }
        visible={dialog !== null}
        confirmLoading={submitting}
        onOk={() => void submitDialog()}
        onCancel={() => setDialog(null)}
        unmountOnExit
      >
        <Form form={form} layout='vertical'>
          {dialog?.mode === 'create' && (
            <Form.Item
              label={t('settings.userManagement.username')}
              field='username'
              rules={[{ required: true, message: t('settings.userManagement.usernameRequired') }]}
            >
              <Input autoComplete='off' />
            </Form.Item>
          )}
          <Form.Item
            label={t('settings.userManagement.password')}
            field='password'
            rules={[{ required: true, message: t('settings.userManagement.passwordRequired') }]}
          >
            <Input.Password autoComplete='new-password' />
          </Form.Item>
        </Form>
      </Modal>
    </SettingsPageWrapper>
  );
};

export default UserSettings;
