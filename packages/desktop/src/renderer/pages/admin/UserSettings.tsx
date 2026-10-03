/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Form, Input, Message, Modal, Table, Tag } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { adminApi } from './adminApi';
import type { AdminUser } from './adminApi';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import SettingsPageWrapper from '@renderer/pages/settings/components/SettingsPageWrapper';

type PasswordDialog = { mode: 'create' } | { mode: 'reset'; user: AdminUser } | null;

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
    if (user?.is_super_admin) void reload();
  }, [reload, user?.is_super_admin]);

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

  if (user && !user.is_super_admin) {
    return <Navigate to='/settings/agent' replace />;
  }

  const never = t('settings.userManagement.never');
  const columns: TableColumnProps<AdminUser>[] = [
    {
      title: t('settings.userManagement.username'),
      dataIndex: 'username',
      render: (_: unknown, row) => (
        <span className='inline-flex items-center gap-6px'>
          {row.username}
          {row.is_super_admin && <Tag color='arcoblue'>{t('settings.userManagement.superAdmin')}</Tag>}
        </span>
      ),
    },
    {
      title: t('settings.userManagement.status'),
      dataIndex: 'status',
      render: (_: unknown, row) =>
        row.status === 'active' ? (
          <Tag color='green'>{t('settings.userManagement.active')}</Tag>
        ) : (
          <Tag color='gray'>{t('settings.userManagement.disabled')}</Tag>
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
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-16px font-600 text-t-primary'>{t('settings.userManagement.title')}</div>
            <div className='text-12px text-t-tertiary mt-4px'>{t('settings.userManagement.description')}</div>
          </div>
          <Button type='primary' onClick={() => openDialog({ mode: 'create' })}>
            {t('settings.userManagement.newUser')}
          </Button>
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
