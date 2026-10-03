import { describe, expect, it } from 'vitest';

import { decodePanel, encodePanel, sharedPanelOf } from './share.js';
import type { PanelSpec } from './spec.js';

const SPEC: PanelSpec = {
  title: 'Logo maker',
  inputs: {
    brand: { kind: 'text', label: 'Brand', required: true, default: '', maxLen: 500 },
    reference: { kind: 'image' },
  },
  run: { stepType: 'imageGen', input: { prompt: 'logo for {{brand}}', images: ['{{reference}}'] } },
};

describe('shared panels', () => {
  it("travel as the latest version with the author's values, but not the author's files", async () => {
    const shared = sharedPanelOf({ id: 'P1', versions: [{ ...SPEC, title: 'Old' }, SPEC], values: { brand: 'Daily drip', reference: 'up1-1' } });
    const opened = await decodePanel(await encodePanel(shared));
    expect(opened).toEqual({ v: 1, id: 'P1', version: 2, spec: SPEC, values: { brand: 'Daily drip', reference: '' } });
  });

  it('are checked like a panel the assistant wrote, so a broken or tampered link opens nothing', async () => {
    const tampered = await encodePanel({ v: 1, id: 'P1', version: 1, spec: { ...SPEC, run: { stepType: 'imageGen', input: { prompt: '{{brand}} {{secret}}' } } }, values: {} });
    expect(await decodePanel(tampered)).toBeNull();
    expect(await decodePanel('not-a-panel')).toBeNull();
  });
});
