import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Message, Modal, Space, Spin, Switch, Tooltip, Typography } from '@arco-design/web-react';
import { Copy, LinkOne, Share } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { httpRequest } from '@/common/adapter/httpBridge';
import { copyText } from '@/renderer/utils/ui/clipboard';
import {
  buildShareUrl,
  ensureCsrfCookie,
  readCsrfCookie,
  type FeishuBinding,
  type FeishuBindingCode,
  type ShareState,
} from './shareApi';

type Panel = 'share' | 'feishu' | null;

/** Owner-managed server Web controls; authorization is enforced by Core on every request. */
const ConversationConnections: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [binding, setBinding] = useState<FeishuBinding | null>(null);
  const [code, setCode] = useState<FeishuBindingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const prefix = `/api/conversations/${encodeURIComponent(conversationId)}`;
  const headers = () => ({ 'x-csrf-token': readCsrfCookie() });
  const loadBinding = useCallback(async () => {
    const data = await httpRequest<{ binding: FeishuBinding | null }>('GET', `${prefix}/feishu-binding`);
    setBinding(data.binding);
    if (data.binding) setCode(null);
  }, [prefix]);
  useEffect(() => {
    if (!panel) return;
    let cancelled = false;
    setBusy(true);
    setFailed(false);
    setShare(null);
    setBinding(null);
    setCode(null);
    const pending =
      panel === 'share'
        ? httpRequest<ShareState>('GET', `${prefix}/share`).then((value) => {
            if (!cancelled) setShare(value);
          })
        : loadBinding();
    void pending
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel, prefix, loadBinding]);
  useEffect(() => {
    if (panel !== 'feishu' || !code) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= code.expires_at) {
        setCode(null);
        return;
      }
      void loadBinding().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [panel, code, loadBinding]);
  const toggleShare = async (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await ensureCsrfCookie();
      setShare(await httpRequest<ShareState>('PUT', `${prefix}/share`, { enabled }, { headers: headers() }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const generateCode = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await ensureCsrfCookie();
      setCode(
        await httpRequest<FeishuBindingCode>('POST', `${prefix}/feishu-binding`, undefined, { headers: headers() })
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const unbind = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await ensureCsrfCookie();
      await httpRequest('DELETE', `${prefix}/feishu-binding`, undefined, { headers: headers() });
      setBinding(null);
      setCode(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await copyText(text);
      Message.success(t('common.copySuccess'));
    } catch {
      Message.error(t('common.copyFailed'));
    }
  };
  if (typeof window === 'undefined' || window.electronAPI) return null;
  const url = share?.token ? buildShareUrl(window.location.origin, share.token) : '';
  const command = code ? `/bind ${code.bind_code}` : '';
  return (
    <>
      <Tooltip content={t('conversation.sharing.manageTitle')}>
        <Button
          type='text'
          size='small'
          aria-label={t('conversation.sharing.manageTitle')}
          icon={<Share />}
          onClick={() => setPanel('share')}
        />
      </Tooltip>
      <Tooltip content={t('conversation.feishuBinding.title')}>
        <Button
          type='text'
          size='small'
          aria-label={t('conversation.feishuBinding.title')}
          icon={<LinkOne />}
          onClick={() => setPanel('feishu')}
        />
      </Tooltip>
      <Modal
        title={t(panel === 'feishu' ? 'conversation.feishuBinding.title' : 'conversation.sharing.manageTitle')}
        visible={Boolean(panel)}
        footer={null}
        onCancel={() => setPanel(null)}
        unmountOnExit
      >
        {failed && <Alert type='error' content={t('conversation.sharing.requestFailed')} className='mb-16px' />}
        {panel === 'share' ? (
          <Space direction='vertical' className='w-full' size='large'>
            <div className='flex items-center justify-between gap-16px'>
              <span>{t('conversation.sharing.enabled')}</span>
              <Switch
                checked={share?.enabled ?? false}
                disabled={!share || busy}
                loading={busy}
                onChange={(enabled) => void toggleShare(enabled)}
              />
            </div>
            <Typography.Paragraph className='text-t-secondary !mb-0'>
              {t('conversation.sharing.description')}
            </Typography.Paragraph>
            {url && (
              <>
                <Input readOnly value={url} aria-label={t('conversation.sharing.link')} />
                <Button icon={<Copy />} long onClick={() => void copy(url)}>
                  {t('conversation.sharing.copyLink')}
                </Button>
                {!share?.enabled && <Alert type='warning' content={t('conversation.sharing.disabled')} />}
              </>
            )}
          </Space>
        ) : (
          <Space direction='vertical' className='w-full' size='large'>
            <Typography.Paragraph className='text-t-secondary !mb-0'>
              {t('conversation.feishuBinding.description')}
            </Typography.Paragraph>
            {busy && !binding && !code ? (
              <Spin />
            ) : binding ? (
              <>
                <Alert
                  type='success'
                  content={t('conversation.feishuBinding.connected', {
                    type: t(
                      binding.chat_type === 'group'
                        ? 'conversation.feishuBinding.group'
                        : 'conversation.feishuBinding.direct'
                    ),
                  })}
                />
                <Typography.Text copyable>{binding.chat_id}</Typography.Text>
                <Button status='danger' loading={busy} onClick={() => void unbind()}>
                  {t('conversation.feishuBinding.unbind')}
                </Button>
              </>
            ) : code ? (
              <>
                <Alert type='info' content={t('conversation.feishuBinding.instructions')} />
                <Input readOnly value={command} aria-label={t('conversation.feishuBinding.command')} />
                <Button icon={<Copy />} onClick={() => void copy(command)}>
                  {t('conversation.feishuBinding.copyCommand')}
                </Button>
                <Typography.Text type='secondary'>
                  {t('conversation.feishuBinding.expires', { time: new Date(code.expires_at).toLocaleTimeString() })}
                </Typography.Text>
              </>
            ) : (
              <Button type='primary' loading={busy} onClick={() => void generateCode()}>
                {t('conversation.feishuBinding.generate')}
              </Button>
            )}
          </Space>
        )}
      </Modal>
    </>
  );
};
export default ConversationConnections;
