# First standalone release

Execution claim: 2026-09-19, branch `standalone-release`, worktree
`/Users/superluvdub/workspace/projects/active/dappa-video-worktrees/standalone-release`.

## Scope

Extract the existing framework-independent video primitives, make the documentation easy to scan, and ship a tested GitHub release that another app can install. Keep app credentials, customer data, private application code and private Git history out of this repository.

## Decision

Extend existing work. Dappa uses recording across ActionMode, CargoMode and SGSS. This is a bounded package extraction, not a new hosted product. No droplet deployment is needed. Keep server processing optional for a later release.

## Acceptance

1. Public MIT repository containing only the reviewed package and its supporting files.
2. README answers: what is ready, how to install, where it runs and what happens next.
3. Built JavaScript and TypeScript declarations install from a versioned release archive.
4. Unit tests, lint, typecheck, package build and a real Chrome consumer smoke test pass.
5. Fetch the published release into a clean consumer and repeat the browser check.
6. Inspect the public README, merge this branch and remove this session's worktree.

## Not in this release

App migrations, full recording-session extraction, Supabase uploads, frame-rate fixes, video transcoding, trim export and transcription.
