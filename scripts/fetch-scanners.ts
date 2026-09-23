/**
 * The scanner panel (design S2-7 §6): ora.ai's 0-100 and Cloudflare's isitagentready.com level
 * 0-5 for every cohort site, fetched on the same UTC day as a dated Lane 1 batch.
 *
 *   npx tsx scripts/fetch-scanners.ts --dry-run          # print the plan; no request
 *   npx tsx scripts/fetch-scanners.ts                    # all 28 → data/scanners-<yyyymmdd>.json
 *   npx tsx scripts/fetch-scanners.ts --sites stripe --out <path>
 *
 * Sequential, one request at a time, at least 2 s apart, one research user agent. ora is asked
 * with maxAgeSeconds 86400 and never `force`, so a scan cached within the day is served free
 * and the 30-scans-per-day quota holds 28 sites; a 202 (analysis still running) is polled on
 * GET /api/score/{domain}; a 429 waits out its Retry-After. Every response is stored raw,
 * refusals verbatim, with a derived header whose every null names its reason. Re-running the
 * same day skips sites already fetched from both scanners.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { scannersPath } from "./artifacts";
import { flagValue, hasFlag } from "./args";
import { readCohort } from "./cohort-csv";
import { repoRelative } from "./lane1-env";
import { utcDate } from "./lane1-label";
import type { Site } from "../lib/types";

export const USER_AGENT = "AgentRank/2 (+https://github.com/Jamesoc710/Agent-score; x-axis panel)";
const GAP_MS = 2_000;
const ORA_SCAN = "https://ora.ai/api/scan?format=audit";
const oraScore = (domain: string) => `https://ora.ai/api/score/${encodeURIComponent(domain)}?format=audit`;
const ORA_MAX_AGE_SECONDS = 86_400;
const CF_SCAN = "https://isitagentready.com/api/scan";
const ORA_TIMEOUT_MS = 180_000;
const CF_TIMEOUT_MS = 90_000;
const MAX_RETRIES_429 = 3;
const MAX_RETRY_AFTER_S = 600;
const ORA_POLLS = 6;
const ORA_POLL_MS = 10_000;

interface Exchange {
  request: { method: string; url: string; body: unknown };
  status: number | null;
  headers: Record<string, string>;
  received_at: string;
  body: unknown;
  error: string | null;
}

interface ScannerRecord {
  /** The response the header is read from. */
  final: Exchange;
  /** Every request made for this site and scanner, in order: 429s and polls included. */
  exchanges: Exchange[];
}

interface SiteScanners {
  site_id: string;
  start_url: string;
  ora_target: string;
  header: Record<string, unknown>;
  ora: ScannerRecord | null;
  ora_null_reason?: string;
  cf: ScannerRecord | null;
  cf_null_reason?: string;
}

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(method: "GET" | "POST", url: string, body: unknown, timeoutMs: number): Promise<Exchange> {
  const wait = lastRequestAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const exchange: Exchange = {
    request: { method, url, body },
    status: null,
    headers: {},
    received_at: "",
    body: null,
    error: null,
  };
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    exchange.status = res.status;
    for (const name of ["content-type", "retry-after", "age", "location", "cf-ray", "cf-mitigated"]) {
      const value = res.headers.get(name);
      if (value !== null) exchange.headers[name] = value;
    }
    const text = await res.text();
    try {
      exchange.body = JSON.parse(text);
    } catch {
      exchange.body = text;
    }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    exchange.error = `${e.name}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`;
  } finally {
    clearTimeout(timer);
    exchange.received_at = new Date().toISOString();
  }
  return exchange;
}

/** One logical call, retried only on 429 and only after the Retry-After the server asked for. */
async function withRetryAfter(call: () => Promise<Exchange>, log: Exchange[]): Promise<Exchange> {
  for (let attempt = 0; ; attempt++) {
    const exchange = await call();
    log.push(exchange);
    if (exchange.status !== 429 || attempt >= MAX_RETRIES_429) return exchange;
    const retryAfter = Number(exchange.headers["retry-after"] ?? "60");
    const seconds = Number.isFinite(retryAfter) ? Math.min(retryAfter, MAX_RETRY_AFTER_S) : 60;
    console.log(`    429: waiting ${seconds} s (Retry-After)`);
    await sleep(seconds * 1000);
  }
}

function body(exchange: Exchange): Record<string, unknown> {
  return exchange.body && typeof exchange.body === "object" ? (exchange.body as Record<string, unknown>) : {};
}

async function fetchOra(target: string): Promise<ScannerRecord> {
  const exchanges: Exchange[] = [];
  let final = await withRetryAfter(
    () => request("POST", ORA_SCAN, { url: target, maxAgeSeconds: ORA_MAX_AGE_SECONDS }, ORA_TIMEOUT_MS),
    exchanges
  );
  // 202: scored but analysis still running; poll the stored result until it completes.
  for (let poll = 0; final.status === 202 && poll < ORA_POLLS; poll++) {
    await sleep(ORA_POLL_MS);
    const domain = String(body(final).domain ?? target);
    final = await withRetryAfter(() => request("GET", oraScore(domain), undefined, ORA_TIMEOUT_MS), exchanges);
    if (final.status === 200 && body(final).analysisStatus !== "complete") final = { ...final, status: 202 };
  }
  return { final, exchanges };
}

async function fetchCloudflare(url: string): Promise<ScannerRecord> {
  const exchanges: Exchange[] = [];
  const final = await withRetryAfter(() => request("POST", CF_SCAN, { url }, CF_TIMEOUT_MS), exchanges);
  return { final, exchanges };
}

function refusal(exchange: Exchange): string {
  if (exchange.error) return `request failed: ${exchange.error}`;
  const b = body(exchange);
  const detail = b.error ?? b.message ?? b.code ?? (typeof exchange.body === "string" ? exchange.body.slice(0, 200) : "");
  return `HTTP ${exchange.status}${detail ? `: ${String(detail)}` : ""}`;
}

/** Sets `field` from `value`, or null with `<field>_null_reason`. */
function put(header: Record<string, unknown>, field: string, value: unknown, reason: string): void {
  if (value === undefined || value === null) {
    header[field] = null;
    header[`${field}_null_reason`] = reason;
  } else {
    header[field] = value;
  }
}

export function deriveHeader(ora: ScannerRecord | null, cf: ScannerRecord | null): Record<string, unknown> {
  const header: Record<string, unknown> = {};

  const oraBody = ora ? body(ora.final) : {};
  const oraOk = ora !== null && ora.final.status === 200 && typeof oraBody.score === "number";
  const oraReason = !ora
    ? "not fetched"
    : oraOk
      ? "absent from the response"
      : ora.final.status === 202
        ? "analysis still partial after polling"
        : `refused: ${refusal(ora.final)}`;
  put(header, "ora_score", oraOk ? oraBody.score : null, oraReason);
  put(header, "ora_grade", oraOk ? oraBody.grade : null, oraReason);
  put(header, "ora_contract_version", oraOk ? oraBody.contractVersion : null, oraReason);
  put(header, "ora_scanned_at", oraOk ? oraBody.scannedAt : null, oraReason);

  const cfBody = cf ? body(cf.final) : {};
  const cfOk = cf !== null && cf.final.status === 200 && typeof cfBody.level === "number";
  const cfReason = !cf ? "not fetched" : cfOk ? "absent from the response" : `refused: ${refusal(cf.final)}`;
  put(header, "cf_level", cfOk ? cfBody.level : null, cfReason);
  put(header, "cf_level_name", cfOk ? cfBody.levelName : null, cfReason);
  put(header, "cf_scanned_at", cfOk ? cfBody.scannedAt : null, cfReason);
  return header;
}

// ora takes a domain (D1 passed the start URL without its scheme); Cloudflare takes the URL.
export function oraTarget(site: Site): string {
  return site.start_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function main() {
  const date = utcDate(new Date());
  const only = flagValue("--only", "");
  const doOra = only === "" || only === "ora";
  const doCf = only === "" || only === "cf";
  if (!doOra && !doCf) throw new Error(`--only takes ora or cf.`);
  const out = path.resolve(flagValue("--out", scannersPath(date)));
  const requested = flagValue("--sites", "").split(",").map((s) => s.trim()).filter(Boolean);
  const cohort = readCohort();
  const unknown = requested.filter((id) => !cohort.some((s) => s.site_id === id));
  if (unknown.length > 0) throw new Error(`Not in the cohort: ${unknown.join(", ")}`);
  const sites = requested.length > 0 ? cohort.filter((s) => requested.includes(s.site_id)) : cohort;

  const existing: Record<string, SiteScanners> = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  const done = (id: string) => existing[id] && (!doOra || existing[id].ora) && (!doCf || existing[id].cf);
  const todo = sites.filter((s) => !done(s.site_id));

  console.log(`\nScanner panel, ${date} (UTC)`);
  console.log(`  User agent : ${USER_AGENT}`);
  console.log(`  ora.ai     : ${doOra ? `POST ${ORA_SCAN} {url, maxAgeSeconds: ${ORA_MAX_AGE_SECONDS}}, never force` : "skipped"}`);
  console.log(`  Cloudflare : ${doCf ? `POST ${CF_SCAN} {url}` : "skipped"}`);
  console.log(`  Sites      : ${todo.length} to fetch${sites.length > todo.length ? `, ${sites.length - todo.length} already in the file` : ""}`);
  console.log(`  Output     : ${repoRelative(out)}`);
  console.log(`  Pacing     : sequential, ≥ ${GAP_MS / 1000} s between requests\n`);

  if (hasFlag("--dry-run")) {
    for (const s of todo) {
      console.log(`  ${s.site_id.padEnd(14)} ora ${doOra ? oraTarget(s) : "-"}   cf ${doCf ? s.start_url : "-"}`);
    }
    console.log(`\n--dry-run: no request made, nothing written.\n`);
    return;
  }

  for (const site of todo) {
    const prior = existing[site.site_id];
    const ora = doOra ? await fetchOra(oraTarget(site)) : prior?.ora ?? null;
    const cf = doCf ? await fetchCloudflare(site.start_url) : prior?.cf ?? null;
    const record: SiteScanners = {
      site_id: site.site_id,
      start_url: site.start_url,
      ora_target: oraTarget(site),
      header: deriveHeader(ora, cf),
      ora,
      ...(ora ? {} : { ora_null_reason: "not fetched (--only cf)" }),
      cf,
      ...(cf ? {} : { cf_null_reason: "not fetched (--only ora)" }),
    };
    existing[site.site_id] = record;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(existing, null, 2) + "\n");
    const h = record.header;
    console.log(
      `  ${site.site_id.padEnd(14)} ora ${String(h.ora_score ?? `null (${h.ora_score_null_reason})`).padEnd(8)} ` +
        `cf ${h.cf_level ?? `null (${h.cf_level_null_reason})`}`
    );
  }
  console.log(`\n  → ${repoRelative(out)}\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
