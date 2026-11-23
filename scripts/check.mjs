import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const roots = ["src", "scripts", "tests"];
const files = [];

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (/\.(m?js)$/.test(entry.name)) files.push(fullPath);
  }
}

for (const root of roots) await walk(root);

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\nSyntax error in ${file}\n${result.stderr}\n`);
  }
}

if (failed) process.exit(1);
process.stdout.write(`Syntax check passed for ${files.length} JavaScript files.\n`);
