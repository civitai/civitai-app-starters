/** A reply's markdown as words to read out: no code, images, URLs or markup. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')
    .replace(/[*_~|]+/g, '')
    .replace(/[ \t]+/g, ' ');
}

/** Where the last finished sentence of `text` ends, 0 when none has. */
function sentencesEnd(text: string): number {
  let end = 0;
  for (const match of text.matchAll(/[.!?…:;](?=\s)|\n/g)) end = match.index + match[0].length;
  return end;
}

/**
 * Hands a streaming reply to the voice a sentence at a time. Only finished sentences go, so markup that
 * spans words (a link, bold) is whole before it is cleaned up, and nothing said has to be taken back.
 */
export class SpeechFeed {
  #said = 0;

  next(reply: string, finished = false): string {
    const words = speakable(reply);
    const end = finished ? words.length : sentencesEnd(words);
    if (end <= this.#said) return '';
    const text = words.slice(this.#said, end);
    this.#said = end;
    return text;
  }
}
