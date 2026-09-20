# Vue and React wrappers

```text
Your UI -> useVideoRecorder -> shared controller
                                 |
Permission -> 3 -> 2 -> 1 -> recording -> review
                     Cancel     Stop      Upload in your app
```

Both wrappers expose `state`, `start`, `stop`, `pause`, `resume` and `reset`. Options are fixed for the component's lifetime. Unmount releases active capture and preview URLs. Save or upload the Blob before leaving if you need to keep it.

## Vue 3 / Nuxt

0. Prerequisites: install the v0.2.4 archive from the README in an app using Vue 3.3 or later.
1. In a component's `<script setup>`, add:

   ```ts
   import { useVideoRecorder } from '@dappa/video/vue'

   const { state, start, stop, reset } = useVideoRecorder({
     countdownSeconds: 3,
     audioCues: true,
     maxDurationSeconds: 180,
   })
   function record() {
     return start(() => navigator.mediaDevices.getDisplayMedia({
       video: true, audio: false,
     }))
   }
   ```

2. Call `record()` from your Record button, `stop()` from Stop or Cancel countdown, and `reset()` from Discard. In the template use `state.status`, `state.countdown` and `state.previewUrl`. In script use `state.value`.
3. Check in the browser: Record opens the screen picker; accepting it shows countdown then recording; Stop produces a playable `state.previewUrl`. On unsupported devices, keep a visible text/screenshot fallback in your app.

## React / Next.js

0. Prerequisites: the package and React 18 or 19. In Next.js, place this inside a client component.
1. In your component, add:

   ```tsx
   'use client'
   import { useVideoRecorder } from '@dappa/video/react'

   export function Recorder() {
     const { state, start, stop } = useVideoRecorder()
     const active = ['acquiring', 'countdown', 'recording', 'paused', 'stopping'].includes(state.status)
     return <>
       <output aria-live="polite">{state.status} {state.countdown || ''}</output>
       <button disabled={active} onClick={() => start(() =>
         navigator.mediaDevices.getUserMedia({ video: true, audio: true })
       )}>Record</button>
       <button disabled={!active} onClick={stop}>Stop / cancel</button>
       {state.previewUrl && <video src={state.previewUrl} controls />}
       {state.error && <p role="alert">{state.error}</p>}
     </>
   }
   ```

2. Check in the browser: grant permission, watch 3-2-1, stop and play the result. Navigate away while counting down and confirm the capture indicator stops. The hook also handles React StrictMode cleanup.

## State and ownership

- Status: `idle`, `acquiring`, `countdown`, `recording`, `paused`, `stopping`, `ready` or `error`.
- Snapshot includes countdown, active duration in seconds, exact `activeMilliseconds`, `canPause`, Blob, preview URL, actual MIME type and error text.
- `pause()` and `resume()` return `true` when they acted. A browser without pause support, or a recorder the browser already ended, is left alone rather than failed.
- Options: `countdownSeconds`, `audioCues`, `maxDurationSeconds`, `videoBitsPerSecond`, `audioBitsPerSecond` (omitted leaves the browser default) and `mimeTypes`.
- `onTake(take)` fires once per finished take with bytes: after a normal stop, and when `reset()` or an unmount interrupts an active recording. Stash durable takes there; the snapshot never shows an interrupted take.
- `start(acquire)` invokes acquisition immediately in the click path. It resolves after acquisition/countdown setup, not after recording finishes. `false` means it did not start that attempt.
- The controller owns all tracks returned by `acquire`, including a result arriving after cancellation. Return only streams it is allowed to stop.
- `stop()` cancels acquisition/countdown or finalises recording. `reset()` discards it. Do not upload before status is `ready`.
- A failed or cancelled replacement attempt preserves the previous take. Starting the replacement recording releases the previous preview.
- Use `state.blob.type` to choose upload MIME type and extension. Do not always label files WebM.
- Chunks are held in memory until Stop. Capture-time recovery, uploads and effect-model management are not included.

Core-only users can import `createRecorder` from `@dappa/video/recorder`, subscribe to immutable snapshots and call `destroy()` on teardown. Framework peers are optional and do not load when using core imports.

Implementation references: [React external-store lifecycle](https://react.dev/reference/react/useSyncExternalStore), [Vue scope disposal](https://vuejs.org/api/reactivity-advanced.html#onscopedispose).
