#!/usr/bin/env node
/**
 * Generates `src/blocks/comfyCoreNodes.generated.ts`: the ComfyUI CORE node
 * classes `checkComfyGraph` accepts, read from ComfyUI's own source at ONE
 * pinned commit. The list is never typed by hand; bump the pin and re-run.
 *
 * What counts as core: every class ComfyUI registers at start-up WITHOUT a
 * custom-node pack and WITHOUT the partner API nodes. That is
 *   - the keys of `NODE_CLASS_MAPPINGS` in `nodes.py`, plus
 *   - for each file named in `nodes.py`'s `extras_files` list (the built-in
 *     `comfy_extras/` modules ComfyUI actually loads; a file in that directory
 *     that the list does not name is NOT loaded and does not count):
 *       - the string keys of a `NODE_CLASS_MAPPINGS = { ... }` literal,
 *       - every `node_id = "X"` / `node_id="X"` (V3 `io.Schema(node_id=...)`
 *         and class attributes), and
 *       - every `NodeId = "X"` class attribute (the hooks module's pattern).
 * `comfy_api_nodes/` (partner API nodes, which call paid third-party services)
 * is deliberately excluded. So are the old class names `comfy_extras/
 * nodes_replacements.py` maps to new ones: ComfyUI's `/prompt` rewrites them,
 * but whether a given worker reaches ComfyUI through that route is not known here.
 *
 * It also emits `supported_pt_extensions` from `folder_paths.py`: the file
 * extensions ComfyUI's model folders list, which `checkComfyGraph` uses to tell
 * a model FILENAME from an AIR.
 *
 * The scan is textual, not a Python import (importing ComfyUI needs torch). It
 * fails loudly rather than guessing: a listed extras file that yields no class
 * stops the run, unless its `get_node_list` literally returns `[]`.
 *
 * Usage (from packages/civitai-app-sdk):
 *   node scripts/gen-comfy-core-nodes.mjs                # clone the pinned commit
 *   node scripts/gen-comfy-core-nodes.mjs --source DIR   # use a checkout already at it
 *
 * `--source` trusts you that DIR is at COMFYUI_COMMIT; the clone path checks it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The ComfyUI commit the list is read from. Bump this, then re-run the script. */
export const COMFYUI_COMMIT = 'fe298e4e20f1ff26d30e8639267bbd0b57811390';
export const COMFYUI_REPO = 'https://github.com/comfyanonymous/ComfyUI.git';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'blocks', 'comfyCoreNodes.generated.ts');

/** The body of the `{ ... }` or `[ ... ]` literal that starts at `open`. */
function bracketBody(text, open) {
  const close = text[open] === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`unterminated literal at offset ${open}`);
}

/** Drop `#` comments so a commented-out entry is not counted. */
function stripComments(py) {
  return py
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

/** Keys of a top-level `NODE_CLASS_MAPPINGS = { "A": X, ... }` literal, or null. */
function mappingKeys(py) {
  const m = /^NODE_CLASS_MAPPINGS\s*=\s*\{/m.exec(py);
  if (!m) return null;
  const body = bracketBody(py, m.index + m[0].length - 1);
  return [...body.matchAll(/(["'])([^"'\n]+)\1\s*:/g)].map((k) => k[2]);
}

function attrIds(py) {
  return [...py.matchAll(/\b(?:node_id|NodeId)\s*=\s*(["'])([^"'\n]+)\1/g)].map((k) => k[2]);
}

function extrasFiles(nodesPy) {
  const m = /^\s*extras_files\s*=\s*\[/m.exec(nodesPy);
  if (!m) throw new Error('nodes.py: no `extras_files = [` list');
  const body = bracketBody(nodesPy, m.index + m[0].length - 1);
  const files = [...body.matchAll(/(["'])([^"'\n]+\.py)\1/g)].map((k) => k[2]);
  if (files.length === 0) throw new Error('nodes.py: `extras_files` is empty');
  return files;
}

export function collectCoreNodes(root) {
  const nodesPy = stripComments(readFileSync(join(root, 'nodes.py'), 'utf8'));
  const classes = new Set(mappingKeys(nodesPy) ?? []);
  if (classes.size === 0) throw new Error('nodes.py: no NODE_CLASS_MAPPINGS literal');
  const files = extrasFiles(nodesPy);
  for (const file of files) {
    const path = join(root, 'comfy_extras', file);
    if (!existsSync(path)) throw new Error(`extras_files names ${file}, which does not exist`);
    const py = stripComments(readFileSync(path, 'utf8'));
    const found = [...(mappingKeys(py) ?? []), ...attrIds(py)];
    // A module may register no node at all (nodes_replacements.py only registers
    // old->new renames); that is allowed only when its extension says so in code.
    const declaresNone = /def get_node_list\([^)]*\)[^:]*:\s*\n\s*return \[\]/.test(py);
    if (found.length === 0 && !declaresNone) {
      throw new Error(`comfy_extras/${file}: no node class found`);
    }
    for (const c of found) classes.add(c);
  }
  return { classes: [...classes].sort(), extrasCount: files.length };
}

export function collectModelExtensions(root) {
  const py = stripComments(readFileSync(join(root, 'folder_paths.py'), 'utf8'));
  const m = /^supported_pt_extensions\b[^=\n]*=\s*\{/m.exec(py);
  if (!m) throw new Error('folder_paths.py: no `supported_pt_extensions = {` literal');
  const body = bracketBody(py, m.index + m[0].length - 1);
  const exts = [...body.matchAll(/(["'])(\.[A-Za-z0-9]+)\1/g)].map((k) => k[2].toLowerCase());
  if (exts.length === 0) throw new Error('folder_paths.py: `supported_pt_extensions` is empty');
  return [...new Set(exts)].sort();
}

function render(classes, extrasCount, extensions) {
  const lines = classes.map((c) => `  ${JSON.stringify(c)},`).join('\n');
  return `// GENERATED by scripts/gen-comfy-core-nodes.mjs. Do not edit by hand.
// ComfyUI commit: ${COMFYUI_COMMIT}
// Source: ${COMFYUI_REPO}
// ${classes.length} classes: nodes.py NODE_CLASS_MAPPINGS plus the ${extrasCount} comfy_extras
// modules nodes.py loads. Partner API nodes (comfy_api_nodes/) are excluded.

/** The ComfyUI commit {@link COMFY_CORE_NODE_CLASSES} was generated from. */
export const COMFY_CORE_NODES_COMMIT = '${COMFYUI_COMMIT}';

/**
 * Node classes built into ComfyUI at {@link COMFY_CORE_NODES_COMMIT}, sorted.
 * A graph using only these (plus the frontend-only set) needs no custom-node pack.
 */
export const COMFY_CORE_NODE_CLASSES: readonly string[] = [
${lines}
];

/** ComfyUI's \`folder_paths.supported_pt_extensions\` at {@link COMFY_CORE_NODES_COMMIT}, lowercase, sorted. */
export const COMFY_MODEL_FILE_EXTENSIONS: readonly string[] = ${JSON.stringify(extensions)};
`;
}

function cloneAtPin() {
  const dir = mkdtempSync(join(tmpdir(), 'comfyui-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  git('init', '-q');
  git('remote', 'add', 'origin', COMFYUI_REPO);
  git('fetch', '-q', '--depth', '1', 'origin', COMFYUI_COMMIT);
  git('checkout', '-q', 'FETCH_HEAD');
  const head = git('rev-parse', 'HEAD').toString().trim();
  if (head !== COMFYUI_COMMIT) throw new Error(`checked out ${head}, expected ${COMFYUI_COMMIT}`);
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--source');
  const source = i > 0 ? process.argv[i + 1] : undefined;
  const root = source ?? cloneAtPin();
  try {
    const { classes, extrasCount } = collectCoreNodes(root);
    const extensions = collectModelExtensions(root);
    writeFileSync(OUT, render(classes, extrasCount, extensions));
    console.log(`wrote ${classes.length} core classes (${extrasCount} extras modules) to ${OUT}`);
  } finally {
    if (!source) rmSync(root, { recursive: true, force: true });
  }
}
