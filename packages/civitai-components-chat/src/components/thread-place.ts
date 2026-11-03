/** A turn and how far its top is below the top of the thread's visible area: where a viewer who scrolled away was. */
export interface HeldPlace {
  seq: number;
  offset: number;
}

/**
 * Per chat on the page (keyed by the root its thread is drawn in, the chat's shadow root): where the
 * viewer was in the thread that left it last, when they had scrolled away from its end. A thread made
 * again for the same conversation (it is rebuilt behind the loader while that chat is read again)
 * opens there instead of at the end. Only the last one, and forgotten as a chat is opened anew, so
 * opening a chat (another one, or one again after a new chat) opens at its end.
 *
 * Its own module, apart from the thread's, so the chat's shell can clear it without loading the thread.
 */
const lastLeft = new WeakMap<Node, { conversationId: string; place: HeldPlace | undefined }>();

export function leaveThreadPlace(root: Node, conversationId: string, place: HeldPlace | undefined): void {
  lastLeft.set(root, { conversationId, place });
}

/** The place kept for `conversationId` in `root`, if the thread that left it last was that chat's and its viewer had scrolled away. */
export function threadPlaceFor(root: Node, conversationId: string): HeldPlace | undefined {
  const left = lastLeft.get(root);
  return left?.conversationId === conversationId ? left.place : undefined;
}

/** A chat is opened anew in `root` (not the one on screen read again): it opens at its end. */
export function forgetThreadPlace(root: Node): void {
  lastLeft.delete(root);
}
