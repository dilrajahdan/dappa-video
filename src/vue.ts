import { onScopeDispose, readonly, shallowRef } from "vue";
import { createRecorder, type RecorderOptions } from "./recorder.js";

/** Call in setup(). Options are fixed for this component's lifetime. */
export function useVideoRecorder(options: RecorderOptions = {}) {
  const controller = createRecorder(options);
  const state = shallowRef(controller.getSnapshot());
  const unsubscribe = controller.subscribe(() => {
    state.value = controller.getSnapshot();
  });
  onScopeDispose(() => {
    unsubscribe();
    controller.destroy();
  });
  return {
    state: readonly(state),
    start: controller.start,
    stop: controller.stop,
    pause: controller.pause,
    resume: controller.resume,
    reset: controller.reset,
  };
}
