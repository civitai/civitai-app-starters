import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES,
  BLOCK_INLINE_COMFY_MAX_NODES,
  checkComfyGraph,
  COMFY_CORE_NODE_CLASSES,
  COMFY_CORE_NODES_COMMIT,
  COMFY_FRONTEND_ONLY_NODE_CLASSES,
} from '../../src/blocks/index.js';
import type { BlockResourceFileEntry } from '../../src/blocks/index.js';
import { collectCoreNodes, collectModelExtensions, COMFYUI_COMMIT } from '../../scripts/gen-comfy-core-nodes.mjs';

/**
 * `checkComfyGraph` — one fixture per reason code, each built so that code is
 * the ONLY one that fires. Deleting one check therefore turns its own "alone"
 * tests red, plus the two composite tests that name it on purpose: the
 * realistic UI fixture (not-api-format, custom-nodes) and the all-reasons
 * ordering test. Expected values are literals, never recomputed from the code.
 */

// Public huggingface AIRs, the shape civitai's starter-comfy-txt2img recipe puts
// in its loader inputs. They END in `.safetensors`, so they also pin that an AIR
// is never mistaken for a filename.
const UNET_AIR =
  'urn:air:zimageturbo:diffusion_model:huggingface:Comfy-Org/z_image_turbo@main/split_files/diffusion_models/z_image_turbo_bf16.safetensors';
const CLIP_AIR =
  'urn:air:qwen:clip:huggingface:Comfy-Org/z_image_turbo@main/split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors';
const VAE_AIR = 'urn:air:flux1:vae:huggingface:black-forest-labs/FLUX.1-dev@main/ae.safetensors';

type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

/** A core-only API graph naming every model by AIR: runnable. */
function coreAirGraph(): ApiGraph {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: UNET_AIR, weight_dtype: 'default' } },
    '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '3': { class_type: 'CLIPLoader', inputs: { clip_name: CLIP_AIR, type: 'lumina2', device: 'default' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: 'a mountain at dawn' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: '' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: VAE_AIR } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['7', 0],
        seed: 42,
        steps: 4,
        cfg: 1,
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['6', 0] } },
    // A non-model input holding a model-looking string is NOT a loader input.
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'out.safetensors' } },
  };
}

const api = (graph: unknown): BlockResourceFileEntry => ({ path: 'workflow_api.json', format: 'api', graph });

/** `n` small core nodes. */
function nodes(n: number): ApiGraph {
  const g: ApiGraph = {};
  for (let i = 1; i <= n; i++) g[String(i)] = { class_type: 'PrimitiveInt', inputs: { value: i } };
  return g;
}

/** One core node whose serialized wire length is exactly `length`. */
function graphOfLength(length: number): ApiGraph {
  const shell = JSON.stringify({ '1': { class_type: 'PrimitiveString', inputs: { value: '' } } }).length;
  return { '1': { class_type: 'PrimitiveString', inputs: { value: 'x'.repeat(length - shell) } } };
}

/**
 * A small, synthetic UI (editor) graph in the shape ComfyUI saves: a `nodes`
 * array whose entries carry `type` and `properties.cnr_id`, links, and one
 * subgraph whose definition holds its own nodes.
 */
const SUBGRAPH_ID = '7f0c4f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
const UI_GRAPH = {
  id: 'b1c2d3e4-0000-4000-8000-000000000001',
  revision: 0,
  last_node_id: 9,
  last_link_id: 6,
  nodes: [
    {
      id: 1,
      type: 'CheckpointLoaderSimple',
      pos: [0, 0],
      size: [315, 98],
      inputs: [],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
      properties: { cnr_id: 'comfy-core', ver: '0.3.40', 'Node name for S&R': 'CheckpointLoaderSimple' },
      widgets_values: ['sd_xl_base_1.0.safetensors'],
    },
    {
      id: 2,
      type: 'KSampler',
      pos: [400, 0],
      size: [315, 262],
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [2] }],
      properties: { cnr_id: 'comfy-core', ver: '0.3.40' },
      widgets_values: [42, 'randomize', 20, 7, 'euler', 'normal', 1],
    },
    {
      id: 3,
      type: 'ImageResizeKJv2',
      pos: [800, 0],
      size: [270, 200],
      inputs: [],
      outputs: [],
      properties: { cnr_id: 'comfyui-kjnodes', ver: '1.1.0' },
      widgets_values: [1024, 1024, 'lanczos'],
    },
    // A custom node from a file that predates `cnr_id`: listed, no pack.
    { id: 4, type: 'SomeLegacyCustomNode', pos: [0, 300], size: [200, 80], properties: {}, widgets_values: [] },
    { id: 5, type: 'Note', pos: [0, 500], size: [300, 100], properties: {}, widgets_values: ['read me'] },
    { id: 6, type: 'Reroute', pos: [300, 500], size: [75, 26], properties: { showOutputText: false } },
    // A subgraph instance: its `type` is the definition's id, not a class.
    { id: 7, type: SUBGRAPH_ID, pos: [600, 500], size: [200, 100], properties: {} },
  ],
  links: [
    [1, 1, 0, 2, 0, 'MODEL'],
    [2, 2, 0, 7, 0, 'LATENT'],
  ],
  groups: [],
  definitions: {
    subgraphs: [
      {
        id: SUBGRAPH_ID,
        name: 'Upscale',
        nodes: [
          { id: 1, type: 'VAEDecode', properties: { cnr_id: 'comfy-core' } },
          { id: 2, type: 'Fast Groups Bypasser (rgthree)', properties: { cnr_id: 'rgthree-comfy' } },
          { id: 3, type: 'ImageResizeKJv2', properties: { cnr_id: 'comfyui-kjnodes' } },
        ],
      },
    ],
  },
  config: {},
  extra: { ds: { scale: 1, offset: [0, 0] } },
  version: 0.4,
};

describe('checkComfyGraph', () => {
  it('a core API graph that names its models by AIR is runnable', () => {
    expect(checkComfyGraph(api(coreAirGraph()))).toEqual({ runnable: true });
  });

  describe('not-api-format', () => {
    it('fires alone for an unknown entry', () => {
      expect(checkComfyGraph({ format: 'unknown', graph: { hello: 'world' } })).toEqual({
        runnable: false,
        reasons: [{ code: 'not-api-format', format: 'unknown' }],
      });
    });

    it('fires alone for a UI graph whose nodes are all core or frontend-only', () => {
      const graph = {
        nodes: [
          { id: 1, type: 'KSampler', properties: { cnr_id: 'comfy-core' } },
          ...COMFY_FRONTEND_ONLY_NODE_CLASSES.map((type, i) => ({ id: i + 2, type, properties: {} })),
        ],
      };
      expect(checkComfyGraph({ format: 'ui', graph })).toEqual({
        runnable: false,
        reasons: [{ code: 'not-api-format', format: 'ui' }],
      });
    });

    it('takes a stated ui format at its word, even over an API-shaped graph', () => {
      expect(checkComfyGraph({ format: 'ui', graph: coreAirGraph() })).toEqual({
        runnable: false,
        reasons: [{ code: 'not-api-format', format: 'ui' }],
      });
    });

    it('does not trust a format of api over a graph that is not one', () => {
      expect(checkComfyGraph({ format: 'api', graph: { '1': { class_type: 'KSampler' } } })).toEqual({
        runnable: false,
        reasons: [{ code: 'not-api-format', format: 'unknown' }],
      });
    });
  });

  it('a realistic UI graph: not-api-format plus the custom classes and their packs, subgraphs included', () => {
    expect(checkComfyGraph({ path: 'workflow.json', format: 'ui', graph: UI_GRAPH })).toEqual({
      runnable: false,
      reasons: [
        { code: 'not-api-format', format: 'ui' },
        {
          code: 'custom-nodes',
          classes: ['Fast Groups Bypasser (rgthree)', 'ImageResizeKJv2', 'SomeLegacyCustomNode'],
          packs: ['comfyui-kjnodes', 'rgthree-comfy'],
        },
      ],
    });
  });

  describe('custom-nodes', () => {
    it('fires alone for an API graph with a class outside the core list', () => {
      const graph = coreAirGraph();
      graph['11'] = { class_type: 'ImageResizeKJv2', inputs: { image: ['9', 0], width: 512, height: 512 } };
      expect(checkComfyGraph(api(graph))).toEqual({
        runnable: false,
        reasons: [{ code: 'custom-nodes', classes: ['ImageResizeKJv2'], packs: [] }],
      });
    });

    it('counts a frontend-only class as custom in an API graph (ComfyUI cannot run it)', () => {
      const graph = coreAirGraph();
      graph['11'] = { class_type: 'Note', inputs: {} };
      expect(checkComfyGraph(api(graph))).toEqual({
        runnable: false,
        reasons: [{ code: 'custom-nodes', classes: ['Note'], packs: [] }],
      });
    });
  });

  describe('model-filenames', () => {
    it('fires alone for loader inputs holding a filename, and only for those', () => {
      const graph = coreAirGraph();
      graph['1']!.inputs.unet_name = 'z_image_turbo_bf16.safetensors';
      graph['11'] = {
        class_type: 'LoraLoader',
        inputs: { model: ['1', 0], clip: ['3', 0], lora_name: 'styles/Detail.GGUF', strength_model: 1, strength_clip: 1 },
      };
      // A non-loader input holding a model-looking value is not flagged.
      graph['3']!.inputs.type = 'model.safetensors';
      expect(checkComfyGraph(api(graph))).toEqual({
        runnable: false,
        reasons: [
          {
            code: 'model-filenames',
            inputs: [
              { nodeId: '1', classType: 'UNETLoader', input: 'unet_name', value: 'z_image_turbo_bf16.safetensors' },
              { nodeId: '11', classType: 'LoraLoader', input: 'lora_name', value: 'styles/Detail.GGUF' },
            ],
          },
        ],
      });
    });

    it('treats a checkpoint filename from the ComfyUI list (.ckpt) as a filename', () => {
      const graph = coreAirGraph();
      graph['6']!.inputs.vae_name = 'sdxl_vae.ckpt';
      expect(checkComfyGraph(api(graph))).toEqual({
        runnable: false,
        reasons: [
          {
            code: 'model-filenames',
            inputs: [{ nodeId: '6', classType: 'VAELoader', input: 'vae_name', value: 'sdxl_vae.ckpt' }],
          },
        ],
      });
    });
  });

  describe('too-many-nodes', () => {
    it('passes at exactly 300 nodes', () => {
      expect(BLOCK_INLINE_COMFY_MAX_NODES).toBe(300);
      expect(checkComfyGraph(api(nodes(300)))).toEqual({ runnable: true });
    });

    it('fires alone at 301 nodes', () => {
      expect(checkComfyGraph(api(nodes(301)))).toEqual({
        runnable: false,
        reasons: [{ code: 'too-many-nodes', nodes: 301, max: 300 }],
      });
    });
  });

  describe('too-large', () => {
    it('passes at exactly the cap', () => {
      expect(BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES).toBe(262144);
      const graph = graphOfLength(262144);
      expect(JSON.stringify(graph).length).toBe(262144);
      expect(checkComfyGraph(api(graph))).toEqual({ runnable: true });
    });

    it('fires alone one byte over the cap', () => {
      expect(checkComfyGraph(api(graphOfLength(262145)))).toEqual({
        runnable: false,
        reasons: [{ code: 'too-large', bytes: 262145, max: 262144 }],
      });
    });

    it('measures the graph as sent: per-node extras such as _meta are not counted', () => {
      const graph = graphOfLength(262144);
      graph['1']!._meta = { title: 'a title the wire never carries' };
      expect(checkComfyGraph(api(graph))).toEqual({ runnable: true });
    });
  });

  it('reports every reason that applies, in the documented order', () => {
    const graph = nodes(301);
    graph['1'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } };
    graph['2'] = { class_type: 'ImageResizeKJv2', inputs: { pad: 'x'.repeat(262144) } };
    const result = checkComfyGraph(api(graph));
    expect(result.runnable === false && result.reasons.map((r) => r.code)).toEqual([
      'custom-nodes',
      'model-filenames',
      'too-many-nodes',
      'too-large',
    ]);
  });

  it('does not mutate its input', () => {
    const graph = coreAirGraph();
    const before = JSON.stringify(graph);
    checkComfyGraph(api(graph));
    checkComfyGraph({ format: 'ui', graph: UI_GRAPH });
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe('the generated core-node list', () => {
  it('records the ComfyUI commit the generator pins', () => {
    expect(COMFY_CORE_NODES_COMMIT).toBe(COMFYUI_COMMIT);
    expect(COMFY_CORE_NODES_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is sorted, unique, and holds the classes every txt2img graph uses', () => {
    expect([...COMFY_CORE_NODE_CLASSES].sort()).toEqual(COMFY_CORE_NODE_CLASSES);
    expect(new Set(COMFY_CORE_NODE_CLASSES).size).toBe(COMFY_CORE_NODE_CLASSES.length);
    for (const c of ['CheckpointLoaderSimple', 'KSampler', 'CLIPTextEncode', 'VAEDecode', 'SaveImage']) {
      expect(COMFY_CORE_NODE_CLASSES).toContain(c);
    }
    for (const c of COMFY_FRONTEND_ONLY_NODE_CLASSES) expect(COMFY_CORE_NODE_CLASSES).not.toContain(c);
  });
});

describe('gen-comfy-core-nodes.mjs on a synthetic ComfyUI tree', () => {
  function tree(extras: Record<string, string>, listed: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'comfy-gen-test-'));
    mkdirSync(join(root, 'comfy_extras'));
    writeFileSync(
      join(root, 'nodes.py'),
      [
        'NODE_CLASS_MAPPINGS = {',
        '    "KSampler": KSampler,',
        "    'VAEDecode': VAEDecode,",
        '    # "CommentedOut": CommentedOut,',
        '}',
        'async def init_builtin_extra_nodes():',
        '    extras_files = [',
        ...listed.map((f) => `        "${f}",`),
        '    ]',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'folder_paths.py'),
      "supported_pt_extensions: set[str] = {'.ckpt', '.SafeTensors', '.pt'}\n",
    );
    for (const [name, body] of Object.entries(extras)) writeFileSync(join(root, 'comfy_extras', name), body);
    return root;
  }

  it('reads nodes.py, the LISTED extras (all three registration forms) and nothing unlisted', () => {
    const root = tree(
      {
        'nodes_legacy.py': 'NODE_CLASS_MAPPINGS = {\n    "LegacyNode": LegacyNode,\n}\n',
        'nodes_v3.py': 'class A(io.ComfyNode):\n    def define_schema(cls):\n        return io.Schema(node_id="V3Node", old_node_id="Renamed")\n',
        'nodes_hooks.py': "class H:\n    NodeId = 'HookNode'\n",
        'nodes_replacements.py': 'class E(ComfyExtension):\n    async def get_node_list(self) -> list[type[io.ComfyNode]]:\n        return []\n',
        'nodes_unlisted.py': 'NODE_CLASS_MAPPINGS = {\n    "NotLoaded": NotLoaded,\n}\n',
      },
      ['nodes_legacy.py', 'nodes_v3.py', 'nodes_hooks.py', 'nodes_replacements.py'],
    );
    try {
      expect(collectCoreNodes(root)).toEqual({
        classes: ['HookNode', 'KSampler', 'LegacyNode', 'V3Node', 'VAEDecode'],
        extrasCount: 4,
      });
      expect(collectModelExtensions(root)).toEqual(['.ckpt', '.pt', '.safetensors']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a listed extras module it cannot read a class from', () => {
    const root = tree({ 'nodes_odd.py': 'def something():\n    pass\n' }, ['nodes_odd.py']);
    try {
      expect(() => collectCoreNodes(root)).toThrow('comfy_extras/nodes_odd.py: no node class found');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
