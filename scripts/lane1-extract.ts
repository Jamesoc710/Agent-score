/**
 * Lane 1 extraction: one Lighthouse result (LHR) in, one row out. Pure, no I/O.
 *
 * The spec is design S2-7 §2 "Extracted per audit" and §3's field table. Two kinds of field:
 *
 *   - the v1 contract (`lh_total` and the four flags of LighthouseResult), computed exactly as
 *     v1's Lane 1 did: `Math.round(category.score * 100)`, and a flag is 1 only on
 *     `score === 1` with a null score read as 0. A row in v1 mode is therefore comparable
 *     field for field with data/lighthouse-v1.json. `lh_layout_stability` keeps `=== 1` in every
 *     batch (S2-7 §4); `clsRule: "lighthouse"` exists for the sensitivity view only.
 *   - the v2 panel (Chrome's fraction, the continuous CLS score, the llms.txt status, WebMCP
 *     applicability, the ard-schema status from 13.5.0, versions). These live in the committed
 *     per-batch artifacts, not in lib/types.ts (decisions D7 and D17 B).
 */

import { TIE_EPSILON } from "../lib/stats";
import type { LighthouseResult } from "../lib/types";

export const CATEGORY_ID = "agentic-browsing";

export const AUDIT_IDS = {
  accessibilityTree: "agent-accessibility-tree",
  cls: "cumulative-layout-shift",
  llmsTxt: "llms-txt",
  webmcpTools: "webmcp-registered-tools",
  webmcpForms: "webmcp-form-coverage",
  webmcpSchema: "webmcp-schema-validity",
  ardSchema: "ard-schema",
} as const;

// Lighthouse's report shows an audit as passed at score >= 0.9 (shared/util.js PASS_THRESHOLD).
export const LIGHTHOUSE_PASS_THRESHOLD = 0.9;

// A site needs this many valid repeats to have a row (S2-7 §2 "Per-site rule").
export const MIN_VALID_REPEATS = 2;

// ---------------------------------------------------------------------------
// The LHR, typed only as far as this module reads it
// ---------------------------------------------------------------------------

export interface LhrDetails {
  type?: string;
  items?: unknown[];
}

export interface LhrAudit {
  score: number | null;
  scoreDisplayMode: string;
  numericValue?: number;
  displayValue?: string;
  explanation?: string;
  errorMessage?: string;
  warnings?: unknown[];
  details?: LhrDetails;
}

export interface LhrAuditRef {
  id: string;
  weight: number;
  group?: string;
}

export interface LhrCategory {
  score: number | null;
  categoryScoreDisplayMode?: string;
  auditRefs: LhrAuditRef[];
}

export interface Lhr {
  lighthouseVersion: string;
  fetchTime: string;
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  runtimeError?: { code?: string; message?: string };
  runWarnings?: unknown[];
  environment?: { hostUserAgent?: string; networkUserAgent?: string };
  configSettings?: {
    formFactor?: string;
    screenEmulation?: Record<string, unknown>;
    throttlingMethod?: string;
    emulatedUserAgent?: string | boolean;
  };
  categories?: Record<string, LhrCategory | undefined>;
  audits?: Record<string, LhrAudit | undefined>;
  timing?: { total?: number };
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** "v1": `=== 1` (the rule every published row keeps). "lighthouse": `>= 0.9`, the report's rule. */
export type ClsRule = "v1" | "lighthouse";

/** The llms-txt audit's four outcomes (S2-7 §3). */
export type LlmsTxtStatus = "pass" | "fail" | "absent" | "error";

/** Which branch of `llms-txt.js` produced the outcome (13.3.0 :64-81 and :104). */
export type LlmsTxtBranch =
  | "conforming" // 2xx, every check passed
  | "non_conforming" // 2xx, at least one check failed; reasons are the audit's messages
  | "http_4xx" // notApplicable, weight forced to 0
  | "http_5xx" // score 0, weighted; the displayValue names the status
  | "fetch_failed" // no status (13.4.1 adds an errorMessage); score 0, weighted
  | "audit_error"; // the audit threw

/** The ard-schema audit's outcomes (13.5.0 `ard-schema.js:60-131`; S2-7 §1). */
export type ArdSchemaStatus =
  | "absent" // no discovery signal and no 200: notApplicable
  | "unloadable" // a catalog was signalled but did not load
  | "fails_validation" // conformance errors: score 0
  | "warnings" // warnings only: score 0.9
  | "pass"
  | "error"; // the audit threw

export interface LighthouseFlags {
  lh_total: number;
  lh_accessibility_tree: number;
  lh_layout_stability: number;
  lh_llms_txt: number;
  lh_webmcp: number;
}

export interface PanelFields {
  /** Chrome's fraction, printed "lh_passed of lh_passable" (report-utils.js calculateCategoryFraction). */
  lh_passed: number;
  lh_passable: number;
  /** The CLS audit's score (two decimals); null when the audit has no score. */
  lh_cls_score: number | null;
  /** Unitless CLS (the audit's numericValue). */
  lh_cls_value: number | null;
  /** Lighthouse's own verdict on CLS, score >= 0.9: the derived view of S2-7 §4. */
  lh_cls_lighthouse_pass: number | null;
  /** Null only when the LHR has no llms-txt audit. */
  lh_llms_txt_status: LlmsTxtStatus | null;
  lh_llms_txt_branch: LlmsTxtBranch | null;
  /** The audit's failure messages on "fail"; its explanation or status line on "error". */
  lh_llms_txt_reasons: string[];
  /** 1 when the WebMCP audits applied: the browser exposed the API. Never adoption. */
  lh_webmcp_applied: number;
  /** Tools listed when the audits applied (0 is "applied, none"); null when they did not. */
  lh_webmcp_tool_count: number | null;
  /** webmcp-schema-validity's score (0, 0.5, 1) when it applied; null otherwise. */
  lh_webmcp_schema_validity: number | null;
  /** Forms without WebMCP annotations when the audits applied (0 with no forms); null otherwise. */
  lh_webmcp_form_gaps: number | null;
  /** Null when the LHR's Lighthouse has no ard-schema audit (before 13.5.0). */
  lh_ard_schema_status: ArdSchemaStatus | null;
  lh_ard_schema_reasons: string[];
  lighthouse_version: string;
  /** The version token of environment.hostUserAgent. Chrome reduces it to <major>.0.0.0. */
  chrome_version: string | null;
}

export interface AuditExtract {
  score: number | null;
  scoreDisplayMode: string;
  /** The weight as applied in categories[...].auditRefs; null when the audit is not in the category. */
  weight: number | null;
  numericValue: number | null;
  displayValue: string | null;
  explanation: string | null;
  errorMessage: string | null;
  warnings: string[];
  /** details.items[].message or .issue, when the details carry them. */
  messages: string[];
}

export interface RunMeta {
  lighthouse_version: string;
  fetch_time: string;
  requested_url: string | null;
  final_displayed_url: string | null;
  host_user_agent: string | null;
  network_user_agent: string | null;
  form_factor: string | null;
  screen_emulation: Record<string, unknown> | null;
  throttling_method: string | null;
  run_warnings: string[];
  timing_total_ms: number | null;
  runtime_error: { code: string | null; message: string | null } | null;
  category_score: number | null;
  category_score_display_mode: string | null;
  /** The observed denominator: every auditRef with its applied weight, in category order. */
  weights: { id: string; weight: number }[];
}

export interface ExtractedRun extends LighthouseFlags, PanelFields {
  run: RunMeta;
  audits: Record<string, AuditExtract>;
}

export interface ExtractOptions {
  clsRule: ClsRule;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Why a run cannot supply a row, or null when it can. A runtimeError or a missing category
 * score makes a repeat invalid (S2-7 §2); v1's Lane 1 failed the site in both cases.
 */
export function invalidReason(lhr: Lhr): string | null {
  if (lhr.runtimeError) {
    return `runtimeError ${lhr.runtimeError.code ?? "(no code)"}: ${lhr.runtimeError.message ?? ""}`.trim();
  }
  const category = lhr.categories?.[CATEGORY_ID];
  if (!category) {
    const available = Object.keys(lhr.categories ?? {}).join(", ") || "(none)";
    return `no "${CATEGORY_ID}" category (available: ${available})`;
  }
  if (typeof category.score !== "number") return `"${CATEGORY_ID}" category score is null`;
  return null;
}

export function extractRunMeta(lhr: Lhr): RunMeta {
  const category = lhr.categories?.[CATEGORY_ID];
  const settings = lhr.configSettings ?? {};
  return {
    lighthouse_version: lhr.lighthouseVersion,
    fetch_time: lhr.fetchTime,
    requested_url: lhr.requestedUrl ?? null,
    final_displayed_url: lhr.finalDisplayedUrl ?? null,
    host_user_agent: lhr.environment?.hostUserAgent ?? null,
    network_user_agent: lhr.environment?.networkUserAgent ?? null,
    form_factor: settings.formFactor ?? null,
    screen_emulation: settings.screenEmulation ?? null,
    throttling_method: settings.throttlingMethod ?? null,
    run_warnings: (lhr.runWarnings ?? []).map(String),
    timing_total_ms: typeof lhr.timing?.total === "number" ? lhr.timing.total : null,
    runtime_error: lhr.runtimeError
      ? { code: lhr.runtimeError.code ?? null, message: lhr.runtimeError.message ?? null }
      : null,
    category_score: typeof category?.score === "number" ? category.score : null,
    category_score_display_mode: category?.categoryScoreDisplayMode ?? null,
    weights: (category?.auditRefs ?? []).map((ref) => ({ id: ref.id, weight: ref.weight })),
  };
}

/** Throws on an invalid run; call invalidReason first when a repeat may be invalid. */
export function extractLighthouseRow(lhr: Lhr, { clsRule }: ExtractOptions): ExtractedRun {
  const invalid = invalidReason(lhr);
  if (invalid) throw new Error(`LHR cannot supply a row: ${invalid}`);

  const category = lhr.categories![CATEGORY_ID]!;
  const audits = lhr.audits ?? {};
  const audit = (id: string): LhrAudit | undefined => audits[id];

  const clsAudit = audit(AUDIT_IDS.cls);
  const clsScore = typeof clsAudit?.score === "number" ? clsAudit.score : null;
  const clsLighthousePass = clsScore === null ? null : lighthousePass(clsScore) ? 1 : 0;

  const fraction = chromeFraction(category, audits);
  const llms = llmsTxtOutcome(audit(AUDIT_IDS.llmsTxt));
  const ard = ardSchemaOutcome(audit(AUDIT_IDS.ardSchema));
  const webmcp = webmcpFields(audits);

  return {
    lh_total: Math.round((category.score as number) * 100),
    lh_accessibility_tree: v1Flag(audit(AUDIT_IDS.accessibilityTree)),
    lh_layout_stability: clsRule === "v1" ? v1Flag(clsAudit) : clsLighthousePass ?? 0,
    lh_llms_txt: v1Flag(audit(AUDIT_IDS.llmsTxt)),
    lh_webmcp: v1Flag(audit(AUDIT_IDS.webmcpTools)),

    lh_passed: fraction.passed,
    lh_passable: fraction.passable,
    lh_cls_score: clsScore,
    lh_cls_value: typeof clsAudit?.numericValue === "number" ? clsAudit.numericValue : null,
    lh_cls_lighthouse_pass: clsLighthousePass,
    lh_llms_txt_status: llms?.status ?? null,
    lh_llms_txt_branch: llms?.branch ?? null,
    lh_llms_txt_reasons: llms?.reasons ?? [],
    ...webmcp,
    lh_ard_schema_status: ard?.status ?? null,
    lh_ard_schema_reasons: ard?.reasons ?? [],
    lighthouse_version: lhr.lighthouseVersion,
    chrome_version: chromeVersionFromUserAgent(lhr.environment?.hostUserAgent),

    run: extractRunMeta(lhr),
    audits: extractAudits(category, audits),
  };
}

/** v1's `auditPass`: 1 only on `score === 1`; a missing audit or a null score is 0. */
function v1Flag(audit: LhrAudit | undefined): number {
  if (!audit || audit.score === null) return 0;
  return audit.score === 1 ? 1 : 0;
}

function lighthousePass(score: number): boolean {
  return score >= LIGHTHOUSE_PASS_THRESHOLD - TIE_EPSILON;
}

/**
 * Chrome's fraction, by the rule of `ReportUtils.calculateCategoryFraction`
 * (report/renderer/report-utils.js:311-336): hidden, manual and notApplicable audits are
 * skipped, informative audits never count, everything else is passable and passes at
 * `Number(score) >= 0.9` (an errored audit fails).
 */
export function chromeFraction(
  category: LhrCategory,
  audits: Record<string, LhrAudit | undefined>
): { passed: number; passable: number } {
  let passed = 0;
  let passable = 0;
  for (const ref of category.auditRefs) {
    const result = audits[ref.id];
    if (!result) continue;
    const mode = result.scoreDisplayMode;
    if (ref.group === "hidden" || mode === "manual" || mode === "notApplicable") continue;
    if (mode === "informative") continue;
    passable++;
    if (mode !== "error" && Number(result.score) >= LIGHTHOUSE_PASS_THRESHOLD) passed++;
  }
  return { passed, passable };
}

export function llmsTxtOutcome(
  audit: LhrAudit | undefined
): { status: LlmsTxtStatus; branch: LlmsTxtBranch; reasons: string[] } | null {
  if (!audit) return null;
  if (audit.scoreDisplayMode === "notApplicable") {
    return { status: "absent", branch: "http_4xx", reasons: [] };
  }
  if (audit.scoreDisplayMode === "error") {
    return { status: "error", branch: "audit_error", reasons: nonEmpty([audit.errorMessage]) };
  }
  if (audit.score === 1) return { status: "pass", branch: "conforming", reasons: [] };

  const messages = detailMessages(audit.details);
  if (messages.length > 0) return { status: "fail", branch: "non_conforming", reasons: messages };
  if (audit.explanation) return { status: "error", branch: "fetch_failed", reasons: [audit.explanation] };
  if (audit.displayValue) return { status: "error", branch: "http_5xx", reasons: [audit.displayValue] };
  return { status: "error", branch: "audit_error", reasons: [] };
}

export function ardSchemaOutcome(
  audit: LhrAudit | undefined
): { status: ArdSchemaStatus; reasons: string[] } | null {
  if (!audit) return null;
  if (audit.scoreDisplayMode === "notApplicable") return { status: "absent", reasons: [] };
  if (audit.scoreDisplayMode === "error") {
    return { status: "error", reasons: nonEmpty([audit.errorMessage]) };
  }
  const messages = detailMessages(audit.details);
  if (audit.score === 1) return { status: "pass", reasons: [] };
  if (typeof audit.score === "number" && audit.score > 0) return { status: "warnings", reasons: messages };
  if (messages.length > 0) return { status: "fails_validation", reasons: messages };
  return { status: "unloadable", reasons: nonEmpty([audit.explanation]) };
}

function webmcpFields(audits: Record<string, LhrAudit | undefined>) {
  const tools = audits[AUDIT_IDS.webmcpTools];
  // webmcp-registered-tools is notApplicable exactly when the browser exposes no WebMCP API
  // (`!artifacts.WebMCP.isSupported`), so it carries the applicability of all three audits.
  const applied = tools !== undefined && tools.scoreDisplayMode !== "notApplicable" &&
    tools.scoreDisplayMode !== "error";

  if (!applied) {
    return {
      lh_webmcp_applied: 0,
      lh_webmcp_tool_count: null,
      lh_webmcp_schema_validity: null,
      lh_webmcp_form_gaps: null,
    };
  }

  const schema = audits[AUDIT_IDS.webmcpSchema];
  const schemaApplied = schema && schema.scoreDisplayMode !== "notApplicable" &&
    schema.scoreDisplayMode !== "error" && typeof schema.score === "number";

  const forms = audits[AUDIT_IDS.webmcpForms];
  let formGaps: number | null = null;
  if (forms && forms.scoreDisplayMode !== "error") {
    // notApplicable here means no forms (or, at 13.3.0, every form annotated); a binary 1 at
    // 13.5.0 means every form annotated. Either way no gaps.
    formGaps = forms.scoreDisplayMode === "informative" ? tableItems(forms.details).length : 0;
  }

  return {
    lh_webmcp_applied: 1,
    lh_webmcp_tool_count: countTools(tools.details),
    lh_webmcp_schema_validity: schemaApplied ? (schema.score as number) : null,
    lh_webmcp_form_gaps: formGaps,
  };
}

// webmcp-registered-tools lists tools as a `list` of `list-section`s, each wrapping a table
// (imperative and declarative); no details means the API was exposed with no tools.
function countTools(details: LhrDetails | undefined): number {
  if (!details?.items) return 0;
  if (details.type !== "list") return details.items.length;
  let count = 0;
  for (const section of details.items) {
    const value = (section as { value?: LhrDetails }).value;
    count += value?.items?.length ?? 0;
  }
  return count;
}

function tableItems(details: LhrDetails | undefined): unknown[] {
  return Array.isArray(details?.items) ? details.items : [];
}

function detailMessages(details: LhrDetails | undefined): string[] {
  const out: string[] = [];
  for (const item of tableItems(details)) {
    if (!item || typeof item !== "object") continue;
    const { message, issue } = item as { message?: unknown; issue?: unknown };
    if (typeof message === "string") out.push(message);
    else if (typeof issue === "string") out.push(issue);
  }
  return out;
}

function nonEmpty(values: (string | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function extractAudits(
  category: LhrCategory,
  audits: Record<string, LhrAudit | undefined>
): Record<string, AuditExtract> {
  const weights = new Map(category.auditRefs.map((ref) => [ref.id, ref.weight]));
  const out: Record<string, AuditExtract> = {};
  for (const [id, audit] of Object.entries(audits)) {
    if (!audit) continue;
    out[id] = {
      score: audit.score,
      scoreDisplayMode: audit.scoreDisplayMode,
      weight: weights.get(id) ?? null,
      numericValue: typeof audit.numericValue === "number" ? audit.numericValue : null,
      displayValue: audit.displayValue ?? null,
      explanation: audit.explanation ?? null,
      errorMessage: audit.errorMessage ?? null,
      warnings: (audit.warnings ?? []).map(String),
      messages: detailMessages(audit.details),
    };
  }
  return out;
}

export function chromeVersionFromUserAgent(userAgent: string | undefined | null): string | null {
  const match = userAgent?.match(/(?:HeadlessChrome|Chrome)\/([\d.]+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// The per-site rule: three repeats, one row
// ---------------------------------------------------------------------------

export interface RepeatSummary {
  repeat: number;
  lh_total: number;
  fetch_time: string;
}

export interface MedianSelection {
  lh_repeat: number;
  lh_total_min: number;
  lh_total_max: number;
}

/**
 * The repeat whose lh_total is the median of the valid repeats, ties to the earliest
 * fetchTime (S2-7 §2). With two valid repeats the lower one is the median. Null when fewer
 * than `minValid` are valid: the site is not measured. Only a scratch run with fewer than
 * three repeats lowers `minValid`.
 */
export function selectMedianRepeat(
  valid: RepeatSummary[],
  minValid: number = MIN_VALID_REPEATS
): MedianSelection | null {
  if (valid.length === 0 || valid.length < minValid) return null;
  const byTotal = [...valid].sort((a, b) => a.lh_total - b.lh_total);
  const medianTotal = byTotal[Math.floor((byTotal.length - 1) / 2)].lh_total;
  const chosen = valid
    .filter((r) => r.lh_total === medianTotal)
    .sort((a, b) => Date.parse(a.fetch_time) - Date.parse(b.fetch_time) || a.repeat - b.repeat)[0];
  return {
    lh_repeat: chosen.repeat,
    lh_total_min: byTotal[0].lh_total,
    lh_total_max: byTotal[byTotal.length - 1].lh_total,
  };
}

/** The extended per-site row: the typed row plus the panel, from the median repeat. */
export interface LighthousePanelRow extends LighthouseFlags, PanelFields, MedianSelection {
  site_id: string;
  batch_label: string;
  run_at: string;
  lh_repeats_valid: number;
  lh_repeats_attempted: number;
}

export function buildPanelRow(
  siteId: string,
  batch: string,
  median: ExtractedRun,
  selection: MedianSelection,
  counts: { valid: number; attempted: number }
): LighthousePanelRow {
  return {
    site_id: siteId,
    batch_label: batch,
    run_at: median.run.fetch_time,
    ...flatFields(median),
    ...selection,
    lh_repeats_valid: counts.valid,
    lh_repeats_attempted: counts.attempted,
  };
}

/** An extracted run without its per-run detail (run metadata and per-audit extract). */
export function flatFields(extracted: ExtractedRun): LighthouseFlags & PanelFields {
  const flat: Partial<ExtractedRun> = { ...extracted };
  delete flat.run;
  delete flat.audits;
  return flat as LighthouseFlags & PanelFields;
}

/** The importable row: LighthouseResult fields and nothing else, so import-results.ts reads it unchanged. */
export function toLighthouseResult(row: LighthousePanelRow): LighthouseResult {
  return {
    site_id: row.site_id,
    batch_label: row.batch_label,
    lh_total: row.lh_total,
    lh_accessibility_tree: row.lh_accessibility_tree,
    lh_layout_stability: row.lh_layout_stability,
    lh_llms_txt: row.lh_llms_txt,
    lh_webmcp: row.lh_webmcp,
    run_at: row.run_at,
  };
}
