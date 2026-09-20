// NEGATIVE CONTROL. Every marked line below MUST produce a type error. If this
// file ever compiles clean, the JSX augmentation is not being applied and
// `ok.tsx` passing proves nothing.
// (This header deliberately does not spell the marker token — types.test.ts
// finds markers by scanning for it, and a mention here would add a phantom
// expectation on line 2. That exact false positive happened once.)
import '../../src/index.js';

export function Bad(): React.JSX.Element {
  return (
    <>
      {/* @expect-error variant is a closed union */}
      <civitai-button variant="ghost" />

      {/* @expect-error loading is a boolean */}
      <civitai-button loading="yes" />

      {/* @expect-error options must be SelectOption[], not a string */}
      <civitai-select options="euler,dpmpp2m" />

      {/* @expect-error the camelCase spelling receives a SyntheticEvent with no `detail` */}
      <civitai-select onChange={(e) => void e.detail} />

      {/* @expect-error min is a number */}
      <civitai-slider min="one" />

      {/* @expect-error validity is getter-only and not part of the JSX surface */}
      <civitai-slider validity={null} />

      {/* @expect-error no such element */}
      <civitai-accordion />
    </>
  );
}
