/** A key list as the inventory declares it: names with `?` stripped, and which of them are optional. */
export interface DeclaredKeys {
  names: string[];
  optional: string[];
}

export interface InventoryMessage {
  request: boolean;
  reply: string;
  replyNote?: string;
  /** What the entry declares. `undefined`: the entry has no such field; `null`: declared null. */
  declared: {
    replyKeys?: DeclaredKeys | null;
    errorKeys?: DeclaredKeys | 'none' | null;
  };
}

export function parseInventory(text: string): Record<string, InventoryMessage>;
