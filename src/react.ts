"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createRecorder,
  INITIAL_RECORDER_SNAPSHOT,
  type RecorderOptions,
} from "./recorder.js";

/** Options are fixed on first render. Acquisition starts only from an explicit start(). */
export function useVideoRecorder(options: RecorderOptions = {}) {
  const [controller] = useState(() => createRecorder(options));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => INITIAL_RECORDER_SNAPSHOT,
  );
  // Reset also works during StrictMode's setup/cleanup rehearsal. Destroy would
  // permanently disable the controller before the real mount's first click.
  useEffect(() => () => controller.reset(), [controller]);
  return {
    state,
    start: controller.start,
    stop: controller.stop,
    pause: controller.pause,
    resume: controller.resume,
    reset: controller.reset,
  };
}
