import { ApiError } from '@civitai/sdk';

import { TOP_UP_BUZZ } from '../config.js';
import type { OrchestrationApi } from '../orchestration/api.js';

export interface FundStatus {
  id: string;
  balance: number;
  expiresAt: string;
}

export const FUND_EMPTY = 'fund_empty';
/** The longest the orchestrator keeps a fund; whatever is left at expiry goes to Civitai. */
const TTL = '7.00:00:00';
const DAY_MS = 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ChatFundOptions {
  api: Pick<OrchestrationApi, 'createFund' | 'getFund' | 'depositIntoFund' | 'extendFund' | 'refundFund'>;
  /** The signed-in viewer. A fund only checks the app, so its id is kept per viewer. */
  viewer: () => Promise<number | undefined>;
  autoTopUp: () => boolean;
  scope?: string;
  storage?: StorageLike;
}

/**
 * The viewer's prepaid Buzz for chat replies once the free ones are used up: one orchestrator fund,
 * topped up {@link TOP_UP_BUZZ} at a time and kept from expiring while it is used.
 */
export class ChatFund extends EventTarget {
  status: FundStatus | null = null;
  loaded = false;
  #options: ChatFundOptions;
  #loading?: Promise<void>;
  #topping?: Promise<FundStatus>;

  constructor(options: ChatFundOptions) {
    super();
    this.#options = options;
  }

  get balance(): number {
    return this.status?.balance ?? 0;
  }

  refresh(): Promise<void> {
    this.#loading ??= this.#read()
      .then((status) => this.#set(status))
      .catch((error: unknown) => console.warn('[chat-cvt] could not read the chat balance', error))
      .finally(() => {
        this.loaded = true;
        this.#loading = undefined;
      });
    return this.#loading;
  }

  /** Adds {@link TOP_UP_BUZZ} from the viewer's Buzz, opening a fund first when there is none. */
  topUp(): Promise<FundStatus> {
    this.#topping ??= this.#topUp().finally(() => (this.#topping = undefined));
    return this.#topping;
  }

  /** Pays what is left back to the viewer. */
  async withdraw(): Promise<void> {
    if (!this.status) return;
    this.#set(await this.#options.api.refundFund(this.status.id));
  }

  /** Sends a paid chat request billed to the fund, topping it up first when it is empty and the viewer allows that. */
  async send(inner: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!this.loaded) await this.refresh();
    if (this.balance <= 0) {
      if (!this.#options.autoTopUp()) return empty();
      const failed = await this.#autoTopUp();
      if (failed) return failed;
    }
    let response = await inner(input, withFund(init, this.status!.id));
    if (response.status === 402 && this.#options.autoTopUp()) {
      const failed = await this.#autoTopUp();
      if (failed) return failed;
      response = await inner(input, withFund(init, this.status!.id));
    }
    if (response.status === 402 || (response.status === 400 && (await isFundUnavailable(response)))) {
      if (response.status === 400) this.#set(null);
      else this.#set({ ...this.status!, balance: 0 });
      return empty();
    }
    void this.refresh();
    return response;
  }

  async #autoTopUp(): Promise<Response | undefined> {
    try {
      await this.topUp();
      return undefined;
    } catch (error) {
      const message = error instanceof ApiError && error.status === 402 ? 'Insufficient Buzz to top up the chat balance' : 'Could not top up the chat balance';
      return Response.json({ error: { message } }, { status: 402 });
    }
  }

  async #topUp(): Promise<FundStatus> {
    const { api } = this.#options;
    if (!this.loaded) await this.refresh();
    let id = this.status?.id;
    if (!id) id = (await this.#create()).id;
    let status: FundStatus;
    try {
      status = await api.depositIntoFund(id, TOP_UP_BUZZ);
    } catch (error) {
      // Expired between the read and the deposit.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      status = await api.depositIntoFund((await this.#create()).id, TOP_UP_BUZZ);
    }
    this.#set(status);
    return status;
  }

  async #create(): Promise<FundStatus> {
    const created = await this.#options.api.createFund({ ttl: TTL, description: 'Civitai Chat replies' });
    await this.#remember(created.id);
    this.#set(created);
    return created;
  }

  async #read(): Promise<FundStatus | null> {
    const id = this.#storage()?.getItem(await this.#key());
    if (!id) return null;
    try {
      const status = await this.#options.api.getFund(id);
      return Date.parse(status.expiresAt) - Date.now() < 6 * DAY_MS ? await this.#options.api.extendFund(id, TTL) : status;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.#storage()?.removeItem(await this.#key());
        return null;
      }
      throw error;
    }
  }

  async #remember(id: string): Promise<void> {
    try {
      this.#storage()?.setItem(await this.#key(), id);
    } catch {
      // Without storage the fund lasts for this page only.
    }
  }

  async #key(): Promise<string> {
    const viewer = await this.#options.viewer();
    if (!viewer) throw new Error('No signed-in viewer to keep a chat balance for');
    const scope = this.#options.scope;
    return scope ? `cvt:fund:${scope}:${viewer}` : `cvt:fund:${viewer}`;
  }

  #storage(): StorageLike | undefined {
    if (this.#options.storage) return this.#options.storage;
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  }

  #set(status: FundStatus | null): void {
    this.status = status;
    this.dispatchEvent(new Event('change'));
  }
}

function withFund(init: RequestInit | undefined, fundId: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('X-Civitai-Fund', fundId);
  headers.delete('X-Civitai-Tier');
  return { ...init, headers };
}

async function isFundUnavailable(response: Response): Promise<boolean> {
  const body = (await response.clone().json().catch(() => null)) as { error?: { type?: string } } | null;
  return body?.error?.type === 'fund_unavailable';
}

// A 400, so the AI SDK does not retry it.
function empty(): Response {
  return Response.json({ error: { message: 'Chat balance is empty', code: FUND_EMPTY } }, { status: 400 });
}
