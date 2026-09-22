/**
 * dts-public-type-closure.mjs
 * ---------------------------
 * The SCANNER behind `pnpm check:public-types` (#379). Pure: it takes a
 * `typescript` module, a list of built `.d.ts` entry points, and answers one
 * question per reference site —
 *
 *   "this public export's declaration names type `T`; can a consumer of the
 *    published package name `T` too?"
 *
 * It resolves every type reference through the real TypeScript checker (not a
 * regex), so a re-export chain, an aliased import and a qualified name all land
 * on the same declaration node the compiler would pick.
 *
 * WHAT COUNTS AS "A CONSUMER CAN NAME IT"
 * =======================================
 * A referenced declaration is NAMEABLE when it is exported from ANY public
 * entry of ANY package in this repo — the entries are the `exports` map's
 * `types` targets, i.e. exactly what an installed consumer can `import type`
 * from. Cross-PACKAGE counts because the packages depend on each other:
 * `@civitai/blocks-react` lists `@civitai/app-sdk` as a dependency, so a type
 * `blocks-react` mentions and `app-sdk/blocks` exports is one `import type`
 * away, not a dead end.
 *
 * Deliberately NOT flagged:
 *   - type PARAMETERS (`T` in `Foo<T>`) — not a declaration a consumer names.
 *   - anything declared in `lib.*.d.ts` (`Promise`, `Record`, …).
 *   - anything declared under `node_modules` outside this repo's packages
 *     (`React.ReactNode`, `@civitai/client`'s step templates, …). Those are the
 *     consumer's own dependencies; nameability there is that package's problem.
 *
 * POSITION MATTERS, AND THAT IS THE WHOLE POINT
 * =============================================
 * "Exported declaration references a non-exported type" is NOT by itself a
 * defect. When an exported interface `extends` a non-exported base, TypeScript
 * inlines every member into the derived type — a consumer names the DERIVED
 * type and gets the complete shape, and can re-derive the shared half with
 * `Pick`/`Omit`. MEASURED, not assumed: `scripts/check-public-type-closure.mjs`'s
 * header records an external consumer, installed from the real `pnpm pack`
 * tarballs, exercising every such site with zero type errors while a companion
 * file proves the bases genuinely are un-importable.
 *
 * So each site is classified by POSITION, and the caller decides which positions
 * are hard failures. {@link NAMEABLE_POSITIONS} is the set where the only route
 * left to a consumer is `ReturnType<>`/`Parameters<>` over a function they must
 * also name — i.e. where the missing export costs them something.
 */

/**
 * Positions where a missing export is REAL friction: the consumer must produce
 * or store a value of the type, and the only name-free route is
 * `ReturnType<typeof f>` / `Parameters<typeof f>[n]` — which forces them to name
 * the function as well and index a tuple.
 */
export const NAMEABLE_POSITIONS = ['return-type', 'parameter', 'callback-return'];

/**
 * Classify a type reference by where it sits, walking OUTWARD and taking the
 * innermost relationship that matches. The distinctions that carry weight:
 *
 *   `extends` / `implements`   the base itself — members inline into the
 *                              derived type, so the name is never needed.
 *   `extends-typearg`          buried in the base's type ARGUMENTS; still
 *                              inlined, but not the base itself.
 *   `return-type` / `parameter`  on a function/method DECLARATION.
 *   `callback-return` / `callback-parameter`  on a nested function TYPE, e.g.
 *                              `onReady?: (h: Handle) => void`. A callback's
 *                              parameter is CONTEXTUALLY TYPED — the consumer
 *                              writes `(h) => …` and `h` is fully typed without
 *                              a name. Its RETURN is not: the consumer must
 *                              produce that value.
 *   `alias-rhs`                the right-hand side of an exported type alias —
 *                              reachable with `Extract`/`keyof`/indexed access.
 *   `property`                 reachable with `T['key']`.
 */
export function positionKind(ts, node) {
  let n = node;
  let hops = 0;
  while (n && n.parent) {
    const p = n.parent;

    if (ts.isHeritageClause(p) || ts.isHeritageClause(n)) {
      const clause = ts.isHeritageClause(p) ? p : n;
      const base = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
      return hops === 0 ? base : `${base}-typearg`;
    }

    if (ts.isTypeParameterDeclaration(p)) {
      if (p.constraint === n) return 'type-param-constraint';
      if (p.default === n) return 'type-param-default';
      return 'type-param';
    }

    if (p.type === n) {
      if (ts.isFunctionTypeNode(p) || ts.isConstructorTypeNode(p)) return 'callback-return';
      if (
        ts.isFunctionDeclaration(p) ||
        ts.isMethodSignature(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isCallSignatureDeclaration(p) ||
        ts.isConstructSignatureDeclaration(p)
      ) {
        return 'return-type';
      }
    }

    if (ts.isParameter(p)) {
      return ts.isFunctionTypeNode(p.parent) || ts.isConstructorTypeNode(p.parent)
        ? 'callback-parameter'
        : 'parameter';
    }

    if (ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) return 'property';
    if (ts.isIndexSignatureDeclaration(p)) return 'index-signature';
    if (ts.isTypeAliasDeclaration(p)) return 'alias-rhs';
    if (ts.isVariableDeclaration(p)) return 'variable-type';

    n = p;
    hops++;
  }
  return 'other';
}

/** Stable identity for a declaration node, so two routes to it compare equal. */
function declKey(decl) {
  return `${decl.getSourceFile().fileName}:${decl.pos}:${decl.end}`;
}

function isLibFile(ts, sourceFile) {
  return sourceFile.hasNoDefaultLib === true || /\/lib\.[^/]*\.d\.ts$/.test(sourceFile.fileName);
}

/**
 * Scan the given built entry points.
 *
 * @param {object} args
 * @param {import('typescript')} args.ts
 * @param {{ pkg: string, label: string, dts: string }[]} args.entries
 * @param {(fileName: string) => boolean} [args.isFirstParty] which declaration
 *   files belong to THIS repo's packages. Anything else is a consumer-owned
 *   dependency and is not this repo's problem. Defaults to "not under a
 *   node_modules that isn't one of our own package dirs".
 * @param {string} [args.rel] prefix stripped from reported paths.
 * @returns {{ findings: object[], stats: object }}
 */
export function scanEntries({ ts, entries, isFirstParty, rel = '' }) {
  const firstParty =
    isFirstParty ??
    ((fileName) => !fileName.includes('/node_modules/') || fileName.includes('/packages/civitai-'));

  const opts = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
  };

  const program = ts.createProgram(
    entries.map((e) => e.dts),
    opts,
  );
  const checker = program.getTypeChecker();

  const unalias = (sym) => {
    if (!sym) return sym;
    if ((sym.flags & ts.SymbolFlags.Alias) === 0) return sym;
    try {
      return checker.getAliasedSymbol(sym);
    } catch {
      return sym;
    }
  };

  // Pass 1: every declaration a consumer can reach by name, and under what name.
  const nameable = new Map(); // declKey -> ["<label>#<exportName>", …]
  const exportsByEntry = new Map(); // label -> Map(name -> symbol)

  for (const e of entries) {
    const sf = program.getSourceFile(e.dts);
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    const own = new Map();
    if (moduleSymbol) {
      for (const exp of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = unalias(exp);
        own.set(exp.name, resolved);
        for (const d of resolved.declarations ?? []) {
          const k = declKey(d);
          if (!nameable.has(k)) nameable.set(k, []);
          nameable.get(k).push(`${e.label}#${exp.name}`);
        }
      }
    }
    exportsByEntry.set(e.label, own);
  }

  // Pass 2: walk each public export's declaration for type references.
  const findings = [];
  const stats = {
    entries: entries.length,
    exportedSymbols: 0,
    referenceNodes: 0,
    typeParameters: 0,
    libDeclared: 0,
    thirdParty: 0,
    firstParty: 0,
    firstPartyNameable: 0,
  };
  for (const m of exportsByEntry.values()) stats.exportedSymbols += m.size;

  const seen = new Set();

  const ownerOf = (node) => {
    let n = node;
    while (n) {
      if (ts.isVariableStatement(n)) {
        return n.declarationList.declarations[0]?.name?.getText?.() ?? '<var>';
      }
      if (
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isEnumDeclaration(n)
      ) {
        return n.name?.getText?.() ?? '<anonymous>';
      }
      n = n.parent;
    }
    return '<unknown>';
  };

  for (const e of entries) {
    for (const [exportName, symbol] of exportsByEntry.get(e.label)) {
      for (const decl of symbol.declarations ?? []) {
        const visitKey = `${e.label}|${declKey(decl)}`;
        if (seen.has(visitKey)) continue;
        seen.add(visitKey);

        const visit = (node) => {
          let entity = null;
          if (ts.isTypeReferenceNode(node)) entity = node.typeName;
          else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
            entity = node.expression;
          } else if (ts.isTypeQueryNode(node)) entity = node.exprName;
          else if (ts.isImportTypeNode(node) && node.qualifier) entity = node.qualifier;

          if (entity) {
            stats.referenceNodes++;
            let leftmost = entity;
            while (ts.isQualifiedName(leftmost)) leftmost = leftmost.left;
            const symbolAt =
              checker.getSymbolAtLocation(entity) ?? checker.getSymbolAtLocation(leftmost);
            const resolved = unalias(symbolAt);
            const decls = resolved?.declarations ?? [];

            if (decls.length > 0) {
              if (decls.some((d) => ts.isTypeParameterDeclaration(d))) {
                stats.typeParameters++;
              } else {
                const sf = decls[0].getSourceFile();
                if (isLibFile(ts, sf)) stats.libDeclared++;
                else if (!firstParty(sf.fileName)) stats.thirdParty++;
                else {
                  stats.firstParty++;
                  const via = decls.flatMap((d) => nameable.get(declKey(d)) ?? []);
                  if (via.length > 0) stats.firstPartyNameable++;
                  else {
                    findings.push({
                      entry: e.label,
                      export: exportName,
                      owner: ownerOf(node),
                      referenced: entity.getText(),
                      position: positionKind(ts, node),
                      declaredIn: sf.fileName.replace(rel, ''),
                      declKey: declKey(decls[0]),
                    });
                  }
                }
              }
            }
          }
          ts.forEachChild(node, visit);
        };

        // Skip the declaration's own NAME; everything else is fair game.
        ts.forEachChild(decl, (child) => {
          if (child === decl.name) return;
          visit(child);
        });
      }
    }
  }

  findings.sort((a, b) =>
    `${a.entry}${a.export}${a.position}${a.referenced}`.localeCompare(
      `${b.entry}${b.export}${b.position}${b.referenced}`,
    ),
  );
  return { findings, stats };
}

/** The ledger spelling of one finding. One line, stable, sortable. */
export function ledgerLine(f) {
  return `${f.entry}#${f.export} :: ${f.position} :: ${f.referenced}`;
}
