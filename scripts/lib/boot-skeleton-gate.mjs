/**
 * `bootSkeleton` manifest/markup coupling — the reusable rule.
 *
 * WHY THIS EXISTS. `manifest.bootSkeleton: true` tells the App Blocks full-page
 * run host to STAND DOWN its own loading UI: no opaque branded veil, the iframe
 * is `opacity: 1` from mount instead of fading in at BLOCK_READY, and no
 * translate/settle transition. The host publishes `aria-busy` on the iframe
 * element instead. That is a good trade ONLY if the app paints something of its
 * own immediately. Declared over an empty mount container it is strictly WORSE
 * than not opting in: the viewer stares at a blank iframe for the entire load,
 * with the veil that used to cover it deliberately removed.
 *
 * So the key and the markup are ONE change. This module is what makes them
 * inseparable — the hazard is a future edit that keeps one and drops the other,
 * and neither half is wrong-looking on its own.
 *
 * This implements the platform's `bootSkeleton-not-empty` gate verbatim
 * (BLOCKING) plus its `bootSkeleton-paints-without-network` companion
 * (ADVISORY). Kept here rather than inline in the test so the same function can
 * be pointed at a built `dist/index.html` later — the platform gate runs on the
 * BUILT entry document, because a bundler can rewrite it.
 *
 * NO DEPENDENCIES on purpose. Its caller (`tests/guards/boot-skeleton.test.mjs`)
 * runs in CI's `Starter` matrix job via `pnpm test:guards`, which executes
 * BEFORE `pnpm install` — so node stdlib only, hence the small HTML parser
 * below rather than a real one.
 */

/** Elements whose content is raw text, not markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/** HTML void elements — never have children, never need a close tag. */
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Tags that do NOT satisfy "the container paints something". Verbatim from the
 * gate spec. Text nodes INSIDE them do not count either — a `#root` holding
 * only a `<script>` full of JavaScript source paints nothing, and counting that
 * script's text would let exactly that case through.
 */
const INERT_TAGS = new Set(['script', 'template', 'style', 'link', 'noscript']);

/** Selector-equivalent of `#root, #app, [data-app-root]`. */
function isMountContainer(el) {
  return el.attrs.id === 'root' || el.attrs.id === 'app' || 'data-app-root' in el.attrs;
}

/**
 * Minimal HTML parser: enough for an app entry document, and deliberately no
 * more. Handles comments, doctypes, void elements, self-closing syntax,
 * raw-text elements, and quoted/unquoted/valueless attributes. It does NOT
 * implement the spec's implied-end-tag rules (`<p>`/`<li>`/table scoping) — an
 * entry document does not use them, and a mis-nested close tag unwinds the
 * stack to the nearest match rather than guessing.
 *
 * Node shapes:
 *   { type: 'element', tag, attrs: {name: value}, children: [] }
 *   { type: 'text', text }
 *
 * @param {string} html
 * @returns {{type:'element',tag:string,attrs:Record<string,string>,children:any[]}} synthetic root
 */
export function parseHtml(html) {
  const root = { type: 'element', tag: '#document', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;

  const top = () => stack[stack.length - 1];
  const pushText = (text) => {
    if (text) top().children.push({ type: 'text', text });
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));

    // Comment.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    // Doctype / processing instruction / CDATA — skipped wholesale.
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    // Close tag.
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      // Unwind to the nearest matching open element, if there is one.
      const at = stack.findLastIndex((n) => n.tag === tag);
      if (at > 0) stack.length = at;
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    // Open tag. Find its `>`, respecting quoted attribute values.
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt));
    if (!nameMatch) {
      // A stray `<` that starts no tag is literal text.
      pushText('<');
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    let j = lt + nameMatch[0].length;
    let quote = null;
    while (j < html.length) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j += 1;
    }
    const attrSrc = html.slice(lt + nameMatch[0].length, j);
    const selfClosing = /\/\s*$/.test(attrSrc);
    const el = { type: 'element', tag, attrs: parseAttrs(attrSrc), children: [] };
    top().children.push(el);
    i = j + 1;

    if (VOID.has(tag) || selfClosing) continue;

    if (RAW_TEXT.has(tag)) {
      // Consume to the matching close tag without parsing the body as markup.
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const body = m ? rest.slice(0, m.index) : rest;
      if (body) el.children.push({ type: 'text', text: body });
      i = m ? i + m.index + m[0].length : html.length;
      continue;
    }

    stack.push(el);
  }

  return root;
}

/** `id="root" data-boot-skeleton aria-hidden='true'` → object. Valueless → ''. */
function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s/=>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    if (name === '/') continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/** Depth-first walk over every element node under (and excluding) `node`. */
function* descendants(node) {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    yield child;
    yield* descendants(child);
  }
}

/** Every element in the document, in document order. */
function allElements(root) {
  return [...descendants(root)];
}

/**
 * Does this container's subtree paint anything? Rule 3 of the gate: at least
 * one descendant element whose tag is not inert, OR at least one non-whitespace
 * text node (excluding text inside inert elements — see INERT_TAGS).
 */
function containerPaints(container) {
  const walk = (node, insideInert) => {
    for (const child of node.children ?? []) {
      if (child.type === 'text') {
        if (!insideInert && child.text.trim() !== '') return true;
        continue;
      }
      if (child.type !== 'element') continue;
      const inert = insideInert || INERT_TAGS.has(child.tag);
      if (!inert) return true;
      if (walk(child, true)) return true;
    }
    return false;
  };
  return walk(container, false);
}

/**
 * Run the gate.
 *
 * @param {object} args
 * @param {object} args.manifest  parsed `block.manifest.json`
 * @param {string} args.html      the entry document's HTML source
 * @param {string} [args.label]   path shown in messages
 * @returns {{
 *   applicable: boolean,
 *   ok: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   containerCount: number,
 *   skeletonCount: number,
 * }}
 */
export function checkBootSkeleton({ manifest, html, label = 'index.html' }) {
  const errors = [];
  const warnings = [];

  if (manifest?.bootSkeleton !== true) {
    return { applicable: false, ok: true, errors, warnings, containerCount: 0, skeletonCount: 0 };
  }

  const root = parseHtml(html);
  const elements = allElements(root);
  const containers = elements.filter(isMountContainer);
  const skeletons = elements.filter((el) => 'data-boot-skeleton' in el.attrs);

  // Rule 2: no identifiable mount container → PASS. The gate does not guess.
  if (containers.length === 0) {
    return {
      applicable: true,
      ok: true,
      errors,
      warnings,
      containerCount: 0,
      skeletonCount: skeletons.length,
    };
  }

  // Rule 3: every container must paint something.
  for (const container of containers) {
    if (containerPaints(container)) continue;
    const name = container.attrs.id ? `#${container.attrs.id}` : '[data-app-root]';
    errors.push(
      `${label}: manifest declares bootSkeleton: true but ${name} is empty in the built ` +
        `index.html — the run host stands down its loading veil for this app, so the viewer ` +
        `would see a blank iframe for the whole load. Either paint a boot state inside the ` +
        `container, or remove bootSkeleton from the manifest.`,
    );
  }

  // Rule 4: a skeleton outside every container is never replaced by the render.
  const inContainer = new Set();
  for (const container of containers) {
    for (const el of descendants(container)) inContainer.add(el);
  }
  for (const el of skeletons) {
    if (inContainer.has(el)) continue;
    errors.push(
      `${label}: the [data-boot-skeleton] element is outside the mount container, so the ` +
        `app's own render will not replace it and it will stay on screen after mount.`,
    );
  }

  // ADVISORY: boot content styled only by an external stylesheet is a second
  // round-trip, in exactly the window the declaration is about.
  if (errors.length === 0) {
    const styledInline = elements.some(
      (el) => el.tag === 'style' && /data-boot-skeleton/.test(textOf(el)),
    );
    const styledByAttr = [...inContainer].some((el) => 'style' in el.attrs);
    if (!styledInline && !styledByAttr) {
      warnings.push(
        `${label}: bootSkeleton is declared but no inline <style> mentions ` +
          `data-boot-skeleton and no element inside the mount container carries a style= ` +
          `attribute — the boot content is styled only by an external stylesheet, which is a ` +
          `second round-trip in exactly the window the declaration is about.`,
      );
    }
  }

  return {
    applicable: true,
    ok: errors.length === 0,
    errors,
    warnings,
    containerCount: containers.length,
    skeletonCount: skeletons.length,
  };
}

/** Concatenated text of an element's direct text children. */
function textOf(el) {
  return (el.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/**
 * Structural theme assertions for the entry document. Separate from the gate
 * because the platform does not enforce them — they are OUR bet, recorded so a
 * later edit cannot quietly flip the default back to light.
 *
 * Returns the three facts the guard asserts rather than asserting them here, so
 * the test owns the expectations and the failure messages.
 *
 * @param {string} html
 * @returns {{
 *   colorSchemeMeta: string|null,
 *   inlineStyleCss: string,
 *   darkMediaBlocks: string[],
 *   lightMediaBlocks: string[],
 *   baseCss: string,
 * }}
 */
export function readThemeShape(html) {
  const root = parseHtml(html);
  const elements = allElements(root);

  const meta = elements.find(
    (el) => el.tag === 'meta' && (el.attrs.name ?? '').toLowerCase() === 'color-scheme',
  );

  // 🔴 Strip CSS comments FIRST. Without this the analysis is walkable by
  // PROSE: the starter's own `/* … there is deliberately NO
  // @media (prefers-color-scheme: dark) block … */` comment matched the
  // dark-media regex, whose `[^{]*` then ran on to the next real `{` and
  // reported the BASE `html { background }` rule as the body of a dark media
  // query. Measured while writing this file — it turned a correct document into
  // a failing one, and the mirror-image (a comment making a genuinely wrong
  // document look right) is the version that ships a bug.
  const inlineStyleCss = elements
    .filter((el) => el.tag === 'style')
    .map(textOf)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Brace-matched extraction of `@media (prefers-color-scheme: X) { ... }`.
  const extract = (which) => {
    const blocks = [];
    const re = new RegExp(`@media[^{]*prefers-color-scheme\\s*:\\s*${which}[^{]*\\{`, 'gi');
    let m;
    while ((m = re.exec(inlineStyleCss)) !== null) {
      let depth = 1;
      let k = m.index + m[0].length;
      const start = k;
      while (k < inlineStyleCss.length && depth > 0) {
        if (inlineStyleCss[k] === '{') depth += 1;
        else if (inlineStyleCss[k] === '}') depth -= 1;
        k += 1;
      }
      blocks.push(inlineStyleCss.slice(start, k - 1));
    }
    return blocks;
  };

  const darkMediaBlocks = extract('dark');
  const lightMediaBlocks = extract('light');

  // Everything outside any prefers-color-scheme media block = the base rules.
  let baseCss = inlineStyleCss;
  for (const block of [...darkMediaBlocks, ...lightMediaBlocks]) {
    baseCss = baseCss.split(block).join('');
  }
  baseCss = baseCss.replace(/@media[^{]*prefers-color-scheme[^{]*\{\s*\}/gi, '');

  return {
    colorSchemeMeta: meta ? meta.attrs.content ?? null : null,
    inlineStyleCss,
    darkMediaBlocks,
    lightMediaBlocks,
    baseCss,
  };
}
