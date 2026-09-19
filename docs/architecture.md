# Where does it run?

```text
TODAY

  GitHub: dappa-video
        | versioned release
        v
  +------------------------------------+
  | Each app's browser bundle           |
  | App UI + native browser recording   |
  | Countdown + thumbnail helpers       |
  | Optional camera-effect plugin      |
  +----------------+-------------------+
                   | app-owned upload
                   v
  App backend: permission + signed URL
                   |
                   v
  App's Supabase project and bucket

LATER, ONLY IF NEEDED

  Saved video -> authorised job -> queue
                                    |
                      BBL processing worker
                      transcode / transcribe
                                    |
                     results back to storage
```

## Three things with different jobs

| Thing | Purpose | Where it lives |
|---|---|---|
| Repository | Source, docs, tests and releases | GitHub |
| Package | Reusable code installed into an app | Each app's build and the user's browser |
| Processing service | Optional long-running video jobs | A server, potentially the BBL apps droplet |

**Our choice: repository + package now. Add a service when there is a measured need.**

Hosting this repo on a droplet would not make a browser record better. Permissions, countdowns, previews and live backgrounds still happen on the user's device.

## How updates reach the apps

```text
Fix the library once -> publish v0.2.0
                             |
           +-----------------+----------------+
           v                 v                v
       ActionMode        CargoMode           SGSS
       Upgrade           Upgrade             Upgrade
       Test              Test                Test
       Deploy            Deploy              Deploy
```

Apps stay on their installed version until deliberately upgraded. Commit the app's lockfile. Do not depend on a moving `main` branch for production.

The initial ActionMode integration is still a workspace copy in a draft PR. It has not been switched to this release. CargoMode and SGSS have not been migrated. This repo is now the home for future shared-library changes; the integration follow-up should remove the duplicate workspace implementation.

## Supabase and buckets

One future Supabase adapter can serve many apps. Project, bucket and object path are configuration, not separate adapters. A different provider, such as S3, would need a different adapter.

Keep service-role keys on the backend. Give the browser narrowly scoped upload permission. Each app keeps its own user and tenant rules. The current package does not implement upload or choose a bucket.

## Optimisation

**Thumbnails now:** resize once, keep aspect ratio, encode JPEG or WebP. Default maximum is 1200 by 1200 pixels at quality 0.8. Never enlarge a smaller source.

**Video later:** inspect the file first. Keep suitable video as-is, change its container without re-encoding when possible, and transcode only when needed. Keep the original recoverable until the result is verified and saved.

**Live backgrounds:** move heavy inference into a real worker, allow one job at a time, and let rendering reuse the latest complete result. A worker timer alone does not move image processing off the main thread. Decide what users see on failure; do not silently expose a room when a privacy mask was promised.

## If we add a droplet worker

Keep it separate from the public package. Use authenticated jobs, app-scoped storage access, retries, cancellation, CPU/memory/concurrency limits and job status. Measure available capacity before colocating encoding with live apps. No deployment or infrastructure spend is required for this release.
