export type HostNotifications = {
  RESIZE_IFRAME: { height: number };
  BLOCK_ERROR: { message: string; fatal: boolean };
  NAVIGATE: { path: string; target: 'current' | 'new_tab' };
};

export type HostPushes = {
  /** The page is hidden; stop timers and polling until `RESUME`. */
  SUSPEND: undefined;
  RESUME: undefined;
};
