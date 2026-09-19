// The compositor clock is paced by a Worker. At most one draw is queued by default.
// Drawing still runs in the host; heavy inference must run in its own worker.
// A worker clock avoids depending on requestAnimationFrame in a hidden tab, but browser
// suspension and load can still delay ticks. It cannot guarantee background frame rate.
// No DOM or canvas ownership: this only schedules synchronous host callbacks.

export const TICK_MS = 33; // Approximately 30 Hz, matching canvas.captureStream(30).

const SRC = `let id=null;onmessage=(e)=>{if(e.data==="start"&&id===null)id=setInterval(()=>postMessage(0),${TICK_MS});if(e.data==="stop"&&id!==null){clearInterval(id);id=null;}};`;

export type Ticker = {
  start: () => void;
  stop: () => void;
  /** Stops, terminates the worker and frees its blob URL. Ticks after this are dropped. */
  destroy: () => void;
};

export function createTicker(
  onTick: () => void,
  options: { backpressure?: boolean } = {},
): Ticker {
  // A comparison runs two models. Never queue more inference while its last
  // frame is still processing, otherwise worker messages can starve the UI.
  const backpressure = options.backpressure ?? true;
  const source = backpressure
    ? `let id=null,pending=false;onmessage=(e)=>{if(e.data==="done")pending=false;if(e.data==="start"&&id===null)id=setInterval(()=>{if(!pending){pending=true;postMessage(0);}},${TICK_MS});if(e.data==="stop"&&id!==null){clearInterval(id);id=null;pending=false;}};`
    : SRC;
  const url = URL.createObjectURL(
    new Blob([source], { type: "application/javascript" }),
  );
  const worker = new Worker(url);
  let alive = true;
  let running = false;
  worker.onmessage = () => {
    if (!alive || !running) return;
    try {
      onTick();
    } finally {
      if (backpressure && alive) worker.postMessage("done");
    }
  };
  return {
    start: () => {
      if (alive) {
        running = true;
        worker.postMessage("start");
      }
    },
    stop: () => {
      running = false;
      if (alive) worker.postMessage("stop");
    },
    destroy: () => {
      if (!alive) return;
      alive = false;
      worker.postMessage("stop");
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
