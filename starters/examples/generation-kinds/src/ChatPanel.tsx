import { useCallback, useEffect, useRef, useState } from 'react';

import { useBuzzWorkflow, WorkflowSubmitError } from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Select, Stack, Textarea } from '@civitai/blocks-react/ui';
import type { BlockWorkflowSnapshot, WorkflowBodyStep } from '@civitai/app-sdk/blocks';

import {
  estimateFailureMessage,
  logServerReason,
  pollFailureMessage,
  pollUntilTerminal,
  submitFailureMessage,
  submitRejectionOutcome,
  TERMINAL_STATUSES,
} from './workflow.js';
import { RAN_AND_FAILED_NOTE, resolvedChatFailure, turnsForModel, type Turn } from './chatTurns.js';

/**
 * `kind: 'step'`, REGISTRY arm, `step: 'chat-completion'` — a multi-turn LLM chat.
 *
 * `params` is opaque in the SDK type on purpose (the host's per-step `.strict()`
 * schema is the authority), so the bounds below are copied from that schema and
 * enforced here before anything is sent:
 *  - `model`: one of the host's allowlisted ids ({@link CHAT_MODELS});
 *  - `messages`: 1–32 `{ role, content }`, each content 1–8000 chars;
 *  - `maxTokens`: REQUIRED, integer 1–4000 — it also drives the price;
 *  - `temperature`: optional, 0–2.
 *
 * The host is stateless per run: every turn re-sends the conversation so far.
 * The reply arrives on the POLL snapshot as `textOutputs` (moderated), never on
 * the submit reply; a reply the scan kept back arrives as `textOutputWithheld`.
 */
export const CHAT_MODELS = [
  'deepseek/deepseek-chat',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition',
  'openai/gpt-4o-mini',
  'deepseek/deepseek-v4-flash-0731',
] as const;
const MAX_MESSAGES = 32;
const MAX_CHARS = 8000;
const MAX_TOKENS = 512;
const SYSTEM = 'You are a concise, friendly assistant inside a Civitai app.';

/** The ONE builder: the estimate prices exactly the body the submit sends. */
function buildBody(model: string, history: Turn[], draft: string): WorkflowBodyStep {
  // A turn that failed got no reply, so it is not context for the next one.
  const turns: Turn[] = [...turnsForModel(history), { role: 'user', content: draft.trim().slice(0, MAX_CHARS) }];
  // Keep the system message plus the most recent turns inside the 32-message cap.
  const messages = [{ role: 'system', content: SYSTEM }, ...turns.slice(-(MAX_MESSAGES - 1))];
  return { kind: 'step', step: 'chat-completion', params: { model, messages, maxTokens: MAX_TOKENS, temperature: 0.7 } };
}

/** Only the mock host has no text channel; say so in dev rather than show a blank. */
const MOCK_HOST = import.meta.env.VITE_DEV_HARNESS === 'true' && import.meta.env.VITE_LIVE_MODE !== 'true';

type Pending = { workflowId: string; note?: string } | 'submitting' | null;

export function ChatPanel({ canSpend }: { canSpend: boolean }) {
  const { estimate, submit, poll } = useBuzzWorkflow();
  const [model, setModel] = useState<string>(CHAT_MODELS[2]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('Suggest three names for a cozy mountain cabin.');
  const [quote, setQuote] = useState<number | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ color: 'error' | 'warning'; text: string } | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPoll.current?.(), []);

  // ESTIMATE the next turn whenever the draft or the conversation changes.
  useEffect(() => {
    if (!canSpend || !draft.trim()) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      estimate(buildBody(model, history, draft))
        .then((snap) => {
          if (cancelled) return;
          setQuote(snap.cost?.total ?? null);
          setQuoteNote(null);
        })
        .catch((err: unknown) => {
          logServerReason('chat estimate', null, err);
          if (cancelled) return;
          setQuote(null);
          setQuoteNote(estimateFailureMessage(err));
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [canSpend, model, history, draft, estimate]);

  const settle = useCallback((snap: BlockWorkflowSnapshot, note?: string) => {
    setPending(null);
    if (snap.status === 'succeeded') {
      const text = snap.textOutputs?.join('\n\n');
      if (text) setHistory((h) => [...h, { role: 'assistant', content: text }]);
      else if (snap.textOutputWithheld) {
        // A host-authored, deliberately generic sentence (it names no labels).
        setNotice({ color: 'warning', text: snap.textOutputWithheld.reason });
      } else {
        setNotice({
          color: 'warning',
          text: MOCK_HOST
            ? 'No reply text: the SDK mock host has no text channel. On civitai.com the reply arrives on textOutputs.'
            : 'The model returned no text.',
        });
      }
      return;
    }
    if (snap.textOutputWithheld) setNotice({ color: 'warning', text: snap.textOutputWithheld.reason });
    else if (snap.status === 'failed') setNotice({ color: 'error', text: note ?? pollFailureMessage() });
    else setNotice({ color: 'warning', text: snap.status === 'expired' ? 'The reply timed out.' : 'Canceled.' });
  }, []);

  const follow = useCallback(
    (workflowId: string, note?: string) => {
      stopPoll.current?.();
      setPending({ workflowId, ...(note ? { note } : {}) });
      stopPoll.current = pollUntilTerminal(poll, workflowId, (snap) => {
        if (snap.status === 'failed') logServerReason('chat poll', snap);
        if (TERMINAL_STATUSES.has(snap.status)) settle(snap, note);
      });
    },
    [poll, settle],
  );

  // CONFIRM + SUBMIT: the click on "Send · N Buzz" is the confirmation.
  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const body = buildBody(model, history, text);
    setNotice(null);
    setPending('submitting');
    try {
      const snap = await submit(body);
      if (snap.status === 'failed') {
        logServerReason('chat submit', snap);
        setPending(null);
        const failure = resolvedChatFailure(snap, text);
        if (failure.kind === 'not-started') {
          // The placeholder id: refused before anything ran, nothing charged.
          setNotice({ color: 'error', text: submitFailureMessage(snap) });
          return; // the draft stays in the box, ready to send again
        }
        // A real run came back failed and may have spent: keep it as a failed
        // turn, and do NOT leave the draft primed for a separately charged resend.
        setHistory((h) => [...h, failure.turn]);
        setDraft('');
        setNotice({ color: 'error', text: RAN_AND_FAILED_NOTE });
        return;
      }
      setHistory((h) => [...h, { role: 'user', content: text }]);
      setDraft('');
      follow(snap.workflowId);
    } catch (err) {
      logServerReason('chat submit', err instanceof WorkflowSubmitError ? err.snapshot : null, err);
      const outcome = submitRejectionOutcome(err);
      if (outcome.pollWorkflowId) {
        setHistory((h) => [...h, { role: 'user', content: text }]);
        setDraft('');
        follow(outcome.pollWorkflowId, outcome.viewerMessage);
      } else {
        setPending(null);
        setNotice({ color: 'error', text: outcome.viewerMessage });
      }
    }
  }, [draft, model, history, submit, follow]);

  const busy = pending !== null;

  return (
    <Card data-testid="chat-panel">
      <Stack gap={12}>
        <Group justify="space-between" gap={8}>
          <strong>Chat</strong>
          <Badge variant="outline">step · chat-completion</Badge>
        </Group>
        <Select
          label="Model"
          value={model}
          onChange={setModel}
          options={CHAT_MODELS.map((m) => ({ value: m, label: m }))}
          disabled={busy}
        />
        <div style={transcriptStyle} data-testid="transcript" aria-live="polite">
          {history.length === 0 ? <small style={dimmed}>No messages yet.</small> : null}
          {history.map((t, i) => (
            <div
              key={i}
              style={t.failed ? failedBubble : t.role === 'user' ? userBubble : assistantBubble}
              data-role={t.role}
              {...(t.failed ? { 'data-failed': '' } : {})}
            >
              {t.content}
              {t.failed ? <small style={{ display: 'block' }}>Failed — may have been charged.</small> : null}
            </div>
          ))}
          {busy ? (
            <span role="status" style={dimmed}>
              Thinking…
            </span>
          ) : null}
        </div>
        <Textarea
          label="Message"
          minRows={2}
          maxLength={MAX_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && canSpend && !busy && quote != null) {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        <Group gap={8}>
          <Button onClick={onSend} disabled={!canSpend || busy || quote == null} loading={pending === 'submitting'}>
            {quote == null ? 'Send' : `Send · ${quote} Buzz`}
          </Button>
          {history.length > 0 ? (
            <Button variant="subtle" disabled={busy} onClick={() => setHistory([])}>
              New chat
            </Button>
          ) : null}
        </Group>
        {quoteNote ? <small style={dimmed}>{quoteNote}</small> : null}
        {notice ? <Alert color={notice.color}>{notice.text}</Alert> : null}
      </Stack>
    </Card>
  );
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
const transcriptStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 120,
  maxHeight: '50vh',
  overflowY: 'auto',
} as const;
const bubble = { padding: '8px 12px', borderRadius: 8, whiteSpace: 'pre-wrap', maxWidth: '85%' } as const;
const userBubble = {
  ...bubble,
  alignSelf: 'flex-end',
  background: 'var(--civitai-color-primary)',
  color: 'var(--civitai-color-primary-fg)',
} as const;
const assistantBubble = { ...bubble, alignSelf: 'flex-start', background: 'var(--civitai-color-surface-2)' } as const;
const failedBubble = { ...userBubble, opacity: 0.6 } as const;
