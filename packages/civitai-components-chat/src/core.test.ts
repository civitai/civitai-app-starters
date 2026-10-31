import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import * as clients from './mcp/clients.js';
import * as result from './mcp/result.js';
import { fakeMcpServers } from './test-support/fake-mcp.js';
import * as extra from './tools/extra.js';
import { extraToolSet } from './tools/extra.js';
import * as host from './tools/host.js';

/**
 * `@civitai/components-chat/core` and `/runner-protocol` are what a server-side runner imports, so
 * nothing either loads, however indirectly, may need a DOM or Lit. Checked on the source's import
 * graph as it runs: imports and re-exports that are not `type`-only (with `verbatimModuleSyntax`, only
 * those are erased), and dynamic `import()`s. This file runs in the `node` project, with no DOM.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(SRC, '..');

/** The packages the headless entries may load. Anything else is a new dependency of the server runner: allow it here on purpose. */
const ALLOWED_PACKAGES = ['ai', '@ai-sdk/openai-compatible', '@civitai/sdk', '@modelcontextprotocol/sdk', 'ulid'];
/** What only a page has: Lit and the elements, HTML sanitising and Markdown rendering, the design system's CSS elements. */
const DOM_PACKAGES = /^(lit|@lit\/|lit\/|dompurify$|marked$|@civitai\/components($|\/))/;
/** Directories and files that are the page's: the elements, voice, uploads, and the session that wires the element. */
const PAGE_FILES = /^(components\/|voice\/|uploads\/|runtime\.ts$|session\.ts$|.*\.define\.ts$)/;
/** What a dynamic `import()` of a computed specifier is recorded as. */
const COMPUTED = '<computed import()>';

function runtimeGraph(entry: string): { files: string[]; packages: Map<string, string[]> } {
  const seen = new Set<string>();
  const packages = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [argument] = node.arguments;
        // An import of something not spelled out cannot be checked: it counts as a package no allowlist names.
        specifiers.push(argument && ts.isStringLiteralLike(argument) ? argument.text : COMPUTED);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const asTs = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
        visit(existsSync(asTs) ? asTs : resolve(dirname(file), specifier));
      } else {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
        packages.set(name, [...(packages.get(name) ?? []), relative(SRC, file)]);
      }
    }
  };
  visit(resolve(SRC, entry));
  return { files: [...seen].map((file) => relative(SRC, file)).sort(), packages };
}

describe.each(['core.ts', 'runner-protocol.ts'])('the headless entry %s', (entry) => {
  const graph = runtimeGraph(entry);

  it('loads no page-only module, however indirectly', () => {
    expect(graph.files.filter((file) => PAGE_FILES.test(file))).toEqual([]);
  });

  it('loads no package but the allowed ones, and none that needs a DOM', () => {
    const used = [...graph.packages.keys()];
    expect(used.filter((name) => DOM_PACKAGES.test(name))).toEqual([]);
    expect(used.filter((name) => !ALLOWED_PACKAGES.includes(name))).toEqual([]);
  });
});

describe('the import-graph walk itself', () => {
  // Positive control: the same walk over the element sees Lit and the element files, so the zeros above are not a walk that sees nothing.
  it('sees Lit, the elements and a computed import() from the element', () => {
    const graph = runtimeGraph('components/civitai-chat.ts');
    expect([...graph.packages.keys()]).toEqual(expect.arrayContaining(['lit', 'dompurify', 'marked', COMPUTED]));
    expect(graph.files.filter((file) => PAGE_FILES.test(file)).length).toBeGreaterThan(5);
  });

  it('follows re-exports into the modules behind them', () => {
    expect(runtimeGraph('core.ts').files).toEqual(expect.arrayContaining(['agent/core.ts', 'agent/subagents.ts', 'store/thread-store.ts', 'tools/gate.ts', 'tools/host.ts', 'store/attachments.ts', 'mcp/clients.ts', 'mcp/result.ts']));
  });
});

describe('the headless entries in plain Node', () => {
  it('load and hand over the reply loop and the protocol helpers, with no DOM present', async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const core = await import('./core.js');
    expect(typeof core.AgentCore).toBe('function');
    expect(typeof core.gateToolSet).toBe('function');
    expect(typeof core.buildModelMessages).toBe('function');
    expect(typeof core.ThreadStore).toBe('function');
    const protocol = await import('./runner-protocol.js');
    expect(protocol.RUN_PROTOCOL_VERSION).toBe(1);
    expect(typeof protocol.createPartsDiffer).toBe('function');
    expect(typeof protocol.applyRunEvent).toBe('function');
  });

  it("turn an MCP server's tools into the reply's tools exactly as the page does: the same adapter, the same names, the same trim", async () => {
    // Loosely typed, so this file also typechecks against a core entry without the adapter.
    const core = (await import('./core.js')) as unknown as Record<string, unknown>;
    // The page's own functions, not copies: a runner's tools cannot drift from the page's.
    expect(core.extraToolSet).toBe(extraToolSet);
    expect([core.RESULT_HEAD_CHARS, core.RESULT_TAIL_CHARS]).toEqual([2_000, 6_000]);
    expect((core.namespacedToolName as (server: string, tool: string) => string)('docs', 'search')).toBe('docs__search');

    const url = 'https://example.com/mcp';
    // Three distinct runs, so the middle one is the only thing a correct trim leaves out.
    const reply = `${'a'.repeat(2_000)}${'b'.repeat(1_234)}${'c'.repeat(6_000)}`;
    const mcp = fakeMcpServers({ [url]: [{ name: 'search', description: 'Searches the docs.', run: () => ({ content: [{ type: 'text', text: reply }] }) }] });
    const Pool = core.McpServerPool as new (deps: { onError(server: unknown, error: unknown): void }) => { sync(servers: unknown[]): void; tools(): Promise<unknown[]>; close(): void };
    const onError = vi.fn();
    const pool = new Pool({ onError });
    pool.sync([{ id: 'docs', url, fetch: mcp.fetch, label: 'Docs' }]);
    const tools = (core.extraToolSet as typeof extraToolSet)((await pool.tools()) as never, { taken: {} });
    expect(Object.keys(tools)).toEqual(['docs__search']);
    expect(tools.docs__search!.description).toBe('[Docs] Searches the docs.');
    const text = await tools.docs__search!.execute!({}, { toolCallId: 'c', messages: [] });
    expect(text).toBe(`${'a'.repeat(2_000)}\n…(1234 characters omitted)…\n${'c'.repeat(6_000)}`);
    expect(onError).not.toHaveBeenCalled();
    pool.close();
  });

  it("let a server runner pass a server's replies whole with resultLimit: false, through the same pool and adapter", async () => {
    const core = (await import('./core.js')) as unknown as Record<string, unknown>;
    const url = 'https://example.com/mcp';
    const reply = `${'a'.repeat(2_000)}${'b'.repeat(42_000)}${'c'.repeat(6_000)}`;
    const mcp = fakeMcpServers({ [url]: [{ name: 'search', run: () => ({ content: [{ type: 'text', text: reply }] }) }] });
    const Pool = core.McpServerPool as new (deps: { onError(server: unknown, error: unknown): void }) => { sync(servers: unknown[]): void; tools(): Promise<unknown[]>; close(): void };
    const pool = new Pool({ onError: vi.fn() });
    pool.sync([{ id: 'docs', url, fetch: mcp.fetch, resultLimit: false }]);
    const tools = (core.extraToolSet as typeof extraToolSet)((await pool.tools()) as never, { taken: {} });
    expect(await tools.docs__search!.execute!({}, { toolCallId: 'c', messages: [] })).toBe(reply);
    pool.close();
  });

  it("hand a server runner the chat's own MCP connection, result trimming and host-tool helpers, not copies", async () => {
    const core = (await import('./core.js')) as unknown as Record<string, unknown>;
    const internals: Record<string, Record<string, unknown>> = {
      createMcpConnection: clients,
      McpConnectionClosedError: clients,
      McpStreamLostError: clients,
      mcpResultToText: result,
      keepEnds: extra,
      limitResult: extra,
      hostToolSet: host,
      MEDIA_NOTE: host,
      HOST_TOOL_FAILED_NOTE: host,
    };
    for (const [name, module] of Object.entries(internals)) {
      expect(core[name], name).toBeDefined();
      expect(core[name], name).toBe(module[name]);
    }
    // Literal values, so a reworded note is a deliberate change here too.
    expect(core.MEDIA_NOTE).toBe(' Pass attachment ids (like up1-1 or gen2-1-1) for files from this chat.');
    expect(core.HOST_TOOL_FAILED_NOTE).toBe('This did not work. Tell the user in plain words; do not retry it this turn.');
    expect((core.keepEnds as (text: string, head: number, tail: number) => string)('aaXXbbb', 2, 3)).toBe('aa\n…(2 characters omitted)…\nbbb');
  });

  it('are published as their own subpaths, built from these sources', () => {
    const exports = (JSON.parse(readFileSync(resolve(PACKAGE, 'package.json'), 'utf8')) as { exports: Record<string, unknown> }).exports;
    expect(exports['./core']).toEqual({ types: './dist/core.d.ts', import: './dist/core.js' });
    expect(exports['./runner-protocol']).toEqual({ types: './dist/runner-protocol.d.ts', import: './dist/runner-protocol.js' });
  });
});
