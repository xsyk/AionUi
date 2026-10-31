import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin, Typography } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { IConversationArtifact } from '@/common/adapter/ipcBridge';
import ReadOnlyArtifact from './ReadOnlyArtifact';
import type { TMessage } from '@/common/chat/chatLib';
import ReadOnlyMessage from './ReadOnlyMessage';
import { readPublicArtifacts, readPublicMessages, readPublicShare, type SharedConversation } from './shareApi';

/** Anonymous page: it intentionally does not mount authenticated app providers. */
const PublicSharePage: React.FC<{ token: string }> = ({ token }) => {
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [artifacts, setArtifacts] = useState<IConversationArtifact[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setFailed(false);
      try {
        const [metadata, page, cards] = await Promise.all([
          readPublicShare(token, signal),
          readPublicMessages(token, undefined, signal),
          readPublicArtifacts(token, signal),
        ]);
        if (signal?.aborted) return;
        setConversation(metadata);
        setArtifacts(cards);
        setMessages(page.items.filter((message) => !message.hidden));
        setBefore(page.has_more_before ? page.oldest_cursor : null);
      } catch {
        if (signal?.aborted) return;
        setConversation(null);
        setMessages([]);
        setFailed(true);
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [token]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow,noarchive';
    document.head.append(robots);
    return () => {
      controller.abort();
      meta.remove();
      robots.remove();
    };
  }, [load]);
  const older = async () => {
    if (!before || busy) return;
    setBusy(true);
    try {
      const page = await readPublicMessages(token, before);
      setMessages((current) => [...page.items.filter((message) => !message.hidden), ...current]);
      setBefore(page.has_more_before ? page.oldest_cursor : null);
    } catch {
      setConversation(null);
      setMessages([]);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      className='h-full overflow-y-auto overflow-x-hidden box-border bg-base text-t-primary px-16px py-24px'
      data-testid='public-share-page'
    >
      <div className='max-w-900px mx-auto'>
        <header className='flex items-center justify-between gap-16px mb-20px'>
          <div>
            <Typography.Title heading={4} className='!m-0'>
              {conversation?.name || t('conversation.sharing.pageTitle')}
            </Typography.Title>
            <div className='text-12px text-t-secondary mt-6px'>{t('conversation.sharing.readOnly')}</div>
          </div>
          <Button icon={<Refresh />} loading={busy} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
        </header>
        {failed ? (
          <Alert type='warning' content={t('conversation.sharing.unavailable')} />
        ) : (
          <>
            {before && (
              <div className='flex justify-center mb-16px'>
                <Button loading={busy} onClick={() => void older()}>
                  {t('conversation.sharing.loadEarlier')}
                </Button>
              </div>
            )}
            {busy && !conversation ? (
              <div className='flex justify-center p-32px'>
                <Spin />
              </div>
            ) : messages.length ||
              artifacts.some((artifact) => artifact.status === 'active' || artifact.status === 'pending') ? (
              <section className='flex flex-col gap-20px'>
                {[
                  ...messages.map((message) => ({
                    key: message.id,
                    created: message.created_at || 0,
                    element: <ReadOnlyMessage key={message.id} message={message} token={token} />,
                  })),
                  ...artifacts
                    .filter((artifact) => !before || artifact.created_at >= (messages[0]?.created_at || 0))
                    .map((artifact) => ({
                      key: artifact.id,
                      created: artifact.created_at,
                      element: <ReadOnlyArtifact key={artifact.id} artifact={artifact} token={token} />,
                    })),
                ]
                  .sort((a, b) => a.created - b.created)
                  .map((item) => item.element)}
              </section>
            ) : (
              <Empty description={t('conversation.sharing.empty')} />
            )}
          </>
        )}
      </div>
    </main>
  );
};
export default PublicSharePage;
