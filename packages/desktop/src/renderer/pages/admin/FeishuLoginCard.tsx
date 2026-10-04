/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Collapse, Form, Input, Message, Radio, Switch, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { adminApi, buildFeishuConfigPayload } from './adminApi';
import type { FeishuLoginConfig, FeishuLoginForm } from './adminApi';

const P = 'settings.userManagement.feishu';

function toForm(config: FeishuLoginConfig): FeishuLoginForm {
  return {
    enabled: config.enabled,
    app_id: config.app_id,
    app_secret: '',
    public_base_url: config.public_base_url || window.location.origin,
    api_base: config.api_base ?? '',
    accounts_base: config.accounts_base ?? '',
    signup_policy: config.signup_policy ?? 'approval',
  };
}

/** Super-admin card configuring Feishu OAuth login. */
const FeishuLoginCard: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm<FeishuLoginForm>();
  const [config, setConfig] = useState<FeishuLoginConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback(
    (next: FeishuLoginConfig) => {
      setConfig(next);
      form.setFieldsValue(toForm(next));
    },
    [form]
  );

  useEffect(() => {
    adminApi
      .getFeishuLogin()
      .then(apply)
      .catch(() => Message.error(t(`${P}.loadFailed`)));
  }, [apply, t]);

  const save = async (clearTenantKey = false) => {
    const values = form.getFieldsValue() as FeishuLoginForm;
    setSaving(true);
    try {
      apply(await adminApi.saveFeishuLogin(buildFeishuConfigPayload(values, clearTenantKey)));
      Message.success(t(`${P}.saved`));
    } catch (error) {
      const message = error instanceof BackendHttpError && error.status === 400 ? error.backendMessage : undefined;
      Message.error(message || t(`${P}.saveFailed`));
    } finally {
      setSaving(false);
    }
  };

  const callbackUrl = config?.callback_url || '';
  const copyCallback = () => {
    void navigator.clipboard.writeText(callbackUrl).then(() => Message.success(t(`${P}.copied`)));
  };

  return (
    <Card title={t(`${P}.title`)} data-testid='feishu-login-card' bordered>
      <Form form={form} layout='vertical' disabled={!config}>
        <Form.Item label={t(`${P}.enabled`)} field='enabled' triggerPropName='checked'>
          <Switch data-testid='feishu-enabled' />
        </Form.Item>
        <Form.Item label='App ID' field='app_id'>
          <Input autoComplete='off' placeholder='cli_xxxxxxxx' data-testid='feishu-app-id' />
        </Form.Item>
        <Form.Item label='App Secret' field='app_secret'>
          <Input.Password
            autoComplete='new-password'
            data-testid='feishu-app-secret'
            placeholder={config?.app_secret_set ? t(`${P}.secretKept`) : t(`${P}.secretRequired`)}
          />
        </Form.Item>
        <Form.Item label={t(`${P}.publicBaseUrl`)} field='public_base_url' extra={t(`${P}.publicBaseUrlHint`)}>
          <Input placeholder='https://aidi.example.com' data-testid='feishu-public-base-url' />
        </Form.Item>
        <Form.Item label={t(`${P}.callbackUrl`)}>
          <Input
            readOnly
            value={callbackUrl}
            data-testid='feishu-callback-url'
            addAfter={
              <Button size='mini' type='text' disabled={!callbackUrl} onClick={copyCallback}>
                {t(`${P}.copy`)}
              </Button>
            }
          />
        </Form.Item>
        <Form.Item label={t(`${P}.tenantKey`)}>
          <span className='inline-flex items-center gap-8px'>
            <Typography.Text data-testid='feishu-tenant-key'>
              {config?.tenant_key || t(`${P}.tenantUnlocked`)}
            </Typography.Text>
            {config?.tenant_key && (
              <Button size='mini' onClick={() => void save(true)}>
                {t(`${P}.clearTenant`)}
              </Button>
            )}
          </span>
        </Form.Item>
        <Form.Item label={t(`${P}.signupPolicy`)} field='signup_policy' extra={t(`${P}.signupPolicyHint`)}>
          <Radio.Group data-testid='feishu-signup-policy'>
            <Radio value='approval'>{t(`${P}.signupApproval`)}</Radio>
            <Radio value='open'>{t(`${P}.signupOpen`)}</Radio>
          </Radio.Group>
        </Form.Item>
        <Collapse bordered={false}>
          <Collapse.Item header={t(`${P}.advanced`)} name='advanced'>
            <Form.Item label={t(`${P}.apiBase`)} field='api_base'>
              <Input placeholder='https://open.feishu.cn' data-testid='feishu-api-base' />
            </Form.Item>
            <Form.Item label={t(`${P}.accountsBase`)} field='accounts_base'>
              <Input placeholder='https://accounts.feishu.cn' data-testid='feishu-accounts-base' />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
        <div className='text-12px text-t-tertiary my-12px whitespace-pre-line'>{t(`${P}.guide`)}</div>
        <Button type='primary' loading={saving} onClick={() => void save()} data-testid='feishu-save'>
          {t(`${P}.save`)}
        </Button>
      </Form>
    </Card>
  );
};

export default FeishuLoginCard;
