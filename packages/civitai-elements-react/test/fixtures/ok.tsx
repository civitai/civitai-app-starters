// Every usage here MUST typecheck. Compiled by types.test.ts.
import '../../src/index.js';
import type { SelectOption } from '@civitai/elements';

const options: SelectOption[] = [{ value: 'euler', label: 'Euler' }];

export function Ok(): React.JSX.Element {
  return (
    <civitai-stack gap="lg" align="stretch">
      <civitai-select
        name="sampler"
        label="Sampler"
        required
        options={options}
        value="euler"
        onchange={(e) => {
          // The lowercase spelling delivers the real CustomEvent.
          const v: string = e.detail.value;
          void v;
        }}
        onChange={(e) => {
          // The camelCase spelling is a SyntheticEvent — `currentTarget` is
          // the element, so its `value` is typed.
          const v: string = e.currentTarget.value;
          void v;
        }}
      />
      <civitai-slider
        name="cfg"
        min={1}
        max={20}
        value={7}
        showValue
        oninput={(e) => {
          const v: number = e.detail.value;
          void v;
        }}
      />
      <civitai-button variant="outline" size="lg" color="error" loading fullWidth>
        Generate
      </civitai-button>
      {/* A numeric gap is still legal — the blocks-react contract. */}
      <civitai-stack gap={20} />
    </civitai-stack>
  );
}
