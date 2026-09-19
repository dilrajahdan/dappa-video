# API guide

Import only the module you need. All runtime functions are browser-oriented ESM exports. The package does not depend on React or Vue.

## Countdown

`startCountdown({ seconds?, onTick, onComplete?, signal? })` returns a cancellation function.

- Default: three seconds. Whole numbers from 0 to 60 are accepted.
- `onTick` fires immediately, then when the remaining number changes, including zero.
- Zero seconds completes immediately. Already-aborted signals do nothing.
- Cancel on unmount/discard. There are no callbacks after cancellation.
- Uses elapsed time. A delayed browser timer may skip a displayed number; it does not restart the deadline.

## Audio

From `@dappa/video/beeper`: `primeBeeper()`, `beepTick()` and `beepGo()`.

Prime during a user gesture. Unavailable or blocked Web Audio falls back silently. The library sends tones to the speakers, not directly into your recording stream. A microphone or shared system audio can still capture them.

## Thumbnails

`createThumbnail(source, { width, height }, options?)` returns `Promise<Blob>`.

| Option | Default |
|---|---|
| `maxWidth` / `maxHeight` | 1200 / 1200 |
| `quality` | 0.8, valid range 0 to 1 |
| `type` | `image/jpeg`, or request `image/webp` |
| `drawOverlay(ctx, width, height)` | None |

Source must be a drawable, decoded image/video/canvas. Size is fitted inside the bounds without enlarging. `thumbnailDimensions(width, height, maxWidth?, maxHeight?)` computes the dimensions without encoding. Check the returned Blob's actual MIME type if a browser falls back from the requested encoder.

## Drawing clock

`createTicker(onTick, { backpressure?: boolean }?)` returns `start`, `stop`, `destroy`.

Default is roughly 30 ticks/second, with one unacknowledged worker tick. `onTick` must be synchronous. Drawing still runs on the host thread; this is not an inference worker or a background-frame-rate guarantee. Your Content Security Policy must allow the blob worker, for example through `worker-src blob:` alongside your existing permitted worker sources. Destroy releases the worker and its URL.

## Optional camera effects

`CameraEffectPlugin<Options, Session>` has `id`, `isSupported()` and `create(options)`.

A `CameraEffectSession` supplies a stable `stream` and `canvas`, plus `pause()`, `resume()` and idempotent `destroy()`. Destroy only resources owned by the plugin, not the caller's original camera. App settings, models and failure policy stay in the plugin.

`createFrameProcessor({ process, onResult, onError?, releaseInput, releaseOutput })` returns `submit`, `pause`, `resume`, `destroy` and `stats`.

- One asynchronous job at a time, no queue. Busy inputs are skipped and released.
- Input ownership transfers on submit. Do not release inputs yourself afterward.
- The processor releases superseded, cancelled and late outputs. Do not retain a published output beyond the next publication or release it yourself.
- Pause/destroy abort work and suppress stale results. Resume cannot overlap a still-settling job.
- Callbacks must not throw. Honour cancellation or terminate the underlying worker to free in-flight resources promptly.
- `process` must delegate expensive work to an actual worker. Adding `async` to synchronous inference does not move CPU work.

## Processing contracts

`@dappa/video/processing` exports types only: `MediaSource`, `ProcessingRequest`, `ProcessingResult` and `MediaProcessor`.

These reserve a future interface for passthrough, remuxing, transcoding and trim parameters. No implementation is supplied. Passing trim values alone does not cut a video.
