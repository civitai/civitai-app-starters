import '@civitai/components/civitai-alert/define';
import '@civitai/components/civitai-button/define';
import '@civitai/components/civitai-loader/define';
import '@civitai/components/civitai-toast-region/define';

import { CivitaiChat } from './civitai-chat.js';
import { CivitaiChatComposer } from './civitai-chat-composer.js';
import { CivitaiChatWelcome } from './civitai-chat-welcome.js';
import { defineCivitaiChatAttachmentStrip } from './lib/civitai-chat-attachment-strip.js';
import { defineCivitaiChatDropzone } from './lib/civitai-chat-dropzone.js';

const SHELL: Array<[string, CustomElementConstructor]> = [
  ['civitai-chat-welcome', CivitaiChatWelcome],
  ['civitai-chat-composer', CivitaiChatComposer],
  ['civitai-chat', CivitaiChat],
];

/** What an empty or signed-out chat shows; the rest arrives with the session. */
export function defineChatShell(): void {
  defineCivitaiChatDropzone();
  defineCivitaiChatAttachmentStrip();
  for (const [name, ctor] of SHELL) {
    if (!customElements.get(name)) customElements.define(name, ctor);
  }
}
