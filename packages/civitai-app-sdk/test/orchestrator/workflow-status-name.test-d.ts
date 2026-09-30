/**
 * Behavioural half of `workflow-status-name.test.ts`. The structural test pins
 * the NAMES; this one pins that the renamed type is actually reachable on both
 * surfaces and still admits the orchestrator's wire statuses — a structural
 * check alone type-checks past a type that exists but means nothing.
 *
 * Type-only file. It is compiled by `tsc -p tsconfig.typecheck.json` (which
 * includes `test/**\/*.test-d.ts`), not executed by vitest.
 */
import type { OrchestratorWorkflowStatus as FromRoot } from '../../src/index.js';
import type {
  OrchestratorWorkflowStatus as FromSubpath,
  WorkflowSnapshot,
} from '../../src/orchestrator/index.js';

// Reachable from the package root AND from the `/orchestrator` subpath, and the
// same type on both.
const sameOnBothSurfaces: FromRoot = null as unknown as FromSubpath;
void sameOnBothSurfaces;

// Still admits every status the orchestrator actually returns.
const wire: FromRoot[] = [
  'unassigned',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'canceled',
];
void wire;

// Still open-ended, so an unknown server status does not break typing.
const forwardCompatible: FromRoot = 'some-status-the-server-added-later';
void forwardCompatible;

// `WorkflowSnapshot.status` carries the renamed type.
const snapshotStatus: FromRoot = (null as unknown as WorkflowSnapshot).status;
void snapshotStatus;
