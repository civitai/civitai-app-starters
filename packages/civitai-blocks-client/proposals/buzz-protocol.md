# Buzz over the block bridge — proposed message set

Status: **implemented client-side** (see `src/buzz/`). The host speaks none of
these messages yet; that work is outstanding.

Replaces the buzz half of `@civitai/app-sdk/blocks`. Every change below exists
because the current shape forced a workaround in `@civitai/blocks-client`, and
each one names the workaround it removes.

## 1. Envelope

Every reply carries the same three fields, so unwrapping stops being per-message.

```ts
interface Envelope<T> {
  requestId: string;
  result?: T;
  error?: { code: BridgeFailureCode; message: string };
}

type BridgeFailureCode =
  | 'forbidden'        // the token lacks the scope
  | 'unauthenticated'  // anonymous viewer
  | 'insufficient'     // not enough Buzz
  | 'rate-limited'
  | 'timeout'          // the host gave up waiting on something it called
  | 'unavailable'      // upstream is down; retrying may work
  | 'invalid';         // the request was malformed
```

Reply names derive from the request: `<REQUEST>_RESULT`, always.

**Removes:** the host's `hostHandlerParity.ts` pairing, restated by hand in the
client because `SUBMIT_WORKFLOW` is answered by `WORKFLOW_SUBMITTED` — irregular
and underivable. And the per-message result field, called `balance` on one
reply, `result` on three and `snapshot` on four.

**Removes:** string-matching on failures. The host forwards `err.message`
verbatim today, so `error: 'block lacks buzz:read:self scope'` is the only
signal. With a code, a block renders a "connect your account" CTA for
`forbidden` and a retry for `unavailable`.

Note this envelope is the **transport's**, not the domain's: in the client it
lives inside the iframe transport, because correlation ids and reply names exist
only for a message-based bridge. An HTTP transport would carry none of it.

## 2. Types

```ts
/** The spendable pools, and only those. `red`, `creatorProgram` and `cash`
 *  are internal to the platform and must not reach a block. */
type BuzzAccountType = 'blue' | 'green' | 'yellow';

interface BuzzAccount {
  type: BuzzAccountType;
  balance: number;
}

interface BuzzTransaction {
  id: string;
  /** ISO-8601. */
  date: string;
  type: string;
  amount: number;
  from: BuzzCounterparty;
  to: BuzzCounterparty;
  description?: string;
}

/** `type` is absent when the counterparty is an account a block may not see. */
interface BuzzCounterparty {
  accountId: number;
  type?: BuzzAccountType;
}
```

**Fixes:** "buzz account type" is spelled four ways today — a three-member union
(`BuzzAccountType`), bare `string` twice (`BlockBuzzAccount.accountType`,
`BlockBuzzTransaction.from/toAccountType`), and a four-member union including
`red` (`autoClaim.accountType`).

**Fixes:** `BlockBuzzTransaction.date` is declared `string` and arrives as a
`Date` instance, because the host forwards the raw tRPC row through structured
clone. The client normalises it in `withIsoDate`; that function and two of its
tests go. The ledger `cursor` has the same bug.

Closing the union raises a question the current `string` typing hides: a ledger
row's counterparty can be an internal account — a `red` debit, a creator-program
credit. This proposal has the host redact those to an opaque `{ accountId }`
rather than name an internal pool. **The host must enforce that**; a closed union
in this file is a claim, not a control.

## 3. Requests

```ts
BUZZ_GET_ACCOUNTS       {}                   → { accounts: BuzzAccount[] }
BUZZ_LIST_TRANSACTIONS  BuzzLedgerQuery      → { transactions: BuzzTransaction[]; cursor?: string }
BUZZ_REQUEST_PURCHASE   { amount? }          → { purchased: boolean; accounts?: BuzzAccount[] }

interface BuzzLedgerQuery {
  accountType?: BuzzAccountType;
  type?: string;
  start?: string;   // ISO-8601
  end?: string;
  limit?: number;   // 1-200
  cursor?: string;  // opaque; from a prior reply
}
```

Three requests, down from five.

**Removes:** `GET_BUZZ_BALANCE`. It returns `{ blue, green, yellow }` — three
fixed keys — while `GET_BUZZ_ACCOUNTS` returns an array of the same information.
Only the array can express a pool that does not exist yet, and the router
already omits `red`/`creatorProgram`/`cash` because the fixed shape has nowhere
to put them.

**Dropped:** `GET_DAILY_COMPENSATION`. Creator compensation is not the viewer's
wallet and there is no use case for it yet, so it is exposed nowhere.

**Renamed:** `OPEN_BUZZ_PURCHASE` → `BUZZ_REQUEST_PURCHASE`, `suggestedAmount` →
`amount`. From a block's side this is a purchase it asks for and awaits, and
`request` carries the part that matters: it can come back refused. That pairs
with resolving rather than rejecting on an abandoned flow — the same contract as
`Notification.requestPermission()`, which answers `'denied'` instead of
throwing. A refusal is an outcome; `BridgeError` is for things that went wrong.

`amount` stays a suggestion in an options bag rather than `purchase(accounts,
amount)`: the viewer can change it, the host caps it at 50,000 (against a block
coaxing a 10M-buzz purchase), and the destination pool is not a block's to pick.
Naming those as arguments would promise control the bridge does not grant.

**Changes:** the reply answers with the full account set rather than
`newBalance: number`. A single number cannot update a per-pool balance, which is
why a completed purchase currently has to trigger a refetch.

## 4. Pushes

```ts
BUZZ_ACCOUNTS_CHANGED   { accounts: BuzzAccount[] }
```

One push, carrying **full state rather than a delta**: idempotent, no sequence
numbers, no missed-message recovery, and a block that just mounted gets a
consistent view from the first message it sees.

**This is the change that matters.** The host is the only party that sees a tip
arriving, another app spending, another tab buying, or a daily payout. Today it
tells the block none of them, which is why `watchBalance()` was built and then
deleted — a shared value that only refreshes when asked implies a freshness
guarantee it cannot keep. With this push it is correct, and the client's
`Live<T>` applies the pushed state directly rather than refetching.

It also removes the request amplification behind that decision:
`blocks.getMyBuzzBalance` is a tRPC **mutation**, deliberately, so the block
token travels in a POST body rather than a logged URL. Mutations are neither
cached nor deduplicated, so N components showing a balance is N full round trips
through token verification, scope check, kill-switch and the buzz service.

### Who receives it

Three ways to answer, and the difference is smaller than it looks because
**none of them is an access control**. `buzz:read:self` already grants the data;
a block that can read the balance on demand can poll for it. What is being
chosen is delivery, not permission.

**A. Scope-gate (chosen).** The host emits to every block whose token carries
`buzz:read:self`. No extra messages, no lifecycle, no race: a block is always
subscribed, so a change cannot land between its first read and its handler being
attached.

**B. Explicit `BUZZ_SUBSCRIBE` / `BUZZ_UNSUBSCRIBE`.** The host emits only to
blocks that asked, and the subscribe message could later carry filters. It costs
a message pair, an unsubscribe the block must remember on teardown, and a real
race — a change between `BUZZ_GET_ACCOUNTS` and the subscribe landing is missed,
so the block needs a re-read after subscribing to be correct.

**C. Subscribe that returns current state.** Both the first read and the
subscription, which removes B's race and makes `watchAccounts()` one message
instead of two. It keeps B's teardown obligation.

**A wins on one argument above the others: it is the reversible choice.** Adding
`BUZZ_SUBSCRIBE` later is additive — the host keeps delivering to scoped blocks
until one opts into filtering. Starting with B or C and removing it breaks every
deployed block. Volume is low and this is not a permission boundary, so B's
lifecycle and race costs buy precision nobody has asked for.

The one input that would change this: if a page routinely hosts many blocks
holding `buzz:read:self` without displaying a balance, wasted delivery stops
being negligible and C earns its cost.

### Deliberately not proposed

`BUZZ_TRANSACTION_POSTED`. A ledger view re-reads on `BUZZ_ACCOUNTS_CHANGED`,
which is one message instead of two and cannot drift from the balance. Add it
only if a block needs the individual transaction rather than the fact of it.

## 5. Resulting client surface

```ts
civitai.buzz.getAccounts()                → Promise<BuzzAccount[]>
civitai.buzz.watchAccounts()              → Live<BuzzAccount[]>
civitai.buzz.listTransactions(query?)     → AsyncGenerator<BuzzTransaction>
civitai.buzz.requestPurchase({ amount? }) → Promise<{ purchased, accounts? }>
```

`watchAccounts()` returns the shared live value: read `.value`, listen for
`change`, unsubscribe with an `AbortSignal`, or `for await` it. The push keeps it
current; `refresh()` stays for a caller that knows better.

## 6. Timing is the host's

No request carries a client-side deadline. The host owes a reply to every
request it accepts — including when whatever it called gave up, which comes back
as `error: { code: 'timeout' }`. A caller who wants its own bound passes an
`AbortSignal` and gets the platform's `TimeoutError` unwrapped.

This removes a class of bug rather than a line of code: a deadline in the client
is a second, invisible copy of a number the host owns, and it drifts. It already
did — `BUZZ_REQUEST_PURCHASE` silently fell from ten minutes to thirty seconds
when it moved off the inherited table, which would have rejected while the
viewer was entering card details.

The same rule settles held reads elsewhere in the bridge. A client says
*whether* it wants to wait, never *how long*.

**Host obligations, in exchange:**

1. **Never drop a request.** One with no reply now hangs until the caller
   aborts, where before it failed on its own after 30s.
2. **A held read holds.** It returns when something changed or when the host
   gives up waiting — never immediately with state the caller has already seen.
   A client that trusts this needs no polling cadence, and sets none.

## 7. Settled

- **Host debounces a burst.** A workflow debiting several pools coalesces host
  side. The client builds no protection for it; coalescing can be added later
  without a protocol change.
- **Error codes require host classification.** `BridgeFailureCode` is only worth
  having if the host maps its throws onto it rather than defaulting to
  `invalid`. Accepted as host-side work.
- **`BuzzTransaction.type` stays `string`.** The known names can be narrowed to
  an open union later; nothing depends on it yet.
- **An abandoned purchase resolves**, with `purchased: false`. See §3.
- **Push delivery is scope-gated.** See §4.

## 8. Open

1. **Counterparty redaction** (§2). The host must omit an internal pool's name
   rather than send it; otherwise the closed `BuzzAccountType` is wrong on the
   wire the first time a block reads a ledger row funded from `red`.
