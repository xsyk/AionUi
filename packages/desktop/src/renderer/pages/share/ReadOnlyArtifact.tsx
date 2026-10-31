import React, { useMemo } from 'react';
import { Card, Collapse } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IConversationArtifact } from '@/common/adapter/ipcBridge';
import MarkdownView from '@/renderer/components/Markdown';
import SharedResource from './SharedResource';

const ReadOnlyArtifact: React.FC<{ artifact: IConversationArtifact; token: string }> = ({ artifact, token }) => {
  const { t } = useTranslation();
  const renderResource = useMemo(
    () => (path: string, label: React.ReactNode, kind: 'image' | 'file') => (
      <SharedResource token={token} path={path} label={label} kind={kind} />
    ),
    [token]
  );
  if (artifact.kind === 'cron_trigger') {
    if (artifact.status !== 'active') return null;
    return (
      <Card size='small' data-testid='shared-cron-trigger'>
        {t('cron.trigger.runScheduledTask', { name: artifact.payload.cron_job_name })}
      </Card>
    );
  }
  if (artifact.status !== 'pending') return null;
  const content = artifact.payload.skillContent || artifact.payload.skill_content || '';
  return (
    <Card size='small' title={t('cron.skill.turnIntoSkill')} data-testid='shared-skill-suggest'>
      <div className='font-500 mb-4px'>{artifact.payload.name}</div>
      <div className='text-t-secondary'>{artifact.payload.description}</div>
      {content && (
        <Collapse bordered={false}>
          <Collapse.Item name={artifact.id} header={t('cron.skill.preview')}>
            <MarkdownView renderResource={renderResource}>{`\`\`\`markdown\n${content}\n\`\`\``}</MarkdownView>
          </Collapse.Item>
        </Collapse>
      )}
    </Card>
  );
};
export default ReadOnlyArtifact;
