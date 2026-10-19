import { describe, expect, it } from 'vitest';

import { SpeechFeed } from './speech-feed.js';

describe('SpeechFeed', () => {
  it('reads a streaming reply out a finished sentence at a time, without its markup', () => {
    const feed = new SpeechFeed();
    const said: string[] = [];
    let reply = '';
    for (const delta of ['Sure! Here is **the', ' plan**. See [the docs](https://civitai.com/docs', ') for more', ' details', '.']) {
      reply += delta;
      said.push(feed.next(reply));
    }
    said.push(feed.next(reply, true));

    expect(said.filter(Boolean)).toEqual(['Sure!', ' Here is the plan.', ' See the docs for more details.']);
  });

  it('skips code the reply shows', () => {
    const feed = new SpeechFeed();

    expect(feed.next('Run this:\n```\nnpm install\n```\nThen restart it.', true).replace(/\s+/g, ' ').trim()).toBe('Run this: Then restart it.');
  });
});
