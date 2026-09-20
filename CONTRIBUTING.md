# Change the library

Clone for development. Install a release for app use.

0. **Prerequisites:** Git, Bun 1.2.9 or later, and Chrome for the browser check. No app secrets or Supabase account are required.
1. **Terminal, in your projects folder:**

   ```sh
   git clone https://github.com/dilrajahdan/dappa-video.git
   cd dappa-video
   git fetch origin
   git worktree add ../dappa-video-worktrees/my-change -b my-change origin/main
   cd ../dappa-video-worktrees/my-change
   bun install --frozen-lockfile
   ```

2. **Change the relevant file in `src/`.** Add behaviour tests in `tests/` when needed. Keep framework components, app credentials, customer data and provider-specific business rules outside the core.
3. **Terminal, in the worktree:**

   ```sh
   bun run check
   bun pm pack --filename dappa-video-0.2.1.tgz
   bun run test:consumer ./dappa-video-0.2.1.tgz
   ```

4. **Check in order:** terminal reports lint/typecheck/test/build success; consumer output reports countdown, real recording, thumbnail and worker checks; no browser page errors. The consumer installs into a temporary project outside this repo. Chrome uses synthetic camera/microphone input, not your real devices. This does not verify physical hardware, Safari, screen capture or background segmentation.

Use `CHROME_PATH=/absolute/path/to/chrome` if needed. Otherwise Playwright uses the Chrome channel. Screenshots and results are written to `artifacts/consumer/`. Temporary consumer files are removed on completion.

## Release checklist

0. **Prerequisites:** maintainer access and all checks above passing. Choose a new version; never overwrite a released asset.
1. Update `package.json`, `CHANGELOG.md` and the README's install URL for the new version. Run `bun install` to update the lockfile, then repeat the checks.
2. Review the archive with `tar -tzf <archive>.tgz`. It must contain built JS, declarations, source and public docs. No credentials, private app code or `node_modules`.
3. Merge the reviewed branch. Tag its verified commit, then create a GitHub release with the archive and its SHA-256 checksum. npm publication is a separate future step.
4. Run the consumer test against the **public release URL**. Passing result: a clean project installs it and the actual browser check passes.
5. Open GitHub > repository > README, then Releases > the new version. Check the docs links, version and downloadable archive. Remove only your completed worktree.

Full application migrations require each app's real record, review, upload and playback path to pass separately.
