# Framework wrappers and first migration

Execution: 2026-09-19, `framework-recorders`, sibling worktree `dappa-video-worktrees/framework-recorders`.

Ship a framework-independent recording controller with React and Vue lifecycle wrappers. SGSS is the first consumer: screen-only, no audio, existing three-minute limit and existing feedback storage. Keep ActionMode unchanged; CargoMode is next.

Acceptance: both wrappers tested on mount, updates and unmount; core countdown, cancellation, late permissions, repeat recordings and cleanup verified; install the packed release into SGSS; exercise record, review, submit and playback in the real application; inspect desktop and mobile screenshots. Preserve optional effect interfaces. Do not claim durable in-recording recovery or a Supabase adapter in this release.
