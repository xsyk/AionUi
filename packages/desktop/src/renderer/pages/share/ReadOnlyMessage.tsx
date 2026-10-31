import React, { useMemo } from 'react';
import { Alert, Badge, Card, Collapse, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TMessage } from '@/common/chat/chatLib';
import { isSuppressedTip } from '@/common/chat/chatLib';
import {
  normalizeAcpToolCall,
  normalizeToolCall,
  normalizeToolGroup,
  type NormalizedToolCall,
} from '@/common/chat/normalizeToolCall';
import MarkdownView from '@/renderer/components/Markdown';
import { parseFileMarker } from '@/renderer/pages/conversation/Messages/components/fileMarker';
import {
  parseSessionMessageBlock,
  parseSessionsBlock,
} from '@/renderer/pages/conversation/Messages/components/sessionMarkers';
import { stripThinkTags } from '@/renderer/utils/chat/thinkTagFilter';
import { stripSkillSuggest } from '@/renderer/utils/chat/skillSuggestParser';
import SharedResource from './SharedResource';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';
import MessageCronBadge from '@/renderer/pages/conversation/Messages/components/MessageCronBadge';
import { createTwoFilesPatch } from 'diff';

const ToolDetails: React.FC<{ tool: NormalizedToolCall; token: string; children?: React.ReactNode }> = ({
  tool,
  token,
  children,
}) => {
  const { t } = useTranslation();
  return (
    <Collapse bordered={false} className='w-full'>
      <Collapse.Item
        name={tool.key}
        header={
          <span className='flex items-center gap-8px'>
            <Badge status={tool.status === 'error' ? 'error' : tool.status === 'completed' ? 'success' : 'default'} />
            <span>{tool.name}</span>
          </span>
        }
      >
        {tool.description && <div className='text-t-secondary mb-8px'>{tool.description}</div>}
        {tool.input && (
          <>
            <div className='text-t-secondary text-12px'>{t('conversation.sharing.toolInput')}</div>
            <pre className='whitespace-pre-wrap break-all text-12px'>{tool.input}</pre>
          </>
        )}
        {tool.output && (
          <>
            <div className='text-t-secondary text-12px'>{t('conversation.sharing.toolOutput')}</div>
            <pre className='whitespace-pre-wrap break-all text-12px'>{tool.output}</pre>
          </>
        )}
        {children}
        {tool.status === 'completed' && tool.imagePath && (
          <SharedResource token={token} path={tool.imagePath} kind='image' label={tool.name} />
        )}
      </Collapse.Item>
    </Collapse>
  );
};

/** Display persisted content without any runtime, approval, fork or private-file hooks. */
const ReadOnlyMessage: React.FC<{ message: TMessage; token: string }> = ({ message, token }) => {
  const { t } = useTranslation();
  const renderResource = useMemo(
    () => (path: string, label: React.ReactNode, kind: 'image' | 'file') => (
      <SharedResource token={token} path={path} kind={kind} label={label} />
    ),
    [token]
  );
  if (message.hidden || isSuppressedTip(message)) return null;
  if (message.type === 'thinking') return <MessageThinking message={message} />;
  if (message.type === 'tips') return <Alert type={message.content.type || 'info'} content={message.content.content} />;
  if (message.type === 'agent_status') {
    const { status, backend, agent_name } = message.content;
    if ((status as string) === 'disconnected') return null;
    return (
      <Badge
        status={status === 'error' ? 'error' : status === 'connecting' ? 'processing' : 'success'}
        text={t(`acp.status.${status}`, { agent: agent_name || backend })}
      />
    );
  }
  if (message.type === 'ask')
    return (
      <Card size='small'>
        {message.content.questions.map((question, index) => (
          <div key={index} className='mb-12px'>
            {question.header && <div className='text-t-secondary text-12px'>{question.header}</div>}
            <div className='font-500 mb-8px'>{question.question}</div>
            {question.options.map((option) => (
              <div key={option.label} className='mb-4px'>
                <Tag>{option.label}</Tag>
                {option.description && <span className='text-t-secondary ml-8px'>{option.description}</span>}
              </div>
            ))}
          </div>
        ))}
      </Card>
    );
  if (message.type === 'acp_permission') {
    const { tool_call, options } = message.content;
    return (
      <Card size='small' title={tool_call?.title || t('messages.permissionRequest')}>
        {tool_call?.raw_input && (
          <pre className='whitespace-pre-wrap break-all text-12px'>{JSON.stringify(tool_call.raw_input, null, 2)}</pre>
        )}
        <div className='flex flex-wrap gap-8px'>
          {options?.map((option, index) => (
            <Tag key={index}>{option.name}</Tag>
          ))}
        </div>
      </Card>
    );
  }
  if (message.type === 'permission')
    return (
      <Card size='small' title={message.content.title || t('messages.permissionRequest')}>
        <div className='whitespace-pre-wrap break-words mb-8px'>{message.content.description}</div>
        <div className='flex flex-wrap gap-8px'>
          {message.content.options?.map((option, index) => (
            <Tag key={index}>{option.label}</Tag>
          ))}
        </div>
      </Card>
    );
  if (message.type === 'plan')
    return (
      <Card size='small' title={t('conversation.planBar.title')}>
        <ul className='m-0 pl-20px'>
          {message.content.entries.map((entry, index) => (
            <li key={index} className='mb-6px'>
              <Badge
                status={
                  entry.status === 'completed' ? 'success' : entry.status === 'in_progress' ? 'processing' : 'default'
                }
              />{' '}
              <span>{entry.content}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  const classes = message.position === 'right' ? 'rounded-12px bg-2 p-12px ml-auto max-w-full' : 'w-full';
  if (message.type === 'text') {
    const content = message.content.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    const parsed = parseFileMarker(content, message.position === 'right');
    const isUserMessage = message.position === 'right';
    const { text, sessions } = isUserMessage ? parseSessionsBlock(parsed.text) : { text: parsed.text, sessions: [] };
    const { text: visible, source } = isUserMessage ? parseSessionMessageBlock(text) : { text, source: null };
    const { cronMeta, teammateMessage, senderName } = message.content;
    return (
      <div className={classes} data-testid='shared-message'>
        {cronMeta && (
          <div data-testid='shared-cron-badge'>
            <MessageCronBadge meta={cronMeta} />
          </div>
        )}
        {!isUserMessage && teammateMessage && senderName && (
          <div className='text-12px text-t-secondary mb-4px'>
            {senderName === 'team_system' ? t('team.systemNotice.sender') : senderName}
          </div>
        )}
        {source && (
          <div className='flex flex-wrap gap-4px mb-4px'>
            <Tag>{t('conversation.crossSession.fromBadge', { name: source.fromName || source.fromId })}</Tag>
            {source.workspace && source.workspace !== 'same' && (
              <Tag title={source.workspace}>{t('conversation.crossSession.otherWorkspace')}</Tag>
            )}
          </div>
        )}
        {sessions.length > 0 && (
          <div className='flex flex-wrap gap-4px mb-4px'>
            {sessions.map((session) => (
              <Tag key={session.id} title={session.workspace}>{`@@${session.name}`}</Tag>
            ))}
          </div>
        )}
        {parsed.files.map((path) => (
          <SharedResource
            key={path}
            token={token}
            path={path}
            kind={/\.(?:png|jpe?g|gif|webp|avif)$/i.test(path) ? 'image' : 'file'}
            label={path.split(/[/\\]/).pop()}
          />
        ))}
        {message.position === 'right' ? (
          <div className='whitespace-pre-wrap break-words'>{visible}</div>
        ) : (
          <MarkdownView renderResource={renderResource}>{stripSkillSuggest(stripThinkTags(visible))}</MarkdownView>
        )}
      </div>
    );
  }
  if (message.type === 'acp_tool_call') {
    const tool = normalizeAcpToolCall(message);
    if (!tool) return null;
    return (
      <ToolDetails tool={{ ...tool, output: undefined }} token={token}>
        {message.content.update.content?.map((item, index) => {
          if (item.type === 'diff') {
            const path = item.path || '';
            const patch = createTwoFilesPatch(path, path, item.old_text || '', item.new_text || '', '', '', {
              context: Infinity,
            });
            return (
              <div key={index} className='mt-8px'>
                {path && <div className='font-500 break-all mb-4px'>{path}</div>}
                <pre data-testid='shared-tool-diff' className='whitespace-pre-wrap break-all text-12px'>
                  {patch}
                </pre>
              </div>
            );
          }
          return item.content?.text ? (
            <MarkdownView key={index} renderResource={renderResource}>
              {item.content.text}
            </MarkdownView>
          ) : null;
        })}
      </ToolDetails>
    );
  }
  const tools =
    message.type === 'tool_group'
      ? normalizeToolGroup(message)
      : message.type === 'tool_call'
        ? [normalizeToolCall(message)]
        : [];
  if (tools.length)
    return (
      <div>
        {tools
          .filter((tool): tool is NormalizedToolCall => Boolean(tool))
          .map((tool) => (
            <ToolDetails key={tool.key} tool={tool} token={token} />
          ))}
      </div>
    );
  // Pending questions/permissions are historical content here, never actionable controls.
  return (
    <Collapse bordered={false}>
      <Collapse.Item name={message.id} header={message.type}>
        <pre className='whitespace-pre-wrap break-all text-12px'>{JSON.stringify(message.content, null, 2)}</pre>
      </Collapse.Item>
    </Collapse>
  );
};
export default ReadOnlyMessage;
