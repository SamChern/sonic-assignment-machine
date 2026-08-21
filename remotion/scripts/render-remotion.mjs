import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
  openBrowser,
} from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stillIdx = process.argv.indexOf("--still");
const stillFrame = stillIdx > -1 ? Number(process.argv[stillIdx + 1]) : null;
const outIdx = process.argv.indexOf("--out");
const out =
  outIdx > -1
    ? process.argv[outIdx + 1]
    : "/mnt/documents/sonicsim-feature-film.mp4";

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, "../src/index.ts"),
  webpackOverride: (c) => c,
});

const browser = await openBrowser("chrome", {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/bin/chromium",
  chromiumOptions: {
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  },
  chromeMode: "chrome-for-testing",
});

const composition = await selectComposition({
  serveUrl: bundled,
  id: "main",
  puppeteerInstance: browser,
});

if (stillFrame !== null) {
  await renderStill({
    composition,
    serveUrl: bundled,
    frame: stillFrame,
    output: `/tmp/vidqa/still-${stillFrame}.png`,
    puppeteerInstance: browser,
    overwrite: true,
  });
} else {
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    crf: 18,
    outputLocation: out,
    puppeteerInstance: browser,
    muted: true,
    concurrency: 4,
    onProgress: ({ progress }) => {
      const p = Math.round(progress * 100);
      if (p % 10 === 0) process.stdout.write(`${p}% `);
    },
  });
}

await browser.close({ silent: false });
console.log("\ndone", stillFrame !== null ? `still ${stillFrame}` : out);
