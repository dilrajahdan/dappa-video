# Dappa Video

```text
ActionMode       CargoMode       SGSS
     \               |           /
      +------ @dappa/video ------+
      | Countdown  | Thumbnails |
      | Sound cues | Effect API |
      +------------+------------+
            User's browser
                  |
       Your app handles storage
```

**Build video features once. Reuse them across your apps.**

Small, framework-independent building blocks for browser video. No core runtime dependencies. The optional Vue and React wrappers use your app’s framework. No server, account or API key required for these primitives.

> **Early release, v0.2.5:** animated GIF email previews, poster first, with an optional enlarged camera card. Bring your own UI and upload code; this is not a hosted recorder or video editor.

## Pick your next step

| I want to… | Go here |
|---|---|
| Use it in an app | [5-minute quickstart](docs/quickstart.md) |
| Understand the droplet question | [Where it runs](docs/architecture.md) |
| See what is ready and what comes next | [Roadmap](ROADMAP.md) |
| Add the Vue or React recorder | [Framework wrappers](docs/frameworks.md) |
| Look up a function | [API guide](docs/api.md) |
| Change the library | [Contributing](CONTRIBUTING.md) |

## What you get today

| Feature | Status |
|---|---|
| Cancellable 3–2–1 countdown | Included |
| Countdown beeps and a start cue | Included, browser audio permission applies |
| Smaller JPEG or WebP thumbnails | Included, keeps aspect ratio |
| Optional overlay, such as an email play button | Included as a drawing callback |
| Animated GIF email preview, poster first | Included, no dependencies |
| Worker clock with bounded queued ticks | Included; drawing still runs on the host thread |
| Background-effect plugin interface | Included; the background model is not bundled |
| One-at-a-time asynchronous effect scheduling | Included; connect your own worker |
| Recording session with Vue and React wrappers | Included |
| Ready-made recording UI | Bring your app’s UI |
| Supabase upload adapter | Planned |
| Video transcoding, trimming and transcription | Planned |

## Install a fixed version

0. **Prerequisites:** an existing JavaScript or TypeScript app and [Bun](https://bun.sh). Use browser functions on the client. Camera or screen capture also needs HTTPS or localhost and user permission.
1. **In your app's terminal**, beside its `package.json`, run:

   ```sh
   bun add https://github.com/dilrajahdan/dappa-video/releases/download/v0.2.5/dappa-video-0.2.5.tgz
   ```

2. **In your browser code**, import the part you need:

   ```ts
   import { startCountdown } from "@dappa/video/countdown";
   import { createThumbnail } from "@dappa/video/thumbnail";
   import { createPreviewGif } from "@dappa/video/preview-gif";
   ```

3. **Check in order:** your app's `package.json` contains `@dappa/video`; its build resolves the imports; the [quickstart browser check](docs/quickstart.md#check-it-in-the-browser) shows 3, 2, 1, then GO.

The release contains built JavaScript and TypeScript declarations. No package build runs inside your app. This package is distributed through GitHub Releases, not npm yet. [Bun supports URL-based packages](https://bun.sh/docs/pm/cli/install#non-npm-dependencies).

## Animated email previews

Email clients cannot play video. A looping GIF of the first 2.5 seconds can, and it sits where the still poster was.

```text
 frame 1 (0.6 s)        frames 2 to 26 (10 fps)       loop
+---------------+      +---------------+
|   poster  >   | ---> |  moving   >   | ---> back to frame 1
+---------------+      +---------------+
```

0. **Prerequisites:** the package installed (see above), a decoded `<video>` in the browser, and the poster image you already email.
1. **In your browser code**, after the recording is decoded:

   ```ts
   import { createPreviewGif } from "@dappa/video/preview-gif";

   const gif = await createPreviewGif(video, {
     firstFrame: posterBlob, // the poster.jpg you already send
     drawOverlay: drawPlayButton,
     focus: cameraCard && { rect: cameraCard, radius: 13 }, // screen + camera takes only
   });
   if (gif.ok) await upload("preview.gif", gif.blob);
   else console.warn("Keeping poster.jpg:", gif.reason);
   ```

2. **Check in order:** `gif.ok` is `true`; `gif.bytes` is under 800,000; `gif.steps` lists any size cuts (empty means none were needed); `gif.focused` is `true` when you passed a camera card; the GIF moves when opened in a browser.

**Screen + camera takes.** A small camera card in a corner is only a few percent of the picture, so the GIF reads as a still. Pass the card's rectangle in video pixels as `focus.rect`. After the poster, the card grows over 0.4 s to 35% of the width, bottom-right, with its rounded corners and a soft shadow, and stays above the play-button wash so the face stays bright. Without `focus`, nothing changes.

Defaults: 480 px wide (never enlarged), 10 fps, 256 colours, no dithering so faces stay clean, 800 KB budget. Over budget, it drops frames, then width, then colours, and reports each step. It never throws. A failure returns `{ ok: false, reason }` and you keep the still poster.

**Honest note:** Outlook desktop shows frame 1 only. Pass the poster you already produced as `firstFrame` (a Blob or a decoded image). It is drawn as-is, with no second overlay and no focus, so Outlook shows the same picture as before. It is reduced to a 256-colour GIF frame, so it matches closely, not byte for byte. Encoding runs on the page's main thread, about 0.8 s for the default size in Chrome.

## Do we put it on the BBL apps droplet?

**Not for this release. Install it into each app.**

The library runs inside that app's browser bundle. Your existing app continues handling login, recording permissions, uploads and Supabase access.

Clone this repository when you want to **develop the library**. Install a release when you want to **use the library**. Each app pins its own version, so a library release cannot silently change every app.

Later, the droplet could host a separate worker for heavy transcoding or transcription. That worker would need a queue, resource limits and app authentication. It is not part of v0.2.0, and no droplet capacity assessment has been made. [See the diagram](docs/architecture.md).

## Background images stay possible

ActionMode can keep its existing background implementation behind the plugin interface. A future worker implementation can replace it. This release does **not** claim to fix dropped frames or include a background-removal model.

## Open source

[MIT licensed](LICENSE). Built from our own video primitives. Cap informed the architecture discussion; no Cap source code is included. [Source and dependency notes](THIRD_PARTY.md).
