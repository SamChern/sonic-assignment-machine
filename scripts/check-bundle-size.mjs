import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));
const KiB = 1024;
const MiB = 1024 * KiB;

const budgets = {
  total: 20 * MiB,
  javascript: 2 * MiB,
  css: 150 * KiB,
  largestJavaScript: 850 * KiB,
};

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : path;
  }));
  return nested.flat();
}

const format = (bytes) => `${(bytes / KiB).toFixed(1)} KiB`;

let files;
try {
  files = await collectFiles(DIST_DIR);
} catch (error) {
  console.error("Bundle check failed: dist/ is missing. Run the production build first.");
  throw error;
}

const sizes = await Promise.all(files.map(async (path) => ({
  path,
  bytes: (await stat(path)).size,
})));
const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);
const js = sizes.filter(({ path }) => extname(path) === ".js");
const css = sizes.filter(({ path }) => extname(path) === ".css");
const largestJs = js.reduce((largest, file) => file.bytes > largest.bytes ? file : largest, { path: "", bytes: 0 });

const measurements = [
  ["Total dist", sum(sizes), budgets.total],
  ["Total JavaScript", sum(js), budgets.javascript],
  ["Total CSS", sum(css), budgets.css],
  [`Largest JavaScript (${relative(DIST_DIR, largestJs.path) || "none"})`, largestJs.bytes, budgets.largestJavaScript],
];

console.log("Bundle size budget:");
for (const [label, actual, budget] of measurements) {
  console.log(`  ${actual <= budget ? "PASS" : "FAIL"} ${label}: ${format(actual)} / ${format(budget)}`);
}

const failures = measurements.filter(([, actual, budget]) => actual > budget);
if (failures.length) {
  console.error("\nBundle regression detected. Reduce the bundle or deliberately update the reviewed budget.");
  process.exit(1);
}