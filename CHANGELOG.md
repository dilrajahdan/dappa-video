# Changelog

## 0.2.4, 2026-09-21

While recording, the snapshot updates once per whole second instead of on every 200ms tick, so a host renders once a second. Pause and stop still carry exact active milliseconds.

## 0.2.3, 2026-09-21

The duration clock re-arms on resume, aligned to that moment, so whole seconds render on time after a pause. Pausing stops the clock instead of leaving it ticking idle.

## 0.2.2, 2026-09-21

The snapshot reports `canPause` for the current take. `pause()` and `resume()` return whether they acted, skip a browser without pause support and skip a recorder the browser has already ended instead of failing the take.

## 0.2.1, 2026-09-21

Recorder options gain `audioBitsPerSecond` and `onTake`. The snapshot carries exact `activeMilliseconds` next to floored seconds. `onTake` also receives the bytes of a recording that `reset()` or an unmount interrupted, so a host can keep the take durable without a second recorder. The active clock uses `Date.now()`.

## 0.2.0, 2026-09-19

Shared recording session with React and Vue wrappers, cancellable countdown, optional audio cues, pause/resume, active-time duration, configured time limit, MIME selection, preview URLs and cleanup. Both wrappers are verified in Chrome against an installed release archive. Uploads, durable chunks and background inference remain app-owned or future work.

## 0.1.0, 2026-09-19

First standalone release of the shared video primitives: countdown, audio cues, thumbnail encoding, worker clock, optional effect lifecycle and bounded asynchronous frame scheduling.

Includes built JavaScript, TypeScript declarations, short guides and a clean-consumer browser check. No complete recorder, upload adapter, background model or transcoder is included yet.
