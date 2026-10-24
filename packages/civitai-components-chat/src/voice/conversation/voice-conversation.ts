import type { TurnPart } from '../../agent/parts.js';
import type { PcmRecorderEvents } from '../pcm-recorder.js';
import { SpeechFeed } from './speech-feed.js';
import type { TurnModel } from './turn-model.js';
import { VoiceListener } from './voice-listener.js';
import { VoiceSpeaker } from './voice-speaker.js';

export type ConversationState = 'starting' | 'listening' | 'thinking' | 'speaking';

export interface ConversationView {
  state: ConversationState;
  /** What the viewer is saying, before their turn ends. */
  heard: string;
  level: number;
}

/** The chat's agent, as much of it as a conversation needs. */
export interface ConversationAgent extends EventTarget {
  readonly live: { seq: number; parts: TurnPart[] } | null;
  readonly running: boolean;
  abort(): void;
}

export interface ConversationDeps {
  agent: ConversationAgent;
  /** Sends the viewer's words as their message, as typing would. */
  send(text: string): Promise<void>;
  openTranscription(): Promise<{ workflowId: string; socketUrl: string }>;
  openSpeech(): Promise<{ workflowId: string; socketUrl: string }>;
  cancel(workflowId: string): void;
  microphone(events: PcmRecorderEvents): Promise<{ cancel(): void }>;
  turnModel?(): Promise<TurnModel>;
  changed(view: ConversationView): void;
  failed(error: unknown): void;
}

const STATE_POLL_MS = 100;

const replyText = (parts: TurnPart[]): string =>
  parts
    .filter((part): part is Extract<TurnPart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text)
    .join('\n\n');

/** A spoken conversation: the viewer talks, each reply streams back as speech, and talking over it stops it. */
export class VoiceConversation {
  #deps: ConversationDeps;
  #listener: VoiceListener;
  #speaker: VoiceSpeaker;
  #view: ConversationView = { state: 'starting', heard: '', level: 0 };
  #poll?: ReturnType<typeof setInterval>;
  #reply?: { seq: number; text: string; feed: SpeechFeed; muted: boolean };

  constructor(deps: ConversationDeps) {
    this.#deps = deps;
    this.#speaker = new VoiceSpeaker({ open: deps.openSpeech, cancel: deps.cancel });
    this.#listener = new VoiceListener(
      {
        open: deps.openTranscription,
        cancel: deps.cancel,
        microphone: deps.microphone,
        ...(deps.turnModel ? { turnModel: deps.turnModel } : {}),
        replyAudible: () => this.#speaker.audible,
      },
      {
        heard: (heard) => this.#update({ heard }),
        level: (level) => this.#update({ level }),
        turn: (text) => void this.#onTurn(text),
        interrupt: () => this.#interrupt(),
        failed: (error) => deps.failed(error),
      },
    );
  }

  async start(): Promise<void> {
    this.#deps.agent.addEventListener('change', this.#onAgentChange);
    this.#speaker.prepare();
    await this.#listener.start();
    this.#poll = setInterval(() => this.#update({ state: this.#state() }), STATE_POLL_MS);
    this.#update({ state: 'listening' });
  }

  end(): void {
    clearInterval(this.#poll);
    this.#deps.agent.removeEventListener('change', this.#onAgentChange);
    this.#listener.stop();
    this.#speaker.close();
  }

  #state(): ConversationState {
    if (this.#speaker.audible) return 'speaking';
    return this.#deps.agent.running ? 'thinking' : 'listening';
  }

  async #onTurn(text: string): Promise<void> {
    if (this.#deps.agent.running) {
      this.#interrupt();
      await this.#idle();
    }
    await this.#deps.send(text);
  }

  #interrupt(): void {
    if (this.#reply) this.#reply.muted = true;
    this.#deps.agent.abort();
    this.#speaker.stop();
  }

  #idle(): Promise<void> {
    const agent = this.#deps.agent;
    return new Promise((resolve) => {
      const check = (): void => {
        if (agent.running) return;
        agent.removeEventListener('change', check);
        resolve();
      };
      agent.addEventListener('change', check);
      check();
    });
  }

  // Any reply that streams while the conversation is on is read out, typed messages' included.
  #onAgentChange = (): void => {
    const live = this.#deps.agent.live;
    if (live) {
      if (live.seq !== this.#reply?.seq) this.#reply = { seq: live.seq, text: '', feed: new SpeechFeed(), muted: false };
      this.#reply.text = replyText(live.parts);
      if (!this.#reply.muted) this.#speaker.say(this.#reply.feed.next(this.#reply.text));
      return;
    }
    const reply = this.#reply;
    if (!reply) return;
    this.#reply = undefined;
    if (reply.muted) return;
    this.#speaker.say(reply.feed.next(reply.text, true));
    this.#speaker.finish();
  };

  #update(patch: Partial<ConversationView>): void {
    const next = { ...this.#view, ...patch };
    if (next.state === this.#view.state && next.heard === this.#view.heard && next.level === this.#view.level) return;
    this.#view = next;
    this.#deps.changed(next);
  }
}
