# Source and dependency notes

## Included code

The six source modules were extracted from Dappa's ActionMode video primitives. This repository starts with new history and contains no private app history, credentials, customer data, recording UI or background model.

The included code is released under the root MIT licence. Cap was a design reference during research; no Cap source was copied. FFmpeg, MediaPipe and other model or codec binaries are not included.

## Runtime dependencies

None. The code uses browser APIs. Adding a future effect, storage provider or encoder brings its own dependencies and licence review.

## Development tools

TypeScript, Vitest, jsdom, Biome and Playwright are development dependencies only. They are not bundled in the release archive. Their packages retain their own licences; see their installed package licence files and the committed lockfile.

The MIT licence here does not relicense any future model, codec or third-party dependency. Do not copy external implementations into the project without checking their actual licence and retaining required notices.
