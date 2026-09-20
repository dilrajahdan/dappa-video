# First win: a countdown

```text
Start -> 3 -> 2 -> 1 -> GO
  |
  +---- cancel() -----> no later callback
```

## Add it to your app

0. **Prerequisites:** Bun, an existing browser app and its terminal. Run this in client code. In React/Next.js use a client component; in Vue/Nuxt run it after mounting or in a click handler. No Supabase account is needed for this check.
1. **Terminal, beside your app's `package.json`:**

   ```sh
   bun add https://github.com/dilrajahdan/dappa-video/releases/download/v0.2.2/dappa-video-0.2.2.tgz
   ```

2. **Your client module:** paste this function and call `tryCountdown()` from an existing button's click handler.

   ```ts
   import { startCountdown } from "@dappa/video/countdown";

   export function tryCountdown() {
     return startCountdown({
       onTick: (seconds) => {
         if (seconds > 0) console.log(seconds);
       },
       onComplete: () => console.log("GO"),
     });
   }
   ```

3. **Your component cleanup:** keep the returned function and call it on discard, navigation or unmount. In React, cancel before starting another countdown and in effect cleanup. In Vue, cancel in `onUnmounted`. A second call starts another countdown unless you cancel the first.

## Check it in the browser

4. **Open your running app, then DevTools > Console.** Click the button once. Passing result: `3`, `2`, `1`, then `GO`, around three seconds after the click.
5. **Check cancellation:** start again and call the returned cancel function before zero. Passing result: no later numbers and no `GO`. An empty console after cancellation is expected.
6. **Check DevTools > Console for errors.** Passing result: no errors attributable to this check. An empty error filter is a pass.

## Use it with your existing recorder

Request media permission and show the preview first. When the user presses Start, run the countdown. Call your existing `MediaRecorder.start()` from `onComplete`.

Prime audio with `primeBeeper()` during the user's click. Call `beepTick()` for 3, 2 and 1, and `beepGo()` at completion if desired. Audio can be unavailable; the visual countdown should still work. Speaker sound can reach the microphone, so do not promise silent recordings.

## Make a smaller thumbnail

0. **Prerequisite:** a decoded `<video>` element, paused on the desired frame. Wait for `loadeddata`, or `seeked` after changing its time. It must have non-zero `videoWidth` and `videoHeight`.
1. **In your save handler:**

   ```ts
   import { createThumbnail } from "@dappa/video/thumbnail";

   const poster = await createThumbnail(videoElement, {
     width: videoElement.videoWidth,
     height: videoElement.videoHeight,
   });
   ```

2. **Preview the result:** use `URL.createObjectURL(poster)` as an image source. Revoke the URL when finished. Passing result: the selected frame, correct proportions, and neither dimension above 1200 pixels.
3. **Store it through your app's current upload code.** This function returns a Blob; it does not upload. Catch errors and keep the source video available for retry. Cross-origin video needs permission to read its pixels.

[Back to README](../README.md) · [All functions](api.md)
