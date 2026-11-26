/**
 * A JSON `Response` for the tests' scripted `fetch` answers. (Its siblings here served the two
 * legacy key/value store fakes, removed with those stores in 0.33.)
 */
export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
