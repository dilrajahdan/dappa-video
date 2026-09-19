/** An optional camera effect supplies a stable output throughout a take. */
export interface CameraEffectSession {
  readonly stream: MediaStream;
  readonly canvas: HTMLCanvasElement;
  pause: () => void;
  resume: () => void;
  /** Idempotent. Release resources owned by the effect, not the caller's camera. */
  destroy: () => void;
}

/** Model, image settings and diagnostics remain specific to the plugin. */
export interface CameraEffectPlugin<
  Options,
  Session extends CameraEffectSession,
> {
  readonly id: string;
  isSupported: () => boolean;
  create: (options: Options) => Session;
}

export type FrameProcessorStats = {
  submitted: number;
  processed: number;
  skipped: number;
  errors: number;
  busy: boolean;
};

export type FrameProcessorOptions<Input, Output> = {
  /** Run expensive inference in a worker. An async wrapper alone does not move CPU work. */
  process: (input: Input, signal: AbortSignal) => Promise<Output>;
  /** Publishes a complete result. It must not mutate a canvas used by an in-flight job. */
  onResult: (output: Output) => void;
  onError?: (error: unknown) => void;
  /** Input ownership transfers on submit, even if the frame is skipped. */
  releaseInput: (input: Input) => void;
  /** The processor releases superseded, cancelled and late results. */
  releaseOutput: (output: Output) => void;
};

export type FrameProcessor<Input> = {
  submit: (input: Input) => boolean;
  pause: () => void;
  resume: () => void;
  destroy: () => void;
  stats: () => FrameProcessorStats;
};

/**
 * Optional effects get one in-flight job and no queued frames. Capture/compositing
 * can keep drawing independently. Slow inference therefore skips effect updates
 * instead of accumulating work. This does not make synchronous inference non-blocking.
 */
export function createFrameProcessor<Input, Output>(
  options: FrameProcessorOptions<Input, Output>,
): FrameProcessor<Input> {
  let alive = true;
  let paused = false;
  let generation = 0;
  let controller: AbortController | null = null;
  let latest: { value: Output } | null = null;
  const stats: FrameProcessorStats = {
    submitted: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    busy: false,
  };

  const invalidate = (): void => {
    generation += 1;
    controller?.abort();
    // Keep busy until the job settles, even if a plugin ignores cancellation.
    // Repeated pause/resume must not create concurrent inference jobs.
    if (latest) {
      const result = latest;
      latest = null;
      options.releaseOutput(result.value);
    }
  };

  return {
    submit(input) {
      stats.submitted += 1;
      if (!alive || paused || stats.busy) {
        stats.skipped += 1;
        options.releaseInput(input);
        return false;
      }
      stats.busy = true;
      const mine = generation;
      const job = new AbortController();
      controller = job;
      void Promise.resolve()
        .then(() => {
          if (job.signal.aborted) throw job.signal.reason;
          return options.process(input, job.signal);
        })
        .then((output) => {
          if (!alive || paused || mine !== generation) {
            options.releaseOutput(output);
            return;
          }
          const old = latest;
          latest = { value: output };
          if (old) options.releaseOutput(old.value);
          stats.processed += 1;
          options.onResult(output);
        })
        .catch((error: unknown) => {
          if (!alive || mine !== generation || job.signal.aborted) return;
          stats.errors += 1;
          options.onError?.(error);
        })
        .finally(() => {
          stats.busy = false;
          controller = null;
          options.releaseInput(input);
        });
      return true;
    },
    pause() {
      if (!alive || paused) return;
      paused = true;
      invalidate();
    },
    resume() {
      if (alive) paused = false;
    },
    destroy() {
      if (!alive) return;
      alive = false;
      invalidate();
    },
    stats: () => ({ ...stats }),
  };
}
