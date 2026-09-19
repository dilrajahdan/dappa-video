# Working in Dappa Video

- Keep the README short, visual and honest about what ships today.
- Use Bun. Run `bun run check`, pack the release, and run `bun run test:consumer <archive-or-url>` before claiming a release works.
- Keep app secrets, private application code and customer data out of this public repository.
- Keep the core framework independent and free of runtime dependencies unless a dependency is explicitly justified.
- Countdown is a first-class feature. Effects and server processing are optional.
- Do not claim worker timers solve synchronous inference or guarantee hidden-tab frame rate.
- No em dashes in documentation. Use numbered instructions starting at prerequisites (step 0).
- Work in a sibling `dappa-video-worktrees` directory. Fetch and branch from `origin/main`, then merge verified work and clean up only your own worktree.
