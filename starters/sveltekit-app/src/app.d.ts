import type { Session } from '$lib/session';

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
    }
  }
}

export {};
