import React, { useEffect, useState } from 'react';
import { Button, Image, Message, Spin } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { readPublicResource } from './shareApi';
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/** Fetch token-scoped files before creating a local URL; the token never enters an img URL. */
const SharedResource: React.FC<{ token: string; path: string; kind: 'image' | 'file'; label?: React.ReactNode }> = ({
  token,
  path,
  kind,
  label,
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind === 'image');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (kind !== 'image') return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    setUrl(null);
    setUnavailable(false);
    void readPublicResource(token, path, false, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted || !INLINE_IMAGE_TYPES.has(blob.type.split(';')[0])) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, path, kind]);
  const download = async () => {
    setLoading(true);
    try {
      const blob = await readPublicResource(token, path, true);
      const localUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = localUrl;
      anchor.download = path.split(/[/\\]/).pop() || 'download';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
    } catch {
      setUnavailable(true);
      Message.error(t('conversation.sharing.resourceUnavailable'));
    } finally {
      setLoading(false);
    }
  };
  if (url && kind === 'image')
    return <Image src={url} alt={typeof label === 'string' ? label : ''} className='max-w-full' />;
  if (loading && kind === 'image') return <Spin />;
  return (
    <span className='inline-flex flex-col items-start'>
      <Button type='text' icon={<Download />} loading={loading} onClick={() => void download()}>
        {label || path.split(/[/\\]/).pop()}
      </Button>
      {unavailable && (
        <span className='text-12px text-t-secondary'>{t('conversation.sharing.resourceUnavailable')}</span>
      )}
    </span>
  );
};
export default SharedResource;
