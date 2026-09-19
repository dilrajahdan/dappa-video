import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const input = process.argv[2];
assert.ok(input, "Pass a local release archive or its public URL.");
const dependency = /^https:\/\//.test(input) ? input : resolve(input);
const consumer = await mkdtemp(join(tmpdir(), "dappa-video-consumer-"));
const artifacts = resolve("artifacts/consumer");
await mkdir(artifacts, { recursive: true });
let browser;
let server;
try {
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "independent-video-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@dappa/video": dependency,
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        vue: "^3.5.0",
      },
    }),
  );
  const install = Bun.spawn(["bun", "install", "--ignore-scripts"], {
    cwd: consumer,
    stdout: "inherit",
    stderr: "inherit",
  });
  assert.equal(await install.exited, 0, "Clean consumer installation failed");
  const installed = JSON.parse(
    await readFile(
      join(consumer, "node_modules/@dappa/video/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.version, "0.2.0");
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  for (const entry of Object.values(installed.exports)) {
    await readFile(join(consumer, "node_modules/@dappa/video", entry.types));
    await readFile(join(consumer, "node_modules/@dappa/video", entry.import));
  }
  await writeFile(
    join(consumer, "entry.js"),
    `
    import {startCountdown} from '@dappa/video/countdown';
    import {createThumbnail} from '@dappa/video/thumbnail';
    import {createTicker} from '@dappa/video/ticker';
    import {createFrameProcessor} from '@dappa/video/effects';
    import {primeBeeper, beepTick, beepGo} from '@dappa/video/beeper';
    window.videoLibrary = {startCountdown,createThumbnail,createTicker,createFrameProcessor,primeBeeper,beepTick,beepGo};
  `,
  );
  const entryPath = join(consumer, "entry.js");
  await writeFile(
    entryPath,
    `${await readFile(entryPath, "utf8")}\n${await readFile(new URL("./framework-fixture.js", import.meta.url), "utf8")}`,
  );
  const build = await Bun.build({
    entrypoints: [join(consumer, "entry.js")],
    target: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env": "{}",
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
  });
  assert.ok(build.success, build.logs.map(String).join("\n"));
  const bundle = await build.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/bundle.js")
        return new Response(bundle, {
          headers: { "Content-Type": "text/javascript" },
        });
      return new Response(
        '<!doctype html><title>Dappa Video consumer check</title><style>body{font:20px system-ui;margin:24px}img{max-width:100%}</style><h1>Release consumer check</h1><output>Checking…</output><img alt="Recorded thumbnail"><script type="module" src="/bundle.js"></script>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const page = await browser.newPage({
    permissions: ["camera", "microphone"],
    viewport: { width: 900, height: 800 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => window.videoLibrary);
  const result = await page.evaluate(async () => {
    const { startCountdown, createThumbnail, createTicker } =
      window.videoLibrary;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: true,
    });
    try {
      const recorder = new MediaRecorder(stream);
      const parts = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      let starts = 0;
      recorder.onstart = () => starts++;
      const counts = [];
      const started = performance.now();
      await new Promise((resolve) =>
        startCountdown({
          onTick: (n) => {
            counts.push(n);
            document.querySelector("output").textContent = String(n);
          },
          onComplete: () => {
            recorder.start();
            resolve();
          },
        }),
      );
      const countdownMs = performance.now() - started;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      recorder.pause();
      const paused = recorder.state === "paused";
      recorder.resume();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      const blob = new Blob(parts, { type: recorder.mimeType });
      const video = document.createElement("video");
      video.muted = true;
      const videoUrl = URL.createObjectURL(blob);
      try {
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () =>
            reject(new Error("Recorded file cannot decode"));
          video.src = videoUrl;
        });
        await new Promise((resolve) => {
          video.onseeked = resolve;
          video.currentTime = 0.5;
        });
        const poster = await createThumbnail(video, {
          width: video.videoWidth,
          height: video.videoHeight,
        });
        const bitmap = await createImageBitmap(poster);
        const thumbnail = {
          width: bitmap.width,
          height: bitmap.height,
          type: poster.type,
          bytes: poster.size,
        };
        bitmap.close();
        const imageUrl = URL.createObjectURL(poster);
        const image = document.querySelector("img");
        image.src = imageUrl;
        await image.decode();
        URL.revokeObjectURL(imageUrl);
        let ticks = 0;
        const ticker = createTicker(() => ticks++);
        ticker.start();
        await new Promise((resolve) => setTimeout(resolve, 250));
        ticker.stop();
        const stopped = ticks;
        await new Promise((resolve) => setTimeout(resolve, 100));
        ticker.destroy();
        const cancelTicks = [];
        const cancel = startCountdown({
          seconds: 1,
          onTick: (n) => cancelTicks.push(n),
        });
        cancel();
        await new Promise((resolve) => setTimeout(resolve, 1100));
        document.querySelector("output").textContent =
          "PASS: countdown, recording and thumbnail";
        return {
          counts,
          countdownMs,
          starts,
          paused,
          videoBytes: blob.size,
          thumbnail,
          ticks,
          stopped,
          cancelTicks,
        };
      } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(videoUrl);
      }
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  });
  assert.deepEqual(result.counts, [3, 2, 1, 0]);
  assert.ok(result.countdownMs >= 2900);
  assert.equal(result.starts, 1);
  assert.ok(result.paused);
  assert.ok(result.videoBytes > 8192);
  assert.equal(result.thumbnail.type, "image/jpeg");
  assert.ok(result.thumbnail.width <= 1200 && result.thumbnail.height <= 1200);
  assert.ok(result.thumbnail.bytes > 0);
  assert.ok(result.ticks > 0);
  assert.equal(result.ticks, result.stopped);
  assert.deepEqual(result.cancelTicks, [1]);
  assert.deepEqual(errors, []);
  const frameworks = {};
  for (const framework of ["vue", "react"]) {
    await page.evaluate((kind) => window.mountRecorder(kind), framework);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector("#recorder-status")?.textContent ===
        "countdown 3",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#recorder-status")?.textContent ===
        "recording 0",
    );
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForFunction(
      () => window.recorderForCheck.state.status === "paused",
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForFunction(
      () => window.recorderForCheck.state.status === "ready",
    );
    await page.waitForFunction(
      () => document.querySelector("#recorder-preview")?.readyState >= 2,
    );
    frameworks[framework] = await page.evaluate(() => ({
      bytes: window.recorderForCheck.state.blob.size,
      width: document.querySelector("#recorder-preview").videoWidth,
    }));
    assert.ok(frameworks[framework].bytes > 8192);
    assert.ok(frameworks[framework].width > 0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(
      () => window.recorderForCheck.state.status === "countdown",
    );
    await page.evaluate(() => window.unmountRecorder());
    assert.ok(
      await page.evaluate(() =>
        window.captureStreamForCheck
          .getTracks()
          .every((track) => track.readyState === "ended"),
      ),
    );
  }
  result.frameworks = frameworks;
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: join(artifacts, "consumer.png"),
    fullPage: true,
  });
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify({ dependency, ...result }, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server?.stop();
  await rm(consumer, { recursive: true, force: true });
}
