#!/usr/bin/env node
/**
 * Generates `src/blocks/comfyCoreNodes.generated.ts`: the ComfyUI CORE node
 * classes `checkComfyGraph` accepts, read from ComfyUI's own source at ONE
 * pinned commit. The list is never typed by hand; bump the pin and re-run.
 *
 * What counts as core: the node ids that the built-in modules REGISTER, read
 * from what each module hands ComfyUI (a class that is defined but not
 * registered, or whose entry is commented out, does not count):
 *   - the keys of `NODE_CLASS_MAPPINGS` in `nodes.py`, plus
 *   - for each file named in `nodes.py`'s `extras_files` list (the built-in
 *     `comfy_extras/` modules ComfyUI actually loads; a file in that directory
 *     that the list does not name is NOT loaded and does not count):
 *       - the string keys of a top-level `NODE_CLASS_MAPPINGS = { ... }` literal,
 *       - the classes in the list literal its extension's `get_node_list`
 *         returns, and the classes in a top-level `node_list = [ ... ]` (the
 *         hooks module fills `NODE_CLASS_MAPPINGS` from it in a loop), each
 *         mapped to its node id: the first `node_id = "X"` / `node_id="X"` /
 *         `schema.node_id = "X"` / `NodeId = "X"` in the class body, else its
 *         base class's (same module).
 * `comfy_api_nodes/` (partner API nodes, which call paid third-party services)
 * is deliberately excluded. So are the old class names `comfy_extras/
 * nodes_replacements.py` maps to new ones: ComfyUI's `/prompt` rewrites them,
 * but whether a given worker reaches ComfyUI through that route is not known here.
 *
 * 🔴 The pin is a ComfyUI commit chosen when the list was generated, NOT the
 * ComfyUI version the generation worker runs. The list can name classes newer
 * than the worker's ComfyUI, so a graph this list accepts can still fail there.
 *
 * It also emits `supported_pt_extensions` from `folder_paths.py`: the file
 * extensions ComfyUI's model folders list, which `checkComfyGraph` uses to tell
 * a model FILENAME from an AIR.
 *
 * The scan is textual, not a Python import (importing ComfyUI needs torch). It
 * fails loudly rather than guessing: a listed extras file that yields no class
 * stops the run (unless its `get_node_list` literally returns `[]`), and so does
 * a registered class whose node id it cannot resolve.
 *
 * Usage (from packages/civitai-app-sdk), which fetches the pinned commit:
 *   node scripts/gen-comfy-core-nodes.mjs
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

/** Top-level classes: name -> { bases, body }. A body ends at the next column-0 line. */
function topLevelClasses(py) {
  const lines = py.split('\n');
  const classes = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) j++;
    const bases = (m[2] ?? '')
      .split(',')
      .map((b) => b.trim().split('.').pop())
      .filter(Boolean);
    classes.set(m[1], { bases, body: lines.slice(i, j).join('\n') });
  }
  return classes;
}

/** A class's node id: its own first `node_id`/`NodeId` string assignment, else its base's. */
function classNodeId(classes, name, seen = new Set()) {
  const c = classes.get(name);
  if (!c || seen.has(name)) return null;
  seen.add(name);
  const m = /\b(?:node_id|NodeId)\s*=\s*(["'])([^"'\n]+)\1/.exec(c.body);
  if (m) return m[2];
  for (const base of c.bases) {
    const id = classNodeId(classes, base, seen);
    if (id) return id;
  }
  return null;
}

/** Class names in a `[ A, B, ... ]` list literal starting at `open`; anything else throws. */
function nameList(py, open, where) {
  return bracketBody(py, open)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => {
      if (!/^[A-Za-z_]\w*$/.test(n)) throw new Error(`${where}: unexpected list entry ${JSON.stringify(n)}`);
      return n;
    });
}

/** The classes a module registers through `get_node_list` or a top-level `node_list`. */
function registeredClassNames(py, where) {
  const names = [];
  const fn = /def get_node_list\([^)]*\)[^:]*:/.exec(py);
  if (fn) {
    const ret = /return\s*\[/.exec(py.slice(fn.index));
    if (!ret) throw new Error(`${where}: get_node_list does not return a list literal`);
    names.push(...nameList(py, fn.index + ret.index + ret[0].length - 1, where));
  }
  const list = /^node_list\s*=\s*\[/m.exec(py);
  if (list) names.push(...nameList(py, list.index + list[0].length - 1, where));
  return names;
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
    const where = `comfy_extras/${file}`;
    const classDefs = topLevelClasses(py);
    const ids = registeredClassNames(py, where).map((name) => {
      const id = classNodeId(classDefs, name);
      if (!id) throw new Error(`${where}: cannot resolve the node id of registered class ${name}`);
      return id;
    });
    const found = [...(mappingKeys(py) ?? []), ...ids];
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
// ${classes.length} classes: nodes.py NODE_CLASS_MAPPINGS plus the node ids the ${extrasCount}
// comfy_extras modules nodes.py loads register. Partner API nodes (comfy_api_nodes/)
// are excluded.
//
// The pin is the ComfyUI commit the list was generated from, NOT the ComfyUI
// version the generation worker runs: the list can name classes newer than the
// worker, so a graph that passes checkComfyGraph can still fail on it.

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
  const root = cloneAtPin();
  try {
    const { classes, extrasCount } = collectCoreNodes(root);
    const extensions = collectModelExtensions(root);
    writeFileSync(OUT, render(classes, extrasCount, extensions));
    console.log(`wrote ${classes.length} core classes (${extrasCount} extras modules) to ${OUT}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
