import DOMPurify from 'dompurify';
import { marked } from 'marked';

let hooked = false;

function purifier(): typeof DOMPurify {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  return DOMPurify;
}

const rendered = new Map<string, string>();
const RENDERED_MAX = 300;

/** Assistant text as safe HTML. Media only ever appears in cards, so inline images are dropped. */
export function renderMarkdown(text: string): string {
  const cached = rendered.get(text);
  if (cached !== undefined) return cached;
  const html = parse(text);
  if (rendered.size >= RENDERED_MAX) rendered.delete(rendered.keys().next().value!);
  rendered.set(text, html);
  return html;
}

function parse(text: string): string {
  const visible = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const html = marked.parse(visible, { async: false, gfm: true, breaks: true });
  return purifier().sanitize(html, {
    FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'video', 'audio', 'svg', 'math'],
    FORBID_ATTR: ['style'],
  });
}
