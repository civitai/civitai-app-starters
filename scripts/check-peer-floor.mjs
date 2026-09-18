#!/usr/bin/env node
/**
 * check-peer-floor.mjs
 * --------------------
 * Verifies that `@civitai/blocks-react`'s DECLARED `@civitai/app-sdk` peer
 * floor is the version that actually supplies every symbol blocks-react
 * imports from the peer.
 *
 * WHY THIS EXISTS. A peer range is metadata: npm/pnpm check it, nothing checks
 * it against the code. blocks-react 0.49.0–0.51.0 declared `>=0.29.0 <1.0.0`
 * while importing `effectiveBrowsingCeiling`, which first exists in app-sdk
 * 0.39.0. The range was SATISFIED, so no install warned; the failure landed at
 * module evaluation in a consumer's test run as
 * `SyntaxError: ... does not provide an export named 'effectiveBrowsingCeiling'`.
 * On one consumer that read as **27 of 43 test files collecting zero tests —
 * 292 tests silently stopped running while the summary line reported no
 * failures**. Filed as #309.
 *
 * 🔴 AND THE NUMBER IN THAT ISSUE WAS ITSELF WRONG, which is the reason this is
 * a script and not a hand-written constant. #309's stated closing condition was
 * "a floor >= 0.39.0". Measured with this probe, blocks-react 0.51.0 at
 * app-sdk 0.39.0 is still missing FOUR symbols — `BlockCreatePostRequest`,
 * `BlockCreatePostResult`, `BlockCreatePostHostError`, `BlockPostSource` — which
 * arrive in 0.40.0. A fix that landed the issue's own number would have
 * satisfied the issue and stayed broken. Do not hand-maintain this floor; run
 * this.
 *
 * WHAT IT DOES. Two arms, because one of them is the other's control:
 *
 *   AT the declared floor F — installs `@civitai/app-sdk@F` into a throwaway
 *   directory, generates a consumer that imports EVERY symbol blocks-react
 *   imports from the peer, and typechecks it. Any `TS2305 has no exported
 *   member` means the declared floor is TOO LOW, and the message names the
 *   symbols. This is the arm that would have caught #309.
 *
 *   BELOW the declared floor (the previous published version) — the same probe
 *   must report AT LEAST ONE missing symbol. This asserts the floor is TIGHT:
 *   it catches a floor pinned higher than the code needs, which costs consumers
 *   an upgrade for nothing.
 *
 * ⚠️ THE BELOW ARM IS NOT THE PROBE'S CONTROL, and an earlier revision of this
 * header said it was. The real control is the synthetic
 * `__ThisSymbolDoesNotExist__` that rides EVERY probe file: it is checked inside
 * each run, at F itself, so a broken harness (bad temp dir, failed install, a
 * tsconfig resolving the workspace copy) fails there and never reaches the below
 * arm at all. The claim mattered because it shaped a FAILURE MESSAGE — the
 * too-high message used to tell the reader their harness might be broken, a
 * state that provably cannot produce it, sending them to debug a fault that does
 * not exist instead of simply lowering the floor.
 *
 * COST / WHEN TO RUN. It performs two real npm installs, so it is NOT part of
 * `pnpm test`. It runs in the nightly `published-starter-smoke` workflow, which
 * already installs from the live registry on purpose and has issue-open-on-fail
 * surfacing. Run it by hand whenever blocks-react starts importing a new symbol
 * from the peer:  `pnpm check:peer-floor`
 *
 * ⚠️ IT SHELLS OUT TO `npm`, NOT `pnpm`, WHICH `CLAUDE.md` OTHERWISE FORBIDS.
 * That is deliberate and matches `scripts/smoke-published-starters.mjs`: the
 * probe must install OUTSIDE this workspace, and pnpm would bring the workspace
 * (and its `overrides`) back into play, resolving `@civitai/app-sdk` to the
 * local copy and measuring nothing.
 *
 * LIMITS, stated plainly:
 *   - It reads `import`/`export … from` clauses and bare side-effect imports of
 *     `@civitai/app-sdk*`. A symbol reached some other way — a `import('…').X`
 *     type reference, a runtime string — is invisible to it.
 *   - It checks resolution and type-vs-value position, NOT shape. A symbol that
 *     exists at F with a different shape than blocks-react expects is caught
 *     only if that difference produces a diagnostic in a consumer that imports
 *     but never exercises it.
 *   - It verifies ONE `>=` endpoint. It refuses a range carrying `||` or a
 *     second `>=` rather than guessing, and it does not check the `<1.0.0`
 *     ceiling.
 *   - It cannot see a HOLE. A symbol present at 0.38.0, absent at 0.39.0 and
 *     back at 0.40.0 makes `>=0.40.0` pass and `>=0.38.0` wrong for a reason
 *     the one-step-down arm cannot express.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PKG_DIR = join(REPO, "packages", "civitai-blocks-react");
const PEER = "@civitai/app-sdk";
const CONTROL_SYMBOL = "__ThisSymbolDoesNotExist__";

/**
 * Resolve the workspace's tsc, PACKAGE-LOCAL FIRST.
 *
 * 🔴 The root `node_modules/.bin` does NOT have one. `typescript` is a
 * devDependency of the individual packages, not of the root, and pnpm's default
 * isolated linker puts only the root's own bins there (`changeset`, and nothing
 * else). An earlier revision of this script hardcoded the root path: it threw
 * ENOENT, `err.stdout`/`err.stderr` are `undefined` for a spawn ENOENT so the
 * captured output was the empty string, the control symbol was therefore absent,
 * and the script exited 1 through the control's own message — naming a
 * type-checking fault rather than a missing binary, AFTER paying for a real
 * registry install. It could not pass on any correct checkout.
 *
 * Same three-tier order as `scripts/typecheck-readme-snippets.mjs`'s `tscBin()`.
 */
export function tscBin() {
  for (const candidate of [
    join(PKG_DIR, "node_modules", ".bin", "tsc"),
    join(REPO, "packages", "civitai-app-sdk", "node_modules", ".bin", "tsc"),
    join(REPO, "node_modules", ".bin", "tsc"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "tsc";
}

/**
 * A refusal, raised rather than `process.exit`-ed.
 *
 * Throwing keeps every verdict reachable from a test in-process (the guard
 * suite asserts on these messages), and it is also what lets a temp dir be
 * cleaned up on the way out — `process.exit` does not unwind the stack, so the
 * old version leaked an npm-installed directory on every failing run.
 */
class PeerFloorError extends Error {}
const fail = (msg) => {
  throw new PeerFloorError(msg);
};

/** Every .ts/.tsx file under a directory. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The named symbols blocks-react imports from the peer, keyed by subpath.
 *
 * Deliberately NOT a regex over the whole file for identifiers: only `import
 * { … } from '<peer…>'` clauses count, so a local name that merely matches is
 * never included.
 */
export function importedSymbols(srcDir = join(PKG_DIR, "src")) {
  const bySubpath = new Map();
  const touch = (subpath) => {
    if (!bySubpath.has(subpath))
      bySubpath.set(subpath, { value: new Set(), type: new Set() });
    return bySubpath.get(subpath);
  };

  // 🔴 `import` AND `export`. A re-export (`export type { X } from '<peer>'`) puts
  // the peer's symbol in THIS package's emitted .d.ts exactly as an import does,
  // so a consumer breaks identically — but an `import`-only pattern cannot see
  // it. Live instance at the time this was written: `src/index.ts` re-exports 11
  // symbols that way, one of which (`AppWorkflowImage`) appears NOWHERE else, so
  // it was missing from the probe's symbol set entirely.
  const clause = new RegExp(
    `(?:import|export)\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"](${PEER}[^'"]*)['"]`,
    "gs",
  );
  // A bare side-effect import names a SUBPATH and no symbols. It still has to
  // resolve, and `src/index.ts` carries one (`import '@civitai/app-sdk/safe-storage'`),
  // so without this the probe never installs or checks that subpath at all.
  const bare = new RegExp(`import\\s*['"](${PEER}[^'"]*)['"]`, "g");

  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const [, clauseIsType, names, subpath] of text.matchAll(clause)) {
      const buckets = touch(subpath);
      for (const raw of names.split(",")) {
        // 🔴 KEEP TYPE-vs-VALUE. The probe reproduces each symbol in the POSITION
        // blocks-react imports it in, so `verbatimModuleSyntax` can do its job:
        // flattening everything to a plain `import { … }` would trip TS1484 on
        // every ordinary type and report the whole surface as missing at every
        // version.
        const isType = Boolean(clauseIsType) || /^\s*type\s+/.test(raw);
        const name = raw
          .replace(/^\s*type\s+/, "")
          .replace(/\s+as\s+[\s\S]*$/, "")
          .trim();
        if (name) buckets[isType ? "type" : "value"].add(name);
      }
    }
    for (const [, subpath] of text.matchAll(bare)) touch(subpath);
  }
  return bySubpath;
}

/** Published versions of the peer, oldest first. */
function publishedVersions() {
  const raw = execFileSync("npm", ["view", PEER, "versions", "--json"], {
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Install the peer at `version` and typecheck a consumer importing every
 * symbol. Returns the symbols the installed copy does NOT export.
 */
function missingSymbolsAt(version, bySubpath) {
  const dir = mkdtempSync(join(tmpdir(), `peer-floor-${version}-`));
  // 🔴 NOT a `finally`. `fail()` calls `process.exit`, which does not unwind the
  // stack, so a `finally` here is skipped on exactly the paths that run most
  // often — and because the ENOENT bug above made EVERY run fail, every run
  // leaked an npm-installed temp dir. Cleanup is explicit before each exit
  // instead, via `bail`.
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const bail = (msg) => {
    cleanup();
    fail(msg);
  };

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "peer-floor-probe", private: true, type: "module" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
        // 🔴 Load-bearing, and it closes the #309 failure mode itself. Without
        // it a TYPE-ONLY export satisfies a plain `import { X }` clause, so a
        // symbol the peer exports only as a type reads as present here while a
        // consumer importing it in value position gets the runtime
        // `SyntaxError: does not provide an export named 'X'`. With it, that
        // case reports TS1484, which is why TS1484 is in the pattern below.
        verbatimModuleSyntax: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  mkdirSync(join(dir, "src"));
  let i = 0;
  for (const [subpath, buckets] of bySubpath) {
    const parts = [];
    // The control rides the VALUE clause: a value import of a missing symbol is
    // the loudest of the two, and every subpath gets one whether or not it has
    // any real value symbols.
    const values = [...buckets.value, CONTROL_SYMBOL];
    parts.push(
      `import {\n${values.map((n) => `  ${n},`).join("\n")}\n} from '${subpath}';`,
    );
    if (buckets.type.size > 0) {
      parts.push(
        `import type {\n${[...buckets.type].map((n) => `  ${n},`).join("\n")}\n} from '${subpath}';`,
      );
    }
    writeFileSync(join(dir, "src", `probe-${i++}.ts`), `${parts.join("\n")}\n`);
  }

  try {
    execFileSync(
      "npm",
      ["install", "--no-audit", "--no-fund", `${PEER}@${version}`],
      {
        cwd: dir,
        stdio: "pipe",
        encoding: "utf8",
      },
    );
  } catch (err) {
    // `--silent` used to be passed here, which muted npm's own diagnosis and
    // left "Command failed: npm install …" as the entire error. Keep npm's
    // stderr — a 404, an ECONNREFUSED and a full disk are different problems.
    bail(
      `npm could not install ${PEER}@${version}:\n\n${(
        err.stderr ||
        err.stdout ||
        err.message
      )
        .toString()
        .trim()}`,
    );
  }

  const installed = JSON.parse(
    readFileSync(
      join(dir, "node_modules", ...PEER.split("/"), "package.json"),
      "utf8",
    ),
  ).version;
  if (installed !== version) {
    bail(
      `asked for ${PEER}@${version} but got ${installed} — the probe measured the wrong thing`,
    );
  }

  const tsc = tscBin();
  let output = "";
  try {
    execFileSync(tsc, ["-p", "tsconfig.json", "--pretty", "false"], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (err) {
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    // A spawn failure yields undefined stdout/stderr, so `output` would be ''
    // and every downstream test would read it as "no diagnostics". Say so.
    if (err.code === "ENOENT") {
      bail(
        `could not execute tsc at ${tsc} — resolve it before trusting any verdict from this run`,
      );
    }
  }

  // An UNRESOLVABLE SUBPATH is a real finding about the version, not a harness
  // fault — it reports TS2307 rather than "has no exported member", so without
  // this it would fall through to the control check and be misreported as a
  // broken probe.
  const unresolved = [...output.matchAll(/Cannot find module '([^']+)'/g)].map(
    (m) => m[1],
  );
  if (unresolved.length > 0) {
    // Return BEFORE the control check. An unresolvable module suppresses the
    // control's own diagnostic for that file, so leaving this below would
    // misreport a genuine "this version lacks the subpath" as a broken harness.
    cleanup();
    return [...new Set(unresolved)].map(
      (u) => `${u} (subpath does not resolve)`,
    );
  }

  const missing = [
    ...output.matchAll(/has no exported member '([^']+)'/g),
    // TS1484: exists, but as a type only — see verbatimModuleSyntax above.
    ...output.matchAll(
      /'([^']+)' is a type and must be imported using a type-only import/g,
    ),
  ].map((m) => m[1]);

  if (!missing.includes(CONTROL_SYMBOL)) {
    bail(
      `the synthetic control symbol did not report at ${PEER}@${version}. The probe is not ` +
        `type-checking anything, so its verdict is about the harness, not the package.\n\n${output}`,
    );
  }
  cleanup();
  return missing.filter((m) => m !== CONTROL_SYMBOL);
}

// ---------------------------------------------------------------------------

/**
 * The single `>=` floor of a declared peer range, or `fail()` with why not.
 *
 * Exported and pure so `tests/guards/check-peer-floor.test.mjs` can exercise it
 * without a network call — these are the parses that have actually been wrong.
 */
export function parseFloor(declared) {
  // 🔴 REFUSE A COMPOUND RANGE rather than reading its first `>=`. A plain
  // `.match()` returns the FIRST hit, not the minimum, so
  // `">=0.40.0 <0.41.0 || >=0.29.0 <0.30.0"` reported floor 0.40.0 and exited 0
  // — a clean PASS for a range that still admits the 0.29.x versions #309 was
  // about. This script validates ONE endpoint token; a union of ranges is not
  // something it can reason about, so it says so instead of guessing.
  if (declared.includes("||")) {
    fail(
      `the declared range "${declared}" has alternatives (\`||\`). This check validates a single\n` +
        `  \`>=\` floor and cannot reason about a union of ranges — express the peer as one range,\n` +
        `  or extend this script deliberately.`,
    );
  }
  const floorMatches = [...declared.matchAll(/>=\s*(\d+\.\d+\.\d+)/g)];
  if (floorMatches.length === 0) {
    fail(`cannot read a >= floor out of the declared range "${declared}"`);
  }
  if (floorMatches.length > 1) {
    fail(
      `the declared range "${declared}" names more than one \`>=\` floor — ambiguous, refusing.`,
    );
  }
  return floorMatches[0][1];
}

export function main() {
  const declared = JSON.parse(
    readFileSync(join(PKG_DIR, "package.json"), "utf8"),
  ).peerDependencies?.[PEER];
  if (!declared)
    fail(`packages/civitai-blocks-react declares no ${PEER} peer range`);

  // 🔴 REFUSE A COMPOUND RANGE rather than reading its first `>=`. `match` returns
  // the FIRST hit, not the minimum, so `">=0.40.0 <0.41.0 || >=0.29.0 <0.30.0"`
  // reported floor 0.40.0 and exited 0 — a clean PASS for a range that still
  // admits the 0.29.x versions #309 was about. This script validates ONE endpoint
  // token; a range with alternatives is not a thing it can reason about, so it
  // says so instead of guessing.
  const floor = parseFloor(declared);

  const bySubpath = importedSymbols();
  const total = [...bySubpath.values()].reduce(
    (n, b) => n + b.value.size + b.type.size,
    0,
  );
  if (total === 0)
    fail(
      `found no named imports from ${PEER} in blocks-react's src — probe is blind`,
    );
  console.log(
    `blocks-react imports ${total} symbol(s) from ${PEER} across ${bySubpath.size} subpath(s)`,
  );
  console.log(`declared peer range: ${declared}  (floor ${floor})`);

  const versions = publishedVersions();
  if (!versions.includes(floor))
    fail(`declared floor ${floor} is not a published version of ${PEER}`);
  const below = versions.filter((v) => compareSemver(v, floor) < 0).pop();

  const missingAtFloor = missingSymbolsAt(floor, bySubpath);
  if (missingAtFloor.length > 0) {
    fail(
      `THE DECLARED FLOOR IS TOO LOW.\n\n` +
        `  ${PEER}@${floor} does not export ${missingAtFloor.length} symbol(s) blocks-react imports:\n` +
        missingAtFloor.map((m) => `    - ${m}`).join("\n") +
        `\n\n  A consumer whose app-sdk satisfies this range still fails at module evaluation,\n` +
        `  and the install warns about nothing. Raise the floor in\n` +
        `  packages/civitai-blocks-react/package.json until this check passes.`,
    );
  }
  console.log(`✓ ${PEER}@${floor} exports every imported symbol`);

  if (!below) {
    console.log(
      `(no published version below ${floor} — skipping the too-high control)`,
    );
  } else {
    const missingBelow = missingSymbolsAt(below, bySubpath);
    if (missingBelow.length === 0) {
      fail(
        `THE DECLARED FLOOR IS HIGHER THAN IT NEEDS TO BE.\n\n` +
          `  ${PEER}@${below} — the published version immediately below the declared floor —\n` +
          `  already exports every symbol blocks-react imports, so the floor excludes a version\n` +
          `  that would have worked and costs consumers an upgrade for nothing.\n\n` +
          `  Lower the floor to ${below} and re-run. This is a TIGHTNESS failure, not a harness\n` +
          `  fault — a broken harness fails at the floor arm above, through the control symbol,\n` +
          `  and never reaches this branch.`,
      );
    }
    console.log(
      `✓ ${PEER}@${below} (below the floor) is missing ${missingBelow.length} symbol(s) — ` +
        `floor is not too high, and the probe demonstrably reports`,
    );
  }

  console.log(
    `\n✅ peer floor ${floor} is correct for blocks-react ${JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")).version}`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    if (err instanceof PeerFloorError) {
      console.error(`\n❌ ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
