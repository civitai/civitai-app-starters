/**
 * The `dev:live` check of a `TRACK_EVENT` against the manifest's
 * `analytics.events` declaration.
 *
 * Production stores an event only when the APPROVED manifest declares it, and
 * keeps only the declared properties whose value has the declared type. An
 * undeclared event is counted as a drop and its name is not stored; an
 * undeclared property, or a value of the wrong type, is dropped from the row.
 * None of that reaches the block: `TRACK_EVENT` is fire-and-forget, so a typo
 * in an event name is invisible until an owner wonders why the analytics panel
 * is empty. This check makes the same three decisions locally and returns one
 * actionable message per DISTINCT problem, so the console says it once.
 *
 * It is a dev aid, not the contract. The server is authoritative, and the
 * dev server's manifest validation (the schema) is what reports a malformed
 * declaration in detail; this reader only needs enough structure to look a
 * name up.
 *
 * Total: never throws, whatever the manifest or the payload holds.
 */

type DeclaredProperty =
  | { type: 'enum'; values: ReadonlySet<string> }
  | { type: 'number' }
  | { type: 'boolean' };

/**
 * Event name → property name → declaration. `Map`s, not plain objects: a
 * lookup of an undeclared `constructor` on a plain object returns
 * `Object.prototype.constructor`, which would read as declared.
 */
type Declarations = ReadonlyMap<string, ReadonlyMap<string, DeclaredProperty>>;

/** Where every message points the author. */
const WHERE = '`analytics.events` in block.manifest.json';

/** The event/property name rule (the manifest schema's `patternProperties` key). */
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A name or value as it appears in a message: JSON-quoted and bounded. */
function quote(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : String(JSON.stringify(value));
  } catch {
    text = Object.prototype.toString.call(value);
  }
  if (text.length > 80) text = `${text.slice(0, 80)}…`;
  return typeof value === 'string' ? JSON.stringify(text) : text;
}

type ReadResult = { declarations: Declarations; problem?: string };

/** Reads the declaration, or says why it cannot. An unreadable one declares nothing. */
function readDeclarations(manifest: unknown): ReadResult {
  const none: Declarations = new Map();
  if (!isPlainObject(manifest)) return { declarations: none, problem: 'the manifest is not an object' };
  const analytics = manifest.analytics;
  if (analytics === undefined) return { declarations: none };
  if (!isPlainObject(analytics)) return { declarations: none, problem: '`analytics` is not an object' };
  const events = analytics.events;
  if (events === undefined) return { declarations: none };
  if (!isPlainObject(events)) return { declarations: none, problem: '`analytics.events` is not an object' };

  const out = new Map<string, Map<string, DeclaredProperty>>();
  for (const [eventName, rawEvent] of Object.entries(events)) {
    if (!isPlainObject(rawEvent)) {
      return { declarations: none, problem: `event ${quote(eventName)} is not an object` };
    }
    const props = new Map<string, DeclaredProperty>();
    const rawProps = rawEvent.properties;
    if (rawProps !== undefined && !isPlainObject(rawProps)) {
      return { declarations: none, problem: `${quote(eventName)}.properties is not an object` };
    }
    for (const [propName, rawProp] of Object.entries(rawProps ?? {})) {
      const at = `${quote(eventName)}.properties.${propName}`;
      if (!isPlainObject(rawProp)) return { declarations: none, problem: `${at} is not an object` };
      if (rawProp.type === 'number' || rawProp.type === 'boolean') {
        props.set(propName, { type: rawProp.type });
      } else if (rawProp.type === 'enum') {
        const values = rawProp.values;
        if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
          return { declarations: none, problem: `${at}.values is not an array of strings` };
        }
        props.set(propName, { type: 'enum', values: new Set(values as string[]) });
      } else {
        return {
          declarations: none,
          problem: `${at}.type is ${quote(rawProp.type)}, not one of enum, number, boolean`,
        };
      }
    }
    out.set(eventName, props);
  }
  return { declarations: out };
}

/** What a declared property accepts, for a message. */
function describeDeclared(prop: DeclaredProperty): string {
  if (prop.type === 'enum') return `one of ${[...prop.values].map((v) => quote(v)).join(', ')}`;
  return prop.type === 'number' ? 'a finite number' : 'a boolean';
}

/** Whether production keeps `value` for `prop` (mirrors the ingest's classification). */
function accepts(prop: DeclaredProperty, value: unknown): boolean {
  if (prop.type === 'enum') return typeof value === 'string' && prop.values.has(value);
  if (prop.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}

export interface TrackEventChecker {
  /**
   * The messages for this event that have not been returned before. Empty for a
   * declared, valid event, and for any problem already reported.
   */
  check(payload: unknown): string[];
}

/**
 * @param manifest The app's manifest as the harness imported it
 *   (`import manifest from '../block.manifest.json'`). `undefined` = the harness
 *   passed none, so nothing can be checked; that is said once.
 */
export function createTrackEventChecker(manifest: unknown): TrackEventChecker {
  const reported = new Set<string>();
  const once = (key: string, message: string, out: string[]) => {
    if (reported.has(key)) return;
    reported.add(key);
    out.push(message);
  };

  const hasManifest = manifest !== undefined;
  let read: ReadResult = { declarations: new Map() };
  if (hasManifest) {
    try {
      read = readDeclarations(manifest);
    } catch {
      // Reachable only via a throwing getter or Proxy; an imported JSON file cannot get here.
      read = { declarations: new Map(), problem: 'reading it threw' };
    }
  }
  const { declarations, problem } = read;
  const declaresAny = declarations.size > 0;

  return {
    check(payload) {
      const out: string[] = [];
      try {
        if (!hasManifest) {
          once(
            'no-manifest',
            'TRACK_EVENT is not checked against your manifest: pass `manifest` to createLiveHost ' +
              "(import it from block.manifest.json) to be warned here about events production will drop.",
            out,
          );
          return out;
        }
        if (problem) {
          once(
            'unreadable',
            `${WHERE} could not be read (${problem}). Production accepts events only against a valid ` +
              'declaration, so it would record none of them; the dev server\'s manifest validation names the problem.',
            out,
          );
        }

        const body = isPlainObject(payload) ? payload : {};
        const eventName = body.eventName;
        if (typeof eventName !== 'string') {
          once(
            'bad-name',
            `track() was called with a non-string event name (${quote(eventName)}). Production counts it as a dropped event.`,
            out,
          );
          return out;
        }

        const declaredProps = declarations.get(eventName);
        if (!declaredProps) {
          const hint = NAME_RE.test(eventName)
            ? ''
            : ' (event names are lowercase snake_case: a letter, then up to 63 of a-z, 0-9 or _)';
          const declared = declaresAny || problem ? '' : ' Your manifest declares no events yet.';
          once(
            `event:${eventName}`,
            `track(${quote(eventName)}) is not declared in ${WHERE}${hint}. Production counts it as a dropped ` +
              `event and does not store its name or properties.${declared} Declare it to record it.`,
            out,
          );
          return out;
        }

        const props = body.properties;
        if (props === undefined || props === null) return out;
        if (!isPlainObject(props)) {
          once(
            `props-shape:${eventName}`,
            `track(${quote(eventName)}) was sent properties that are not an object (${quote(props)}). ` +
              'Production keeps none of them.',
            out,
          );
          return out;
        }

        for (const [propName, value] of Object.entries(props)) {
          // JSON drops an `undefined` value, so the host never forwards one.
          if (value === undefined) continue;
          const declared = declaredProps.get(propName);
          if (!declared) {
            once(
              `prop:${eventName}.${propName}`,
              `track(${quote(eventName)}) property ${quote(propName)} is not declared under ` +
                `${quote(eventName)}.properties in ${WHERE}. Production drops it from the event.`,
              out,
            );
            continue;
          }
          if (!accepts(declared, value)) {
            once(
              `value:${eventName}.${propName}`,
              `track(${quote(eventName)}) property ${quote(propName)} is ${quote(value)}, but ${WHERE} ` +
                `declares it as ${declared.type} (${describeDeclared(declared)}). Production drops the value.` +
                (typeof value === 'string' && declared.type === 'enum'
                  ? ' Free-text strings are never stored: only the declared enum values are.'
                  : ''),
              out,
            );
          }
        }
      } catch {
        // A throwing getter or Proxy in a payload. The check is advisory: say nothing.
      }
      return out;
    },
  };
}
