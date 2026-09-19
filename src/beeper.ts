// Optional audible countdown cues. Prime during a user gesture.
// Tones go to the speakers, not directly to the recording stream.
// Microphones and captured system audio can still pick them up.

const TICK_HZ = 660; // A5-ish: the "get ready" ticks
const GO_HZ = 990; // a fifth up: unmistakably "now"

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null; // no WebAudio → silent countdown, never a crash
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

// Browsers start an AudioContext "suspended" until a user gesture. The recorder's CTA click is
// that gesture, so priming there means the countdown can actually make noise a second later.
export function primeBeeper(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

function tone(hz: number, durationMs: number, gainPeak: number): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine"; // a pure sine reads as a device chime, not an alarm
    osc.frequency.value = hz;
    const now = c.currentTime;
    const dur = durationMs / 1000;
    // A tiny attack/release ramp instead of a hard start-stop: a squared-off sine clicks audibly.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    // An audio failure must never interrupt a recording.
  }
}

/** One of the 3-2-1 ticks. Short and unobtrusive. */
export function beepTick(): void {
  tone(TICK_HZ, 0.09 * 1000, 0.09);
}

/** "You are recording now": higher and slightly longer, so it can't be mistaken for a tick. */
export function beepGo(): void {
  tone(GO_HZ, 0.18 * 1000, 0.12);
}

// Test seam: drop the cached context so a suite can assert construction per case.
export function __resetBeeperForTests(): void {
  ctx = null;
}
