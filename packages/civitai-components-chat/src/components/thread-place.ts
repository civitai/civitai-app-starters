/** A turn and how far its top is below the top of the thread's visible area: where a viewer who scrolled away was. */
export interface HeldPlace {
  seq: number;
  offset: number;
}

/**
 * Where the viewer was in the thread that left the page last, when they had scrolled away from its
 * end. A thread made again for the same chat (it is rebuilt behind the loader while that chat is read
 * again) opens there instead of at the end. Only the last one, and forgotten as a chat is opened anew,
 * so opening a chat (another one, or one again after a new chat) opens at its end as it always has.
 *
 * Its own module, apart from the thread's, so the chat's shell can clear it without loading the thread.
 */
let lastLeft: { conversationId: string; place: HeldPlace | undefined } | undefined;

export function leaveThreadPlace(conversationId: string, place: HeldPlace | undefined): void {
  lastLeft = { conversationId, place };
}

/** The place kept for `conversationId`, if the thread that left last was that chat's and its viewer had scrolled away. */
export function threadPlaceFor(conversationId: string): HeldPlace | undefined {
  return lastLeft?.conversationId === conversationId ? lastLeft.place : undefined;
}

/** A chat is opened anew (not the one on screen read again): it opens at its end. */
export function forgetThreadPlace(): void {
  lastLeft = undefined;
}
