export interface DownloadRequest {
  /** An own-output URL. The host allowlists the origin it will fetch. */
  url: string;
  filename?: string;
}

export type MediaRequests = {
  SAVE_IMAGE: { params: DownloadRequest; result: { ok?: boolean } };
};
