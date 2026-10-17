import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const engineDir = resolve(currentDir, "../src/engine");

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const FORBIDDEN_PATTERNS: { label: string; regex: RegExp }[] = [
  {
    label: "forbidden module import (pg, express, node:fs, node:http, db, api)",
    regex:
      /\b(?:from|import)\s*["'](?:pg|express|node:fs|fs|node:http|http|\.\.\/db|\.\.\/api)(?:\/[^"']*)?["']/,
  },
  {
    label: "Date.now()",
    regex: /\bDate\.now\s*\(/,
  },
  {
    label: "new Date()",
    regex: /\bnew\s+Date\s*\(/,
  },
  {
    label: "Math.random()",
    regex: /\bMath\.random\s*\(/,
  },
  {
    label: "process.env",
    regex: /\bprocess\.env\b/,
  },
  {
    label: "console.*",
    regex: /\bconsole\.(?:log|warn|error|info|debug|trace)\b/,
  },
];

export function findPurityViolations(filePath: string, source: string): string[] {
  const violations: string[] = [];
  for (const { label, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(source)) {
      violations.push(`${filePath}: ${label}`);
    }
  }
  return violations;
}

describe("Engine purity (AGENTS.md §5)", () => {
  it("src/engine/** contains no forbidden imports or impure runtime calls", () => {
    const files = collectTsFiles(engineDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      violations.push(...findPurityViolations(file, content));
    }

    expect(violations).toEqual([]);
  });
});
