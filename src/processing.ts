/** Storage credentials and business records never belong in a processing request. */
export type MediaSource = {
  blob: Blob;
  durationSeconds: number;
  width: number;
  height: number;
};

export type ProcessingRequest = {
  source: MediaSource;
  trim?: { startSeconds: number; endSeconds: number };
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};

export type ProcessingResult = {
  media: MediaSource;
  operation: "passthrough" | "remux" | "transcode";
};

/** Optional backend. A worker implementation must inspect codecs, not just file extensions. */
export interface MediaProcessor {
  supports: (request: ProcessingRequest) => Promise<boolean>;
  process: (request: ProcessingRequest) => Promise<ProcessingResult>;
}
