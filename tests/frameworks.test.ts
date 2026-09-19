import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { useVideoRecorder as useReactRecorder } from "../src/react";
import { useVideoRecorder as useVueRecorder } from "../src/vue";

function setupMedia() {
  const track = { stop: vi.fn(), onended: null, readyState: "live" };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  class Recorder {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "video/webm";
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  return { stream, track };
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("Vue renders live state and stops capture on unmount", async () => {
  const { stream, track } = setupMedia();
  let api!: ReturnType<typeof useVueRecorder>;
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(
    defineComponent({
      setup() {
        api = useVueRecorder({ countdownSeconds: 0 });
        return () => h("output", api.state.value.status);
      },
    }),
  );
  app.mount(host);
  await api.start(async () => stream);
  await nextTick();
  expect(host.textContent).toBe("recording");
  app.unmount();
  expect(track.stop).toHaveBeenCalledOnce();
});
it("React survives StrictMode, renders state and stops capture on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { stream, track } = setupMedia();
  let api!: ReturnType<typeof useReactRecorder>;
  function Component() {
    api = useReactRecorder({ countdownSeconds: 0 });
    return createElement("output", null, api.state.status);
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(Component))),
  );
  await act(async () => {
    await api.start(async () => stream);
  });
  expect(host.textContent).toBe("recording");
  await act(async () => root.unmount());
  expect(track.stop).toHaveBeenCalledOnce();
});
