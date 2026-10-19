import type { ChatSession } from '../../session.js';
import { PcmRecorder } from '../pcm-recorder.js';
import { loadTurnModel } from './turn-model.js';
import { VoiceConversation, type ConversationView } from './voice-conversation.js';

export type { ConversationState, ConversationView } from './voice-conversation.js';

export interface ConversationHost {
  /** Sends the viewer's words as their message, through the same checks as a typed one. */
  send(text: string): Promise<void>;
  changed(view: ConversationView): void;
  failed(error: unknown): void;
}

/** Starts a spoken conversation on `session`; replies are written to be read aloud until it ends. */
export async function startConversation(session: ChatSession, host: ConversationHost): Promise<{ end(): void }> {
  const conversation = new VoiceConversation({
    agent: session.agent,
    send: host.send,
    openTranscription: () => session.openLiveTranscription(),
    openSpeech: () => session.openLiveSpeech(),
    cancel: (workflowId) => session.cancelWorkflow(workflowId),
    microphone: (events) => PcmRecorder.start(events),
    turnModel: loadTurnModel,
    changed: host.changed,
    failed: host.failed,
  });
  session.spokenReplies = true;
  try {
    await conversation.start();
  } catch (error) {
    session.spokenReplies = false;
    conversation.end();
    throw error;
  }
  return {
    end() {
      session.spokenReplies = false;
      conversation.end();
    },
  };
}
