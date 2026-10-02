#!/usr/bin/env node
// Pulls Jared's latest pckt.blog posts from his AT Protocol repo and writes them
// into the static pages between <!-- writing:start --> / <!-- writing:end --> markers.
//
// pckt.blog stores a `blog.pckt.document` record per post. That record is a thin
// wrapper whose `document` strong ref points at a `site.standard.document` record,
// which holds the title, dates, and URL path. The path is relative to the
// `site.standard.publication` record's `url`.
//
// If the network fetch fails, the pages are left exactly as committed (the last
// good render is the fallback) and the script exits 0 with a warning.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DID = "did:plc:tsjjh5uzepibeoujgscgfgo4";
const PLC_DIRECTORY = process.env.PLC_DIRECTORY ?? "https://plc.directory";
const POST_COLLECTION = "blog.pckt.document";
const MAX_POSTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- writing:start -->";
const END = "<!-- writing:end -->";

const TARGETS = [
  { file: "index.html", url: "https://jaredlemler.com/", render: renderHomeItem, indent: "            " },
  { file: "blog/index.html", url: "https://jaredlemler.com/blog/", render: renderBlogItem, indent: "            " },
];

async function getJson(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "jaredlemler.com writing-feed" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}

async function resolvePds(did) {
  const doc = await getJson(`${PLC_DIRECTORY}/${did}`);
  const service = doc.service?.find((s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`);
  if (!service?.serviceEndpoint) throw new Error(`No #atproto_pds service in DID document for ${did}`);
  return service.serviceEndpoint.replace(/\/$/, "");
}

async function listRecords(pds, collection) {
  const records = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ repo: DID, collection, limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?${qs}`);
    records.push(...(page.records ?? []));
    cursor = page.records?.length ? page.cursor : undefined;
  } while (cursor);
  return records;
}

function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri ?? "");
  if (!m) throw new Error(`Not an at:// record URI: ${uri}`);
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

async function getRecord(pds, uri) {
  const { repo, collection, rkey } = parseAtUri(uri);
  if (repo !== DID) throw new Error(`Refusing to follow ref outside ${DID}: ${uri}`);
  const qs = new URLSearchParams({ repo, collection, rkey });
  return (await getJson(`${pds}/xrpc/com.atproto.repo.getRecord?${qs}`)).value;
}

async function fetchPosts() {
  const pds = await resolvePds(DID);
  const wrappers = await listRecords(pds, POST_COLLECTION);
  const publications = new Map();
  const posts = [];

  for (const wrapper of wrappers) {
    const docUri = wrapper.value?.document?.uri;
    if (!docUri) continue;
    const doc = await getRecord(pds, docUri);
    if (!publications.has(doc.site)) publications.set(doc.site, await getRecord(pds, doc.site));
    const pub = publications.get(doc.site);

    const published = new Date(doc.publishedAt);
    if (typeof doc.title !== "string" || !doc.title.trim()) continue;
    if (Number.isNaN(published.getTime())) continue;
    if (typeof pub?.url !== "string" || !pub.url.startsWith("https://")) continue;

    posts.push({
      title: doc.title.trim(),
      description: typeof doc.description === "string" ? doc.description.trim() : "",
      published,
      url: new URL(doc.path ?? "/", pub.url).href,
    });
  }

  posts.sort((a, b) => b.published - a.published);
  return posts.slice(0, MAX_POSTS);
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const isoDate = (d) => d.toISOString().slice(0, 10);
const displayDate = (d) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function summarize(text, max = 140) {
  const clean = text.replace(/\s+/g, " ").replace(/[\u2014]/g, ", ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(" ", max)).replace(/[,.;:]$/, "")}…`;
}

function renderHomeItem(p) {
  const desc = p.description ? `\n  <p class="text-xs text-slate-400 mt-1">${escapeHtml(summarize(p.description))}</p>` : "";
  return `<a href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer" class="block rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-emerald-400 transition">
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <p class="font-medium text-slate-100">${escapeHtml(p.title)}</p>
    <time datetime="${isoDate(p.published)}" class="text-xs text-slate-400 shrink-0">${displayDate(p.published)}</time>
  </div>${desc}
</a>`;
}

function renderBlogItem(p) {
  const desc = p.description ? `\n  <p class="text-sm text-slate-400">${escapeHtml(summarize(p.description))}</p>` : "";
  return `<a href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer" class="block rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 hover:border-emerald-400 transition">
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
    <p class="font-medium text-slate-100">${escapeHtml(p.title)}</p>
    <time datetime="${isoDate(p.published)}" class="text-xs text-slate-400 shrink-0">${displayDate(p.published)}</time>
  </div>${desc}
</a>`;
}

function spliceBetweenMarkers(html, inner, file) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a || html.indexOf(START, a + 1) !== -1) {
    throw new Error(`${file}: expected exactly one ${START} ... ${END} block`);
  }
  return html.slice(0, a + START.length) + inner + html.slice(b);
}

async function bumpSitemap(urls, today) {
  const file = path.join(ROOT, "sitemap.xml");
  let xml = await readFile(file, "utf8");
  for (const url of urls) {
    const re = new RegExp(`(<loc>${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>\\s*<lastmod>)[^<]*(</lastmod>)`);
    xml = xml.replace(re, `$1${today}$2`);
  }
  await writeFile(file, xml);
}

async function main() {
  let posts;
  try {
    posts = await fetchPosts();
    if (posts.length === 0) throw new Error("no pckt.blog posts found");
  } catch (err) {
    console.log(`::warning::Writing feed fetch failed, keeping the committed list: ${err.message}`);
    return;
  }

  const changed = [];
  for (const t of TARGETS) {
    const file = path.join(ROOT, t.file);
    const html = await readFile(file, "utf8");
    const body = posts.map((p) => t.render(p).replace(/^/gm, t.indent)).join("\n");
    const next = spliceBetweenMarkers(html, `\n${body}\n${t.indent}`, t.file);
    if (next !== html) {
      await writeFile(file, next);
      changed.push(t);
    }
  }

  if (changed.length) await bumpSitemap(changed.map((t) => t.url), isoDate(new Date()));
  console.log(`Rendered ${posts.length} posts. Updated: ${changed.map((t) => t.file).join(", ") || "nothing (already current)"}`);
  for (const p of posts) console.log(`  ${isoDate(p.published)}  ${p.title}  ${p.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
