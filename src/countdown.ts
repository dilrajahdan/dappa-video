export type CountdownOptions = {
  /** Whole seconds. Three by default; zero disables the countdown. */
  seconds?: number;
  onTick: (remaining: number) => void;
  onComplete?: () => void;
  signal?: AbortSignal;
};

/**
 * Start only after permissions and preview are ready. The host owns visual/audio cues.
 * Uses elapsed time so delayed timers cannot extend the countdown indefinitely.
 * Cancelling (including effect cleanup) guarantees no subsequent tick or completion.
 */
export function startCountdown(options: CountdownOptions): () => void {
  const seconds = options.seconds ?? 3;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 60) {
    throw new RangeError("Countdown must be a whole number from 0 to 60.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let previous = -1;
  const deadline = performance.now() + seconds * 1000;

  const cancel = (): void => {
    cancelled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  };

  const tick = (): void => {
    if (cancelled) return;
    const milliseconds = Math.max(0, deadline - performance.now());
    const remaining = Math.ceil(milliseconds / 1000);
    if (remaining !== previous) {
      previous = remaining;
      options.onTick(remaining);
    }
    // A tick handler is allowed to abort, including on the final zero.
    if (cancelled) return;
    if (remaining === 0) {
      cancel();
      options.onComplete?.();
      return;
    }
    timer = setTimeout(
      tick,
      Math.max(1, milliseconds - (remaining - 1) * 1000),
    );
  };

  if (options.signal?.aborted) return cancel;
  options.signal?.addEventListener("abort", cancel, { once: true });
  tick();
  return cancel;
}
