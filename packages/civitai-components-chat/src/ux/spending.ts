export interface Price {
  total: number;
  variable: boolean;
}

/** Whether a generation may start on its own or must wait for the user's click. */
export function decide(price: Price | null, autoRunLimit: number): 'auto' | 'confirm' {
  if (price === null) return autoRunLimit === 0 ? 'confirm' : 'auto';
  if (price.variable) return 'confirm';
  return price.total <= autoRunLimit ? 'auto' : 'confirm';
}
