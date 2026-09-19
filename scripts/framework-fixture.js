import { useVideoRecorder as useReactRecorder } from "@dappa/video/react";
import { useVideoRecorder as useVueRecorder } from "@dappa/video/vue";
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApp, h } from "vue";

window.mountRecorder = (framework) => {
  const host = document.createElement("div");
  document.body.append(host);
  async function acquire() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    window.captureStreamForCheck = stream;
    return stream;
  }
  function render(api, state, element) {
    window.recorderForCheck = { api, state };
    return element("section", {}, [
      element(
        "output",
        { key: "status", id: "recorder-status" },
        `${state.status} ${state.countdown}`,
      ),
      ...[
        ["Start", () => api.start(acquire)],
        ["Stop", api.stop],
        ["Pause", api.pause],
        ["Resume", api.resume],
        ["Reset", api.reset],
      ].map(([label, action]) =>
        element(
          "button",
          { key: label, onClick: action, type: "button" },
          label,
        ),
      ),
      state.previewUrl
        ? element("video", {
            key: "preview",
            id: "recorder-preview",
            src: state.previewUrl,
            controls: true,
            muted: true,
          })
        : null,
    ]);
  }
  if (framework === "react") {
    const root = createRoot(host);
    function Component() {
      const api = useReactRecorder();
      return render(api, api.state, createElement);
    }
    root.render(createElement(StrictMode, null, createElement(Component)));
    window.unmountRecorder = () => {
      root.unmount();
      host.remove();
    };
  } else {
    const app = createApp({
      setup() {
        const api = useVueRecorder();
        return () => render(api, api.state.value, h);
      },
    });
    app.mount(host);
    window.unmountRecorder = () => {
      app.unmount();
      host.remove();
    };
  }
};
