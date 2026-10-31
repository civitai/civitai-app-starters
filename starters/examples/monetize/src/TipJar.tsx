import { useEffect, useRef, useState } from 'react';

import { generateIdempotencyKey, useBlockToken, useTip, useTipAllowance } from '@civitai/blocks-react';
import { Button, Group, NumberInput, Stack, TipButton } from '@civitai/blocks-react/ui';

/** civitai `src/pages/api/v1/blocks/tip.ts:79` — the per-tip schema maximum. */
const MAX_PER_TIP = 5_000;

/**
 * Tips — Buzz from the viewer to a PERSON (here: whoever the model owner named
 * in the `tip_recipient_user_id` publisher setting). The app itself earns
 * nothing from a tip.
 *
 * Mount this only for a SIGNED-IN viewer: `useTipAllowance` reads on mount, and
 * the server refuses an anonymous token (there is no "self" allowance).
 *
 * Two ways to send, both through `POST /api/v1/blocks/tip` (`social:tip:self`):
 *  - `<TipButton>` — the packaged control: its own two-step confirm, its own
 *    stable idempotency key, a local check against `remaining`.
 *  - `useTip().tip()` — the hook, for a custom amount. Everything TipButton does
 *    for you is spelled out below: confirm, one key per logical tip, the
 *    allowance check, and a key that changes with the payload.
 */
export function TipJar({ recipientUserId }: { recipientUserId: number }) {
  const { scopes } = useBlockToken();
  // ONE allowance read for the whole view, passed down to TipButton.
  const { allowance, error: allowanceError, refetch } = useTipAllowance();
  const canTip = scopes.includes('social:tip:self');
  const [tippedCount, setTippedCount] = useState(0);
  /**
   * 🔴 RE-READ THROUGH THE LATEST `refetch`, NOT THE ONE IN THE TIP'S CLOSURE.
   * `refetch` sends the token of the render that created it. The FIRST tip is a
   * consent round-trip: it starts on a token without `social:tip:self`, the
   * grant re-mints the token, and the tip lands on the new one — but an
   * `onTipped` holding the PRE-grant `refetch` re-reads with the old token and
   * is refused 403, leaving the allowance stale. (Measured in this example's
   * harness: the post-tip read went 403 until this ref was added.)
   */
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  const afterTip = () => {
    refetchRef.current();
    setTippedCount((n) => n + 1);
  };

  return (
    <Stack gap={10}>
      <div data-testid="tip-allowance">
        {allowance ? (
          <>
            Daily tip allowance: <strong>{allowance.remaining.toLocaleString()}</strong> of{' '}
            {allowance.cap.toLocaleString()} Buzz left
          </>
        ) : !canTip ? (
          // `social:tip:self` is consent-gated: the token carries it only after
          // the viewer allows tipping (the first tip asks), and the allowance
          // read 403s until then. The hook re-reads on the new token by itself.
          'Your daily tip allowance shows once you allow this app to send tips.'
        ) : allowanceError ? (
          <>
            Could not read your tip allowance.{' '}
            <Button size="sm" variant="subtle" onClick={refetch}>
              Retry
            </Button>
          </>
        ) : (
          'Reading your tip allowance…'
        )}
      </div>

      <Group gap={8} align="center">
        <TipButton
          noun="creator"
          toUserId={recipientUserId}
          amount={50}
          remaining={allowance?.remaining}
          onTipped={afterTip}
          data-testid="tip-50"
        />
        <span style={{ fontSize: 13, color: 'var(--civitai-color-text-dimmed)' }}>the packaged control</span>
      </Group>

      <CustomTip
        recipientUserId={recipientUserId}
        remaining={allowance?.remaining}
        onTipped={afterTip}
      />

      {tippedCount > 0 ? (
        <small role="status" data-testid="tip-count">
          {`${tippedCount} tip${tippedCount === 1 ? '' : 's'} sent this visit.`}
        </small>
      ) : null}
    </Stack>
  );
}

function CustomTip({
  recipientUserId,
  remaining,
  onTipped,
}: {
  recipientUserId: number;
  remaining: number | undefined;
  onTipped: () => void;
}) {
  const { tip, loading } = useTip();
  const [amount, setAmount] = useState<number | null>(100);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * One key per LOGICAL tip: kept across a retry of the same amount (so a lost
   * response cannot send twice), replaced when the amount changes (a key is
   * pinned to one payload; reusing it for another is refused 422) and after a
   * tip lands.
   */
  const keyRef = useRef<string | null>(null);

  const valid = amount !== null && Number.isInteger(amount) && amount > 0 && amount <= MAX_PER_TIP;
  const overAllowance = valid && remaining !== undefined && amount > remaining;

  async function send() {
    if (!valid || overAllowance) return;
    if (!keyRef.current) keyRef.current = generateIdempotencyKey();
    setNotice(null);
    try {
      await tip({ toUserId: recipientUserId, amount }, { idempotencyKey: keyRef.current });
      keyRef.current = null;
      setConfirming(false);
      setNotice(`Sent ${amount} Buzz. Thank you!`);
      onTipped();
    } catch (err) {
      setConfirming(false);
      if (err instanceof Error && err.name === 'AbortError') return; // unmounted
      // `useTip` rejects with a plain Error carrying the server's own message
      // ("You cannot tip yourself", the daily limit, not enough Buzz, …), which
      // is viewer-facing copy. Its own timeout message is developer-facing, and
      // the transfer MAY have landed then — the kept key makes a resend safe.
      const timedOut = err instanceof Error && err.message.startsWith('useTip: request aborted (timed out');
      setNotice(
        timedOut
          ? 'We lost contact before the tip was confirmed. Press Send again to check — it will not send twice.'
          : err instanceof Error && err.message
            ? err.message
            : 'Could not send the tip.',
      );
    }
  }

  return (
    <Stack gap={6}>
      <Group gap={8} align="flex-end">
        <div style={{ width: 160 }}>
          <NumberInput
            label="Custom tip (Buzz)"
            value={amount}
            min={1}
            max={MAX_PER_TIP}
            onChange={(v) => {
              setAmount(v);
              setConfirming(false);
              keyRef.current = null; // a different amount is a different tip
            }}
            error={overAllowance ? 'Over your remaining daily tip allowance.' : undefined}
          />
        </div>
        {confirming ? (
          <Group gap={6} align="center" data-testid="custom-tip-prompt">
            <span>{`Send ${amount} Buzz?`}</span>
            <Button size="sm" loading={loading} onClick={() => void send()} data-testid="custom-tip-confirm">
              Send
            </Button>
            <Button size="sm" variant="subtle" disabled={loading} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </Group>
        ) : (
          <Button
            variant="light"
            disabled={!valid || overAllowance}
            onClick={() => setConfirming(true)}
            data-testid="custom-tip"
          >
            Tip this amount
          </Button>
        )}
      </Group>
      {notice ? (
        <small role="status" data-testid="custom-tip-notice">
          {notice}
        </small>
      ) : null}
    </Stack>
  );
}
