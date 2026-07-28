/**
 * A stand-in for a third-party dependency that touches web storage **while the
 * module is evaluating** — the shape that broke a live app.
 *
 * Modelled on Photo Sphere Viewer's touch-support cache, verbatim in form:
 * an `in` check, a bracket read compared against the STRING 'true', and a
 * bracket write. No `try`/`catch` — that is the point. Nothing outside this
 * module can guard it; only a repaired global can save it.
 */

const TOUCH_KEY = 'exampleLib_touchSupport';

const store = globalThis.localStorage as unknown as Record<string, unknown>;

let touchEnabled = false;
if (TOUCH_KEY in store) touchEnabled = store[TOUCH_KEY] === 'true';
store[TOUCH_KEY] = true;

/** Observable proof the module finished evaluating. */
export const state = { touchEnabled, key: TOUCH_KEY };
