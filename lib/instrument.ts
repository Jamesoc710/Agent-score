// The instrument control (design S2-1a), from the published pages' side.
//
// The control drives the frozen v1 browser layer from a committed action table with no model,
// three passes, and names the sites where the harness itself fails. Its first complete run,
// `instrument-v1`, is the only one registered rule (d) of the exclusion rule ever reads. It has
// not run: until it does, rule (d) is pending on every surface, and nothing is inferred from
// anything else.

/** The batch rule (d) reads: the first complete three-pass run of the v1 harness. */
export const INSTRUMENT_BATCH = "instrument-v1";

/** Its committed summary, built by scripts/build-instrument-summary.ts when it exists (S2-1a section 4). */
export const INSTRUMENT_SUMMARY_PATH = "data/instrument-v1.json";

export interface PendingPrediction {
  site_id: string;
  /** The registered rule the prediction would apply under, if the control confirms it. */
  rule: "d";
  /** Where the prediction was made. */
  decision: string;
}

/**
 * The one typed site list on the published surface, and it is typed because it is a
 * prediction, not a measurement (design S2-4 section 5). Oregon State's every v1 trial ended at
 * the clock after a click on a matched, visible link that never landed, which a scripted check
 * attributes to the harness; only the control can say so. Until then the site carries a
 * pending note, no provenance mark, and no place in any sensitivity.
 *
 * lib/instrument.test.ts fails once a complete `instrument-v1` summary is committed and this
 * list is still non-empty, so the note cannot outlive the control.
 */
export const PENDING_RULE_D: PendingPrediction[] = [
  {
    site_id: "oregon_state",
    rule: "d",
    decision:
      "v2 plan 2026-09-08 (oregon_state joins the TriMet-class corrections) and decision D17 B, 2026-09-22",
  },
];
