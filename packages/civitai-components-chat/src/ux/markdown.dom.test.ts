import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders ordinary formatting', () => {
    expect(renderMarkdown('**bold** and a list:\n\n- one\n- two')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('- one\n- two')).toContain('<li>two</li>');
  });

  it('strips anything that could run code or pull in media', () => {
    const html = renderMarkdown('<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror="alert(1)"> ![p](https://x/p.png)');
    expect(html).not.toMatch(/script|javascript:|onerror|<img/i);
  });

  it('opens links in a new tab without handing over the page', () => {
    expect(renderMarkdown('[Civitai](https://civitai.com)')).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('never shows thinking, even half-streamed', () => {
    expect(renderMarkdown('<think>let me plan')).toBe('');
    expect(renderMarkdown('<think>plan</think>Here you go')).toContain('Here you go');
  });
});
