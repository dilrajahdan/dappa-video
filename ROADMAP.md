# What is ready, and what is next?

```text
NOW                  NEXT                   LATER
Shared primitives -> Reliable recorder  ->  Extra processing
Countdown            Durable chunks        Conditional transcode
Thumbnails           Supabase adapter      Trim export
Effect interface     App integrations      Transcription
```

## Ready in v0.1.0

- Cancellable countdown and audio cues.
- Optimised thumbnails with an optional drawing overlay.
- A bounded worker clock.
- Effect lifecycle and one-job asynchronous frame scheduling.
- Type definitions for an optional future media processor.

## Next release priority: finish a reliable shared recorder

1. Extract the actual capture session and save recoverable chunks during recording.
2. Add storage contracts and a Supabase adapter. Separate “file stored” from “attached to the app's record”.
3. Migrate ActionMode first, then CargoMode and SGSS, with the actual recording and upload path tested in each.
4. Measure the background frame-drop problem and replace the processing behind its plugin interface.

Countdown stays a default. Background images stay optional. React and Vue should use the same core.

## Later, after the recorder is reliable

- Inspect video and selectively remux or transcode.
- Select a thumbnail frame and export a simple trim.
- Transcribe saved audio/video with progress and cancellation.
- Add a server processing worker only if browser processing proves insufficient.

These are priorities, not promised dates. This project is a reusable library, not a replacement video-hosting business.
