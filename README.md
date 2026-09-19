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

Small, framework-independent building blocks for browser video. No runtime dependencies. No server, account or API key required for these primitives.

> **Early release, v0.1.0:** countdowns and thumbnails are ready to use. This is not yet a complete recorder, uploader or video editor.

## Pick your next step

| I want to… | Go here |
|---|---|
| Use it in an app | [5-minute quickstart](docs/quickstart.md) |
| Understand the droplet question | [Where it runs](docs/architecture.md) |
| See what is ready and what comes next | [Roadmap](ROADMAP.md) |
| Look up a function | [API guide](docs/api.md) |
| Change the library | [Contributing](CONTRIBUTING.md) |

## What you get today

| Feature | Status |
|---|---|
| Cancellable 3–2–1 countdown | Included |
| Countdown beeps and a start cue | Included, browser audio permission applies |
| Smaller JPEG or WebP thumbnails | Included, keeps aspect ratio |
| Optional overlay, such as an email play button | Included as a drawing callback |
| Worker clock with bounded queued ticks | Included; drawing still runs on the host thread |
| Background-effect plugin interface | Included; the background model is not bundled |
| One-at-a-time asynchronous effect scheduling | Included; connect your own worker |
| Complete recording UI and session lifecycle | Planned |
| Supabase upload adapter | Planned |
| Video transcoding, trimming and transcription | Planned |

## Install a fixed version

0. **Prerequisites:** an existing JavaScript or TypeScript app and [Bun](https://bun.sh). Use browser functions on the client. Camera or screen capture also needs HTTPS or localhost and user permission.
1. **In your app's terminal**, beside its `package.json`, run:

   ```sh
   bun add https://github.com/dilrajahdan/dappa-video/releases/download/v0.1.0/dappa-video-0.1.0.tgz
   ```

2. **In your browser code**, import the part you need:

   ```ts
   import { startCountdown } from "@dappa/video/countdown";
   import { createThumbnail } from "@dappa/video/thumbnail";
   ```

3. **Check in order:** your app's `package.json` contains `@dappa/video`; its build resolves the imports; the [quickstart browser check](docs/quickstart.md#check-it-in-the-browser) shows 3, 2, 1, then GO.

The release contains built JavaScript and TypeScript declarations. No package build runs inside your app. This package is distributed through GitHub Releases, not npm yet. [Bun supports URL-based packages](https://bun.sh/docs/pm/cli/install#non-npm-dependencies).

## Do we put it on the BBL apps droplet?

**Not for this release. Install it into each app.**

The library runs inside that app's browser bundle. Your existing app continues handling login, recording permissions, uploads and Supabase access.

Clone this repository when you want to **develop the library**. Install a release when you want to **use the library**. Each app pins its own version, so a library release cannot silently change every app.

Later, the droplet could host a separate worker for heavy transcoding or transcription. That worker would need a queue, resource limits and app authentication. It is not part of v0.1.0, and no droplet capacity assessment has been made. [See the diagram](docs/architecture.md).

## Background images stay possible

ActionMode can keep its existing background implementation behind the plugin interface. A future worker implementation can replace it. This release does **not** claim to fix dropped frames or include a background-removal model.

## Open source

[MIT licensed](LICENSE). Built from our own video primitives. Cap informed the architecture discussion; no Cap source code is included. [Source and dependency notes](THIRD_PARTY.md).
