// The published counts and sensitivities of the v2 study design (design/s2-2-study-v2.md,
// section 7: answeredTrials, groupSplit and sensitivity). Pure functions, no data access.
//
// lib/stats.ts holds the statistics; this file knows about runs, transcripts, sites and the
// one registered exclusion rule, and the pages only render what comes out. Every value below is
// mirrored in scripts/stats_reference.py and pinned in scripts/tests/stats-vectors.json under
// `study_v2`. Types are local, so lib/types.ts (the frozen contract) is untouched.
//
// Two rules, inherited from the rest of the project:
//
//  1. A count that cannot be derived returns null, never zero. On v1 the harness recorded no
//     block signal, so `corroborated_blocked` is 0 there by construction, and the surface says
//     why rather than reading the zero as a measured absence of real blocks.
//  2. "Corroborated" has one meaning: a harness-observed signal on the site's domains. A model's
//     own report of a block is "self-reported" everywhere, and is never called correct or wrong.

import {
  MIN_GROUP,
  MIN_N,
  bootstrapCI,
  mean,
  spearmanRho,
  type BootstrapResult,
  type Pair,
} from "./stats";
import type { Run } from "./types";

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/**
 * The registrable domain of a URL under the registered rule (S2-1b section 6): the last two
 * host labels; an IP literal is its own domain; a single-label host (Chrome's error page
 * pseudo-host) is itself. Parsed with one regex on both sides of the contract rather than each
 * language's URL library, so an odd URL cannot be read two ways.
 */
export function registrableDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(url);
  if (!match) return null;
  let authority = match[1];
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    return close > 1 ? authority.slice(1, close).toLowerCase() : null;
  }
  const host = authority.replace(/:\d*$/, "").toLowerCase();
  if (host.length === 0) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const labels = host.split(".").filter((label) => label.length > 0);
  if (labels.length === 0) return null;
  return labels.slice(-2).join(".");
}

/** What the v1 split needs per site: the start URL and the registered answer page's domain. */
export interface SiteDomainInput {
  start_url: string;
  /** Registrable domain of the registered answer page; null when unregistered. */
  answer_domain: string | null;
}

/**
 * The site's domains for one trial: the registrable domains of the start URL, of the step-0
 * URL as recorded (v1's post-goto URL), and of the registered answer page. A domain the agent
 * reached by its own click is never added.
 */
export function siteDomains(run: Run, site: SiteDomainInput | undefined): Set<string> {
  const domains = new Set<string>();
  const add = (domain: string | null) => {
    if (domain !== null) domains.add(domain);
  };
  if (site) {
    add(registrableDomain(site.start_url));
    add(site.answer_domain);
  }
  const first = Array.isArray(run.transcript) ? run.transcript[0] : undefined;
  if (first && typeof first.url === "string") add(registrableDomain(first.url));
  return domains;
}

// ---------------------------------------------------------------------------
// Answered trials: the four classes and the v1 split
// ---------------------------------------------------------------------------

export type AnswerClass =
  | "matched"
  | "corroborated_blocked"
  | "self_reported_blocked"
  | "wrong_answer";

export type SelfReportedClass = "off_site" | "blank_report" | "on_site_report";

export interface TrialAnswer {
  answer_class: AnswerClass;
  /** The answer step's URL is outside the site's domains. */
  off_domain: boolean;
  /** Only for self_reported_blocked: where the report was made. */
  self_reported: SelfReportedClass | null;
  /** The answer step is step 0: the report came from the first observation, before any action. */
  first_observation: boolean;
}

const BLOCK_PREFIX = "block_";
const UNCORROBORATED = "block_self_report_uncorroborated";
const BLANK = /\bblank\b/i;

interface AnswerStep {
  index: number;
  step: number | null;
  url: string | null;
  answer: string | null;
  reasoning: string | null;
  matched: string | null;
}

/** The trial's answer step: the last `done` action in the transcript. Null when there is none. */
function answerStep(run: Run): AnswerStep | null {
  const transcript = Array.isArray(run.transcript) ? run.transcript : [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    const action = entry?.action;
    if (!action || action.action !== "done") continue;
    let url = typeof entry.url === "string" ? entry.url : null;
    for (let j = i - 1; url === null && j >= 0; j--) {
      const earlier = transcript[j]?.url;
      if (typeof earlier === "string") url = earlier;
    }
    return {
      index: i,
      step: typeof entry.step === "number" ? entry.step : null,
      url,
      answer: typeof action.answer === "string" ? action.answer : null,
      reasoning: typeof action.reasoning === "string" ? action.reasoning : null,
      matched: typeof entry.matched === "string" && entry.matched.length > 0 ? entry.matched : null,
    };
  }
  return null;
}

/**
 * The harness's end reason, from the last transcript entry carrying an `end` object (a v2
 * shape; v1 wrote none). Read loosely: the transcript column holds what the harness wrote.
 */
function endReason(run: Run): string | null {
  const transcript = Array.isArray(run.transcript) ? run.transcript : [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i] as unknown as Record<string, unknown> | null;
    const end = entry?.end;
    if (typeof end === "object" && end !== null && !Array.isArray(end)) {
      const reason = (end as Record<string, unknown>).reason;
      return typeof reason === "string" ? reason : null;
    }
  }
  return null;
}

/**
 * Class one trial's answer under the registered rule (S2-2 section 7c). Null when the trial
 * produced no answer. Tested in this order:
 *
 *   matched                the reported fact matched the key (the scored `matched` candidate,
 *                          or `success`, so an off-domain match on v2 still counts by content);
 *   corroborated_blocked   a harness-observed block signal on the site's domains, recorded as
 *                          an `end.reason` beginning `block_` other than the uncorroborated one;
 *   self_reported_blocked  the model's BLOCKED with no such signal: every v1 blocked row, and
 *                          on v2 the rows ended `block_self_report_uncorroborated`;
 *   wrong_answer           a non-matching fact, the only class called "wrong".
 *
 * A self-reported block is then split by where the trial ended, three classes tested in this
 * order: off_site (the answer URL's registrable domain is outside the site's domains),
 * blank_report (on the site's domains and the step's reasoning contains the word "blank": the
 * model's own description, because v1 recorded no capture), on_site_report (every other row).
 */
export function classifyAnswer(run: Run, site: SiteDomainInput | undefined): TrialAnswer | null {
  const step = answerStep(run);
  if (step === null) return null;

  const domain = registrableDomain(step.url);
  const offDomain = domain !== null && !siteDomains(run, site).has(domain);
  const reason = endReason(run);
  const reported = (step.answer ?? "").trim().toUpperCase() === "BLOCKED";

  let answerClass: AnswerClass;
  if (run.success === true || step.matched !== null) answerClass = "matched";
  else if (reason !== null && reason.startsWith(BLOCK_PREFIX) && reason !== UNCORROBORATED) {
    answerClass = "corroborated_blocked";
  } else if (reason === UNCORROBORATED || reported) answerClass = "self_reported_blocked";
  else answerClass = "wrong_answer";

  let selfReported: SelfReportedClass | null = null;
  if (answerClass === "self_reported_blocked") {
    if (offDomain) selfReported = "off_site";
    else if (BLANK.test(step.reasoning ?? "")) selfReported = "blank_report";
    else selfReported = "on_site_report";
  }

  return {
    answer_class: answerClass,
    off_domain: offDomain,
    self_reported: selfReported,
    first_observation: step.step === 0,
  };
}

export interface AnsweredTrials {
  /** Every run handed in, answered or not. */
  recorded: number;
  /** Runs with a `done` step: the denominator of every sentence about answers. */
  answered: number;
  matched: number;
  corroborated_blocked: number;
  self_reported_blocked: number;
  wrong_answer: number;
  /** Matched answers reported outside the site's domains (scored as failures on v2 by R-C). */
  matched_off_domain: number;
  self_reported_split: {
    off_site: number;
    blank_report: number;
    on_site_report: number;
    /** A tag, not a class: self-reported blocks made at step 0. */
    first_observation: number;
  };
  not_answered: { count: number; by_failure_mode: Record<string, number> };
}

/**
 * The four answered-trial classes over a set of runs, with the v1 split of the self-reported
 * blocks. Published as counts, never as a rate. Null when no run carries a transcript, since
 * without transcripts nothing can be classed and a table of zeros would be a fabricated one.
 */
export function answeredTrials(
  runs: Run[],
  sites: Record<string, SiteDomainInput>
): AnsweredTrials | null {
  if (!runs.some((run) => Array.isArray(run.transcript) && run.transcript.length > 0)) return null;

  const result: AnsweredTrials = {
    recorded: runs.length,
    answered: 0,
    matched: 0,
    corroborated_blocked: 0,
    self_reported_blocked: 0,
    wrong_answer: 0,
    matched_off_domain: 0,
    self_reported_split: { off_site: 0, blank_report: 0, on_site_report: 0, first_observation: 0 },
    not_answered: { count: 0, by_failure_mode: {} },
  };
  const modes = new Map<string, number>();

  for (const run of runs) {
    const answer = classifyAnswer(run, sites[run.site_id]);
    if (answer === null) {
      result.not_answered.count++;
      modes.set(run.failure_mode, (modes.get(run.failure_mode) ?? 0) + 1);
      continue;
    }
    result.answered++;
    result[answer.answer_class]++;
    if (answer.answer_class === "matched" && answer.off_domain) result.matched_off_domain++;
    if (answer.self_reported !== null) {
      result.self_reported_split[answer.self_reported]++;
      if (answer.first_observation) result.self_reported_split.first_observation++;
    }
  }

  for (const mode of [...modes.keys()].sort()) {
    result.not_answered.by_failure_mode[mode] = modes.get(mode)!;
  }
  return result;
}

// ---------------------------------------------------------------------------
// The group split and the one registered sensitivity
// ---------------------------------------------------------------------------

/** One site's cell under one agent, with its static score. */
export interface SiteCell {
  site_id: string;
  /** Successes and measured trials. n = 0 is "not measured", never 0%. */
  k: number;
  n: number;
  lh_total: number | null;
}

export interface SplitGroup {
  /** Sites in the group, by id. */
  sites: string[];
  count: number;
  /** Members with no static score: kept in the count, dropped from the mean and range. */
  dropped_null_lh: number;
  /** Null when fewer than MIN_GROUP members carry a static score. */
  mean: number | null;
  min: number | null;
  max: number | null;
}

export interface GroupSplit {
  /** The registered exclusion list, as given, sorted. */
  excluded: string[];
  /** Excluded sites that were actually present in the rows. */
  removed: string[];
  unmeasured: string[];
  all_succeeded: SplitGroup;
  all_failed: SplitGroup;
}

function splitGroup(cells: SiteCell[]): SplitGroup {
  const sites = cells.map((c) => c.site_id).sort();
  const scores = cells.filter((c) => c.lh_total !== null).map((c) => c.lh_total!);
  const reportable = scores.length >= MIN_GROUP;
  let min: number | null = null;
  let max: number | null = null;
  if (reportable) {
    min = scores[0];
    max = scores[0];
    for (const s of scores) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
  }
  return {
    sites,
    count: cells.length,
    dropped_null_lh: cells.length - scores.length,
    mean: reportable ? mean(scores) : null,
    min,
    max,
  };
}

/**
 * The all-succeeded (k = n) and all-failed (k = 0) groups with their static-score mean and
 * range, minus the registered exclusion list: today rule (b), a site whose every v1 trial was
 * a harness error, plus rule (d) once the first complete instrument control names its sites.
 * The list is an input, never derived here, so a surface can print it beside the numbers.
 */
export function groupSplit(rows: SiteCell[], excluded: string[] = []): GroupSplit {
  const out = new Set(excluded);
  const measured = rows.filter((r) => r.n > 0);
  const present = new Set(rows.map((r) => r.site_id));
  const kept = measured.filter((r) => !out.has(r.site_id));
  return {
    excluded: [...out].sort(),
    removed: [...out].filter((id) => present.has(id)).sort(),
    unmeasured: rows
      .filter((r) => r.n === 0)
      .map((r) => r.site_id)
      .sort(),
    all_succeeded: splitGroup(kept.filter((r) => r.k === r.n)),
    all_failed: splitGroup(kept.filter((r) => r.k === 0)),
  };
}

export interface Sensitivity {
  excluded: string[];
  removed: string[];
  /** Sites the correlation is computed on after the removal. */
  n: number;
  rho: number;
  ci: BootstrapResult;
  group_split: GroupSplit;
}

/**
 * The one registered sensitivity (D14): the published correlation recomputed with the
 * exclusion list's sites removed at the site level, with the same Spearman and the same
 * bootstrap the page already prints, and the group split under the same list. Printed beside
 * the pre-registered n = 27 result, never in its place. Null below MIN_N.
 */
export function sensitivity(
  rows: SiteCell[],
  excluded: string[],
  options: { iterations?: number; seed?: number } = {}
): Sensitivity | null {
  const out = new Set(excluded);
  const kept = rows.filter((r) => r.n > 0 && r.lh_total !== null && !out.has(r.site_id));
  if (kept.length < MIN_N) return null;

  const pairs: Pair[] = kept.map((r) => ({ x: r.lh_total!, y: r.k / r.n }));
  const rho = spearmanRho(pairs);
  if (rho === null) return null;
  const ci = bootstrapCI(pairs, spearmanRho, options);
  if (ci === null) return null;

  const split = groupSplit(rows, excluded);
  return { excluded: split.excluded, removed: split.removed, n: kept.length, rho, ci, group_split: split };
}
