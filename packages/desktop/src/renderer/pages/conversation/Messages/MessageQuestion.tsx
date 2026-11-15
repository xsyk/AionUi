/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversation } from '@/common/adapter/ipcBridge';
import type { IAskQuestion, IMessageAsk } from '@/common/chat/chatLib';
import { Button, Card, Checkbox, Input, Radio } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
// The permission panel's stylesheet supplies the shared card chrome; own.* adds
// the question-specific pieces (option rows with secondary description lines),
// built on the same tokens so the two cards read as siblings (user feedback,
// 2026-08-04: same style family, and long text must wrap instead of clipping).
import styles from './components/MessagePermission/PermissionRequestPanel.module.css';
import own from './MessageQuestion.module.css';

const OTHER_VALUE = '__aionui_other__';

type MessageQuestionProps = {
  message: IMessageAsk;
};

type Draft = {
  /** selected option labels (multiSelect keeps several; single keeps one) */
  labels: string[];
  /** free text when the Other row is selected */
  other: string;
  otherSelected: boolean;
};

const emptyDraft = (): Draft => ({ labels: [], other: '', otherSelected: false });

/**
 * Structured question card (`ask` frame — claude AskUserQuestion).
 *
 * One submit answers EVERY question at once: claude silently DROPS unanswered
 * questions on an allow (it does not re-ask — live 2.1.178), so per-question
 * submission would be silent data loss. Submit stays disabled until every
 * question has an answer; dismiss sends an explicit decline (a deny on the
 * wire), never an empty allow.
 */
const MessageQuestion: React.FC<MessageQuestionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const content = message.content || ({} as IMessageAsk['content']);
  const questions = useMemo<IAskQuestion[]>(
    () => (Array.isArray(content.questions) ? content.questions : []),
    [content.questions]
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const [submitted, setSubmitted] = useState<'answered' | 'declined' | null>(null);
  const [pendingAction, setPendingAction] = useState<'answer' | 'decline' | null>(null);
  const [hasError, setHasError] = useState(false);
  const submittingRef = useRef(false);
  const isSubmitting = pendingAction !== null;
  const disabled = isSubmitting || submitted !== null;

  const updateDraft = useCallback((index: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const answered = (d: Draft) => d.labels.length > 0 || (d.otherSelected && d.other.trim().length > 0);
  const allAnswered = questions.length > 0 && drafts.every(answered);

  const requestId = content.request_id || message.id;

  const handleRespond = useCallback(
    async (decline: boolean) => {
      if (submittingRef.current || submitted !== null || (!decline && !allAnswered)) return;
      submittingRef.current = true;
      setPendingAction(decline ? 'decline' : 'answer');
      setHasError(false);

      try {
        // Answer every question over the dedicated ask channel. Other-text
        // rides as a plain label; declining must never send an empty allow.
        const response = decline
          ? { decline: true }
          : {
              answers: questions.map((q, i) => {
                const d = drafts[i];
                const labels = [...d.labels];
                if (d.otherSelected && d.other.trim()) labels.push(d.other.trim());
                return { question: q.question, labels, ...(q.id ? { question_id: q.id } : {}) };
              }),
            };
        await conversation.answerAsk.invoke({
          conversation_id: message.conversation_id,
          request_id: requestId,
          ...response,
        });
        setSubmitted(decline ? 'declined' : 'answered');
      } catch {
        setHasError(true);
      } finally {
        submittingRef.current = false;
        setPendingAction(null);
      }
    },
    [allAnswered, drafts, questions, message.conversation_id, requestId, submitted]
  );

  if (!questions.length) return null;

  return (
    <Card className={styles.card} bordered={false} data-testid='message-question'>
      <div className={styles.panel} aria-busy={isSubmitting}>
        {questions.map((q, qi) => {
          const d = drafts[qi] ?? emptyDraft();
          // Wire spelling is multi_select (the ws relay snake_cases all keys).
          const multi = q.multiSelect === true || q.multi_select === true;
          return (
            <div key={qi} className={own.questionBlock} data-testid={`message-question-item-${qi}`}>
              {q.header ? <div className={own.header}>{q.header}</div> : null}
              <div className={own.question}>{q.question}</div>
              {multi ? (
                <Checkbox.Group
                  className={own.optionList}
                  value={d.labels}
                  onChange={(labels) => updateDraft(qi, { labels: labels as string[] })}
                  disabled={disabled}
                >
                  {q.options.map((opt) => (
                    <Checkbox
                      key={opt.label}
                      className={own.optionRow}
                      value={opt.label}
                      data-testid={`message-question-option-${qi}-${opt.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{opt.label}</span>
                        {opt.description ? <span className={own.optionDesc}>{opt.description}</span> : null}
                      </span>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  className={own.optionList}
                  value={d.otherSelected ? OTHER_VALUE : d.labels[0]}
                  onChange={(value) =>
                    value === OTHER_VALUE
                      ? updateDraft(qi, { labels: [], otherSelected: true })
                      : updateDraft(qi, { labels: [value], otherSelected: false })
                  }
                  disabled={disabled}
                >
                  {q.options.map((opt) => (
                    <Radio
                      key={opt.label}
                      className={own.optionRow}
                      value={opt.label}
                      data-testid={`message-question-option-${qi}-${opt.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{opt.label}</span>
                        {opt.description ? <span className={own.optionDesc}>{opt.description}</span> : null}
                      </span>
                    </Radio>
                  ))}
                  <Radio
                    className={own.optionRow}
                    value={OTHER_VALUE}
                    data-testid={`message-question-option-${qi}-other`}
                  >
                    <span className={own.optionText}>
                      <span className={own.optionLabel}>{t('messages.askOther')}</span>
                    </span>
                  </Radio>
                  {d.otherSelected ? (
                    <Input
                      className={own.otherInput}
                      placeholder={t('messages.askOtherPlaceholder')}
                      value={d.other}
                      onChange={(v) => updateDraft(qi, { other: v })}
                      disabled={disabled}
                      data-testid={`message-question-other-input-${qi}`}
                    />
                  ) : null}
                </Radio.Group>
              )}
            </div>
          );
        })}
        {hasError && (
          <div className={`${styles.feedback} ${styles.error}`} role='alert' data-testid='message-question-error'>
            {t('messages.permissionResponseFailed')}
          </div>
        )}
        {submitted === null ? (
          // Plain Arco buttons on purpose: styles.optionButton resets the button
          // chrome to a transparent full-width list row (for permission option
          // lists), which turned the primary submit into white-on-white.
          <div className={own.actions}>
            <Button
              type='primary'
              size='small'
              disabled={!allAnswered || isSubmitting}
              loading={pendingAction === 'answer'}
              onClick={() => void handleRespond(false)}
              data-testid='message-question-submit'
            >
              {t('messages.askSubmit')}
            </Button>
            <Button
              size='small'
              disabled={isSubmitting}
              loading={pendingAction === 'decline'}
              onClick={() => void handleRespond(true)}
              data-testid='message-question-decline'
            >
              {t('messages.askDecline')}
            </Button>
          </div>
        ) : (
          <div
            className={`${styles.feedback} ${styles.success}`}
            role='status'
            aria-live='polite'
            data-testid='message-question-status'
          >
            <CheckOne theme='outline' size='16' aria-hidden='true' />
            <span>{submitted === 'answered' ? t('messages.askAnswered') : t('messages.askDeclined')}</span>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageQuestion;
