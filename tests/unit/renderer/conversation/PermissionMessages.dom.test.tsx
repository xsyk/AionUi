/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpPermission, IMessageAsk, IMessagePermission } from '@/common/chat/chatLib';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';

const { genericInvoke, acpInvoke, answerAskInvoke } = vi.hoisted(() => ({
  genericInvoke: vi.fn(),
  acpInvoke: vi.fn(),
  answerAskInvoke: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        confirm: {
          invoke: genericInvoke,
        },
      },
    },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    confirmMessage: {
      invoke: acpInvoke,
    },
    answerAsk: {
      invoke: answerAskInvoke,
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const makeGenericMessage = (id = 'generic-message-1'): IMessagePermission => ({
  id,
  msg_id: `db-${id}`,
  conversation_id: 'conversation-1',
  type: 'permission',
  position: 'left',
  content: {
    id: `confirmation-${id}`,
    title: 'Run command',
    description: 'Permission required',
    action: 'exec',
    call_id: `call-${id}`,
    command_type: 'npm install',
    options: [
      { label: 'Always allow', value: 'proceed_always' },
      { label: 'Allow once', value: 'proceed_once' },
      { label: 'Cancel', value: 'cancel' },
    ],
  },
});

const makeAcpMessage = (): IMessageAcpPermission => ({
  id: 'acp-message-1',
  conversation_id: 'conversation-1',
  type: 'acp_permission',
  position: 'left',
  content: {
    session_id: 'session-1',
    tool_call: {
      tool_call_id: 'tool-call-1',
      title: 'Edit package.json',
      kind: 'edit',
      raw_input: { command: 'apply patch', description: 'Update one dependency' },
    },
    options: [
      { option_id: 'allow-always-id', name: 'Always allow', kind: 'allow_always' },
      { option_id: 'allow-once-id', name: 'Allow once', kind: 'allow_once' },
      { option_id: 'reject-once-id', name: 'Reject', kind: 'reject_once' },
    ],
  },
});

const makeAskMessage = (): IMessageAsk => ({
  id: 'ask-message-1',
  conversation_id: 'conversation-1',
  type: 'ask',
  position: 'left',
  content: {
    session_id: 'session-1',
    request_id: 'ask-request-1',
    questions: [
      {
        question: 'Which features?',
        multi_select: true,
        options: [{ label: 'Fast' }, { label: 'Safe' }],
      },
      { question: 'Which platform?', options: [{ label: 'Linux' }] },
    ],
  },
});

const fillAskDraft = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Fast' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Safe' }));
  fireEvent.click(screen.getByRole('radio', { name: 'messages.askOther' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  My custom platform  ' } });
};

const deferredAnswer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const askFailure = () =>
  new BackendHttpError({
    method: 'POST',
    path: '/api/conversations/conversation-1/asks/ask-request-1/answer',
    status: 500,
    body: { error: 'private backend details: token=secret-test-token' },
  });

const askActions = [
  { action: 'submit', status: 'messages.askAnswered' },
  { action: 'decline', status: 'messages.askDeclined' },
] as const;

describe('question card submission', () => {
  beforeEach(() => {
    answerAskInvoke.mockReset().mockResolvedValue(undefined);
  });

  it.each(askActions)('shows a safe localized failure when $action is rejected', async ({ action }) => {
    answerAskInvoke.mockRejectedValueOnce(askFailure());
    render(<MessageQuestion message={makeAskMessage()} />);
    fillAskDraft();

    fireEvent.click(screen.getByTestId(`message-question-${action}`));

    expect(await screen.findByRole('alert')).toHaveTextContent('messages.permissionResponseFailed');
    expect(screen.queryByTestId('message-question-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-question')).not.toHaveTextContent('secret-test-token');
  });

  it.each(askActions)('preserves selections and free text after $action fails', async ({ action }) => {
    answerAskInvoke.mockRejectedValueOnce(askFailure());
    render(<MessageQuestion message={makeAskMessage()} />);
    fillAskDraft();

    fireEvent.click(screen.getByTestId(`message-question-${action}`));
    await screen.findByRole('alert');

    expect(screen.getByRole('checkbox', { name: 'Fast' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Safe' })).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('  My custom platform  ');
  });

  it.each(askActions)(
    'allows $action to retry and waits for acceptance before showing success',
    async ({ action, status }) => {
      const retry = deferredAnswer();
      answerAskInvoke.mockRejectedValueOnce(askFailure()).mockReturnValueOnce(retry.promise);
      render(<MessageQuestion message={makeAskMessage()} />);
      fillAskDraft();

      fireEvent.click(screen.getByTestId(`message-question-${action}`));
      await screen.findByRole('alert');
      fireEvent.click(screen.getByTestId(`message-question-${action}`));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByTestId('message-question-status')).not.toBeInTheDocument();
      await act(async () => retry.resolve());
      expect(screen.getByTestId('message-question-status')).toHaveTextContent(status);
    }
  );

  it.each(askActions)('prevents duplicate and opposite actions while $action is pending', async ({ action }) => {
    const request = deferredAnswer();
    answerAskInvoke.mockReturnValueOnce(request.promise);
    render(<MessageQuestion message={makeAskMessage()} />);
    fillAskDraft();

    fireEvent.click(screen.getByTestId(`message-question-${action}`));
    fireEvent.click(screen.getByTestId('message-question-submit'));
    fireEvent.click(screen.getByTestId('message-question-decline'));

    expect(answerAskInvoke).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('message-question-submit')).toBeDisabled();
    expect(screen.getByTestId('message-question-decline')).toBeDisabled();
    await act(async () => request.resolve());
  });

  it.each(askActions)('locks draft inputs while $action is pending', async ({ action }) => {
    const request = deferredAnswer();
    answerAskInvoke.mockReturnValueOnce(request.promise);
    render(<MessageQuestion message={makeAskMessage()} />);
    fillAskDraft();

    fireEvent.click(screen.getByTestId(`message-question-${action}`));

    expect(screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByRole('radio').every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole('textbox')).toBeDisabled();
    await act(async () => request.resolve());
  });

  it('sends every answer with trimmed free text through the dedicated ask channel', async () => {
    render(<MessageQuestion message={makeAskMessage()} />);
    fillAskDraft();

    fireEvent.click(screen.getByTestId('message-question-submit'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'ask-request-1',
      answers: [
        { question: 'Which features?', labels: ['Fast', 'Safe'] },
        { question: 'Which platform?', labels: ['My custom platform'] },
      ],
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });

  it('includes explicit question IDs when question text collides with another question ID', async () => {
    const message = makeAskMessage();
    const first = { id: 'q1', question: 'q2', options: [{ label: 'First answer' }] };
    const second = { id: 'q2', question: 'q1', options: [{ label: 'Second answer' }] };
    message.content.questions = [first, second];
    render(<MessageQuestion message={message} />);
    fireEvent.click(screen.getByRole('radio', { name: 'First answer' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Second answer' }));

    fireEvent.click(screen.getByTestId('message-question-submit'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'ask-request-1',
      answers: [
        { question_id: 'q1', question: 'q2', labels: ['First answer'] },
        { question_id: 'q2', question: 'q1', labels: ['Second answer'] },
      ],
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });

  it('can decline without filling answers and sends only the explicit decline', async () => {
    render(<MessageQuestion message={makeAskMessage()} />);

    fireEvent.click(screen.getByTestId('message-question-decline'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'ask-request-1',
      decline: true,
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askDeclined');
  });
});

describe('permission message adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    genericInvoke.mockResolvedValue(undefined);
    acpInvoke.mockResolvedValue(undefined);
  });

  it('keeps the generic payload exact and defaults confirmation to proceed_once', async () => {
    const message = makeGenericMessage();
    render(<MessagePermission message={message} />);

    expect(screen.getByText('execute')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-permission-option-proceed_once'));

    expect(genericInvoke).toHaveBeenCalledTimes(1);
    expect(genericInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      call_id: 'call-generic-message-1',
      msg_id: 'db-generic-message-1',
      data: { value: 'proceed_once' },
      always_allow: false,
    });
    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
  });

  it.each([
    ['proceed_always', true],
    ['proceed_always_server', false],
    ['proceed_always_tool', false],
  ])('preserves always_allow semantics for %s', async (value, alwaysAllow) => {
    const message = makeGenericMessage();
    message.content.options = [{ label: value, value }];
    const { unmount } = render(<MessagePermission message={message} />);

    fireEvent.click(screen.getByTestId(`message-permission-option-${value}`));

    expect(genericInvoke).toHaveBeenLastCalledWith({
      conversation_id: 'conversation-1',
      call_id: 'call-generic-message-1',
      msg_id: 'db-generic-message-1',
      data: { value },
      always_allow: alwaysAllow,
    });
    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
    unmount();
  });

  it('keeps the ACP payload exact and defaults confirmation to allow_once', async () => {
    render(<MessageAcpPermission message={makeAcpMessage()} />);

    expect(screen.getByText('edit')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-acp-permission-option-allow-once-id'));

    expect(acpInvoke).toHaveBeenCalledTimes(1);
    expect(acpInvoke).toHaveBeenCalledWith({
      confirm_key: 'allow-once-id',
      msg_id: 'acp-message-1',
      conversation_id: 'conversation-1',
      call_id: 'tool-call-1',
    });
    expect(await screen.findByTestId('message-acp-permission-status')).toBeInTheDocument();
  });

  it('keeps ACP fallbacks actionable when optional display fields are empty', async () => {
    const message = makeAcpMessage();
    message.content.tool_call = {
      tool_call_id: '',
      kind: 'fetch',
      raw_input: { description: 'Fetch package metadata' },
    };
    message.content.options = [{ option_id: '', name: '', kind: 'reject_always' }];
    render(<MessageAcpPermission message={message} />);

    expect(screen.getByText('Fetch package metadata')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-acp-permission-option-option_0'));

    expect(acpInvoke).toHaveBeenCalledWith({
      confirm_key: 'option_0',
      msg_id: 'acp-message-1',
      conversation_id: 'conversation-1',
      call_id: 'acp-message-1',
    });
    expect(await screen.findByTestId('message-acp-permission-status')).toBeInTheDocument();
  });

  it('shows the title once and no detail block when no raw command is available', () => {
    // Fallback A (2026-08-04 spec): the old behavior echoed the title into the
    // detail block ("命令: AskUserQuestion" class of cards). With no raw_input
    // there is nothing to show — the title must appear exactly once.
    const message = makeAcpMessage();
    message.content.tool_call.raw_input = undefined;
    render(<MessageAcpPermission message={message} />);

    expect(screen.getAllByText('Edit package.json')).toHaveLength(1);
  });

  it('renders raw_input as readable JSON when it carries no command', () => {
    // Fallback A: an agent that smuggles a structured payload through the
    // permission channel (kimi/qwen style) gets its payload rendered readable
    // instead of the title being echoed — no per-agent sniffing.
    const message = makeAcpMessage();
    message.content.tool_call.raw_input = {
      questions: [{ question: 'Which style?', options: [{ label: 'Tabs' }] }],
    } as never;
    render(<MessageAcpPermission message={message} />);

    expect(screen.getAllByText('Edit package.json')).toHaveLength(1);
    expect(screen.getByText(/Which style\?/)).toBeInTheDocument();
  });

  it('uses the localized ACP fallback title when title and description are absent', () => {
    const message = makeAcpMessage();
    message.content.tool_call.title = undefined;
    message.content.tool_call.raw_input = undefined;
    render(<MessageAcpPermission message={message} />);

    expect(screen.getByText('messages.permissionRequest')).toBeInTheDocument();
  });

  it('keeps pending cards isolated and installs no document key listener', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    render(
      <>
        <MessagePermission message={makeGenericMessage('generic-message-1')} />
        <MessagePermission message={makeGenericMessage('generic-message-2')} />
      </>
    );

    const cards = screen.getAllByTestId('message-permission-card');
    fireEvent.click(within(cards[1]).getByTestId('message-permission-option-proceed_once'));

    expect(genericInvoke).toHaveBeenCalledTimes(1);
    expect(genericInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-generic-message-2', msg_id: 'db-generic-message-2' })
    );
    expect(await within(cards[1]).findByTestId('message-permission-status')).toBeInTheDocument();
    expect(within(cards[0]).getByTestId('message-permission-option-proceed_once')).toBeEnabled();
    expect(addEventListener.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    addEventListener.mockRestore();
  });

  it('surfaces adapter bridge failures for retry instead of swallowing them', async () => {
    genericInvoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<MessagePermission message={makeGenericMessage()} />);

    fireEvent.click(screen.getByTestId('message-permission-option-proceed_once'));
    expect(await screen.findByTestId('message-permission-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-permission-option-proceed_once'));

    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
    expect(genericInvoke).toHaveBeenCalledTimes(2);
  });

  it('preserves generic fallback IDs, labels, title, and empty msg_id', async () => {
    const message = makeGenericMessage();
    message.msg_id = undefined;
    message.content.title = undefined;
    message.content.description = '';
    message.content.action = undefined;
    message.content.command_type = undefined;
    message.content.options = [{ label: 'Custom option', value: '' }];
    render(<MessagePermission message={message} />);

    expect(screen.getByText('messages.permissionRequest')).toBeInTheDocument();
    expect(screen.getByText('tool')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-permission-option-option_0'));

    expect(genericInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      call_id: 'call-generic-message-1',
      msg_id: '',
      data: { value: '' },
      always_allow: false,
    });
    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('preserves a present legacy option value as the %s token', async (token, value) => {
    const message = makeGenericMessage();
    message.content.options = [
      { label: `${token} token`, value },
    ] as unknown as IMessagePermission['content']['options'];
    render(<MessagePermission message={message} />);

    fireEvent.click(screen.getByTestId(`message-permission-option-${token}`));

    expect(genericInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ data: { value: token }, always_allow: false })
    );
    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
  });

  it('uses the generic description as its title when no explicit title is present', () => {
    const message = makeGenericMessage();
    message.content.title = undefined;
    message.content.description = 'Review this request';
    render(<MessagePermission message={message} />);

    expect(screen.getByText('Review this request')).toBeInTheDocument();
    expect(screen.queryByText('Permission required')).not.toBeInTheDocument();
  });

  it('renders a safe generic fallback for malformed confirmation content', () => {
    const message = makeGenericMessage();
    message.content = undefined as unknown as IMessagePermission['content'];
    const { rerender } = render(<MessagePermission message={message} />);

    expect(screen.getByText('messages.permissionRequest')).toBeInTheDocument();
    expect(screen.getByText('messages.noOptionsAvailable')).toBeInTheDocument();
    expect(screen.queryByTestId('message-permission-options')).not.toBeInTheDocument();

    const malformedMessage = {
      ...message,
      content: {
        ...makeGenericMessage().content,
        options: [undefined],
      } as unknown as IMessagePermission['content'],
    };
    rerender(<MessagePermission message={malformedMessage} />);
    expect(screen.getByText('messages.option 1')).toBeInTheDocument();
    expect(screen.getByTestId('message-permission-option-option_0')).toBeInTheDocument();
  });

  it('treats a non-array generic options payload as empty', () => {
    const message = makeGenericMessage();
    message.content.options = null as unknown as IMessagePermission['content']['options'];
    render(<MessagePermission message={message} />);

    expect(screen.getByText('messages.noOptionsAvailable')).toBeInTheDocument();
    expect(screen.queryByTestId('message-permission-options')).not.toBeInTheDocument();
  });

  it('does not render an ACP action when the tool call is missing', () => {
    const message = makeAcpMessage() as IMessageAcpPermission & {
      content: IMessageAcpPermission['content'] & { tool_call?: IMessageAcpPermission['content']['tool_call'] };
    };
    message.content.tool_call = undefined;
    const { container } = render(<MessageAcpPermission message={message as IMessageAcpPermission} />);

    expect(container).toBeEmptyDOMElement();
    expect(acpInvoke).not.toHaveBeenCalled();
  });

  it('does not render malformed ACP content and treats non-array options as empty', () => {
    const message = makeAcpMessage();
    message.content = undefined as unknown as IMessageAcpPermission['content'];
    const { container, rerender } = render(<MessageAcpPermission message={message} />);
    expect(container).toBeEmptyDOMElement();

    const nextMessage = makeAcpMessage();
    nextMessage.content.options = null as unknown as IMessageAcpPermission['content']['options'];
    rerender(<MessageAcpPermission message={nextMessage} />);
    expect(screen.getByText('messages.noOptionsAvailable')).toBeInTheDocument();
    expect(screen.queryByTestId('message-acp-permission-options')).not.toBeInTheDocument();
  });

  it('renders a localized ACP fallback for an option without display metadata', () => {
    const message = makeAcpMessage();
    message.content.options = [undefined] as unknown as IMessageAcpPermission['content']['options'];
    render(<MessageAcpPermission message={message} />);

    expect(screen.getByText('messages.option 1')).toBeInTheDocument();
    expect(screen.getByTestId('message-acp-permission-option-option_0')).toBeInTheDocument();
  });
});
