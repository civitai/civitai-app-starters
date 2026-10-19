/** The end-of-turn model's view of one pause: how sure it is that the speaker has finished. */
export interface TurnVerdict {
  /** Seconds of audio sent when the judged speech ended; ties the verdict to its pause. */
  speechEnd: number;
  probability: number;
}

const SURELY_DONE = 0.7;
const SURELY_UNFINISHED = 0.1;

/** Seconds of silence before the reply goes out, by how sure the model is that the viewer finished. */
const HOLD = {
  done: 0.25,
  unsure: 2,
  // Someone searching for a word can go quiet for several seconds.
  unfinished: 6,
  // Covers the wait for the server's verdict.
  unjudged: 1.2,
};

export function holdFor(verdict: TurnVerdict | undefined): number {
  if (!verdict) return HOLD.unjudged;
  if (verdict.probability >= SURELY_DONE) return HOLD.done;
  return verdict.probability < SURELY_UNFINISHED ? HOLD.unfinished : HOLD.unsure;
}

/** A verdict counts only for the pause it judged; speech after it starts a new one. */
export function verdictFor(verdict: TurnVerdict | undefined, speechEnd: number): TurnVerdict | undefined {
  return verdict && verdict.speechEnd >= speechEnd - 0.15 ? verdict : undefined;
}
