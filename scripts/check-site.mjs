#!/usr/bin/env node
// Guards the site's content rules so a bad edit or feed render never ships:
// no em dashes, no retired claims or branding, valid JSON-LD, intact writing markers.

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", ".github", "scripts"]);
const TEXT_EXT = new Set([".html", ".xml", ".txt"]);

const BANNED = [
  { re: /—|&mdash;|&#8212;|&#x2014;/i, why: "em dash (use periods, commas, colons, or parentheses)" },
  { re: /\b18x\b/i, why: "retired 18x OAuth claim" },
  { re: /jared\.dev|jared<span[^>]*>\.dev/i, why: "old jared.dev branding" },
  { re: /Backend Developer/, why: "use Backend Engineer" },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (TEXT_EXT.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

const problems = [];
for await (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  const text = await readFile(file, "utf8");

  text.split("\n").forEach((line, i) => {
    for (const { re, why } of BANNED) if (re.test(line)) problems.push(`${rel}:${i + 1}: ${why}`);
  });

  for (const [, json] of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(json);
      if (!ld["@context"] || !ld["@type"]) problems.push(`${rel}: JSON-LD missing @context or @type`);
    } catch (err) {
      problems.push(`${rel}: JSON-LD does not parse (${err.message})`);
    }
  }

  const starts = text.split("<!-- writing:start -->").length - 1;
  const ends = text.split("<!-- writing:end -->").length - 1;
  if (starts !== ends || starts > 1) problems.push(`${rel}: unbalanced writing markers`);
}

if (problems.length) {
  console.error(problems.map((p) => `::error::${p}`).join("\n"));
  process.exit(1);
}
console.log("Site checks passed.");
