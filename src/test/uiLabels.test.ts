import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Label audit: the admin surface must say "Intuizi Console" (never the legacy
 * "Integration Status") and "SonicSIM Analysis Results" (never
 * "Post-ingestion semantic analysis"). Any reintroduced label fails the suite.
 */
const SRC = path.resolve(__dirname, "..");

const FORBIDDEN = [/integration status/i, /post-?ingestion semantic analysis/i];

const collect = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

describe("admin UI labels", () => {
  const files = collect(SRC);

  it("scans source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never renders legacy labels", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `Legacy labels found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
