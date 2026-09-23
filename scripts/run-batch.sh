#!/usr/bin/env bash
# run-batch.sh: the launch path for a batch (design S2-6 §2). This is P4's slice (S2-6 §13):
# --lane lighthouse only. The other lanes, the preflights and the other health gates land
# with P1, after the kill review.
#
# Usage:
#   bash scripts/run-batch.sh --lane lighthouse --vantage residential --p4
#       The four P4 batches of today (UTC), back to back under one lock and one date:
#       lh-v2-<yyyymmdd> (the pinned 13.3.0), -13.4.1, -13.5.0, -desktop.
#   bash scripts/run-batch.sh --lane lighthouse --vantage residential --batch lh-v2-<yyyymmdd>[-<version>][-desktop]
#       One dated batch; the label names the version and preset.
#   bash scripts/run-batch.sh --lane lighthouse --vantage residential --batch smoke-<name> \
#       [--sites stripe,twilio] [--repeats 1] [--lighthouse-version 13.5.0] [--preset desktop]
#       A scratch batch: exercises the pipeline, never imported.
#   Add --dry-run to print the plan and the resolved manifest and write nothing.
#   Add --resume (with --batch) to finish a batch interrupted earlier the same UTC day.
#
# Steps per batch: the lock, the label rule and the existing-label refusal, the code and
# vantage record, the manifest (started), Lane 1 under `caffeinate -i`, the health card
# (HC4, HC12), the manifest (finished, with artifact digests), and the import line, printed
# and never run. It never imports and never holds SUPABASE_SERVICE_ROLE_KEY.

set -euo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOCK_DIR="data/.run.lock.d"
PYTHON=".venv/bin/python"

die() {
  echo "run-batch: $*" >&2
  exit 1
}

# IFS is newline-and-tab, so "${ARRAY[*]}" would join with newlines; print with spaces.
words() {
  local IFS=' '
  echo "$*"
}

usage() {
  sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

LANE=""
BATCH=""
VANTAGE=""
SITES=""
REPEATS="3"
VERSION=""
PRESET=""
RESUME=0
DRY_RUN=0
P4=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) LANE="${2:-}"; shift 2 ;;
    --batch) BATCH="${2:-}"; shift 2 ;;
    --vantage) VANTAGE="${2:-}"; shift 2 ;;
    --sites) SITES="${2:-}"; shift 2 ;;
    --repeats) REPEATS="${2:-}"; shift 2 ;;
    --lighthouse-version) VERSION="${2:-}"; shift 2 ;;
    --preset) PRESET="${2:-}"; shift 2 ;;
    --resume) RESUME=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --p4) P4=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[[ "$LANE" == "lighthouse" ]] ||
  die "--lane lighthouse is the only lane built (P4's slice of S2-6); got '${LANE}'."
[[ "$VANTAGE" == "residential" || "$VANTAGE" == "datacenter" ]] ||
  die "--vantage residential|datacenter is required."
[[ -n "$PRESET" && "$PRESET" != "desktop" ]] && die "--preset takes 'desktop' only."

# One date for the whole invocation, so the four P4 labels share it.
RUN_DATE="$(date -u +%Y%m%d)"

LABELS=()
LABEL_VERSIONS=()
LABEL_PRESETS=()
if [[ "$P4" == 1 ]]; then
  [[ "$RESUME" == 1 ]] && die "--p4 does not resume: resume the interrupted batch with --batch <label> --resume, then run the rest one by one."
  [[ -n "$VERSION" || -n "$PRESET" ]] && die "--p4 takes the version and preset from the four labels."
  # --batch smoke-<name> with --p4 runs the same four configurations under scratch labels.
  BASE="${BATCH:-lh-v2-${RUN_DATE}}"
  LABELS=("$BASE" "${BASE}-13.4.1" "${BASE}-13.5.0" "${BASE}-desktop")
  LABEL_VERSIONS=("" "13.4.1" "13.5.0" "")
  LABEL_PRESETS=("" "" "" "desktop")
else
  [[ -n "$BATCH" ]] || die "--batch <label> (or --p4) is required. There is no default batch."
  LABELS=("$BATCH")
  LABEL_VERSIONS=("$VERSION")
  LABEL_PRESETS=("$PRESET")
fi

# ---------------------------------------------------------------------------
# Step 0: the machine lock (not taken for a dry run, which writes nothing)
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == 0 ]]; then
  mkdir -p data
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "another run holds ${LOCK_DIR}: $(cat "${LOCK_DIR}/owner" 2>/dev/null || echo unknown)"
  fi
  trap 'rm -rf "$LOCK_DIR"' EXIT
  printf 'pid %s\nbatches %s\nstarted %s\n' "$$" "$(words "${LABELS[@]}")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${LOCK_DIR}/owner"
fi

# ---------------------------------------------------------------------------
# The label rule and the existing-label refusal, for every label before anything runs
# ---------------------------------------------------------------------------
KINDS=()
VERSIONS=()
PRESETS=()
EXPECTED=()
for i in "${!LABELS[@]}"; do
  LABEL="${LABELS[$i]}"
  ARGS=(--batch "$LABEL" --vantage "$VANTAGE" --date "$RUN_DATE" --repeats "$REPEATS")
  [[ -n "${LABEL_VERSIONS[$i]}" ]] && ARGS+=(--lighthouse-version "${LABEL_VERSIONS[$i]}")
  [[ -n "${LABEL_PRESETS[$i]}" ]] && ARGS+=(--preset "${LABEL_PRESETS[$i]}")
  [[ -n "$SITES" ]] && ARGS+=(--sites "$SITES")
  [[ "$RESUME" == 1 ]] && ARGS+=(--resume)
  RESOLVED="$(npx tsx scripts/batch-manifest.ts check "${ARGS[@]}")"
  V="" P="" K="" E=""
  while IFS='=' read -r KEY VALUE; do
    case "$KEY" in
      lighthouse_version) V="$VALUE" ;;
      preset) P="$VALUE" ;;
      kind) K="$VALUE" ;;
      expected_sites) E="$VALUE" ;;
    esac
  done <<<"$RESOLVED"
  [[ "$K" == "dated" && -n "$SITES" ]] && die "${LABEL}: a dated batch measures the whole cohort; --sites is for smoke-<name> labels."
  VERSIONS+=("$V")
  PRESETS+=("$P")
  KINDS+=("$K")
  EXPECTED+=("$E")
done

# Steps 1 and 2 (code and vantage) are recorded by batch-manifest.ts start into the manifest.
DIRTY="$(git status --porcelain)"
[[ -n "$DIRTY" ]] && echo "run-batch: warning: the working tree is dirty; the manifest records it." >&2

companion_dir() { echo "scripts/lighthouse-companions/$1"; }
PINNED="$(node -p 'require("./package.json").devDependencies.lighthouse')"

for V in "${VERSIONS[@]}"; do
  if [[ "$V" == "$PINNED" ]]; then
    [[ -f node_modules/lighthouse/package.json ]] || die "Lighthouse ${V} is not installed: run npm ci."
    continue
  fi
  DIR="$(companion_dir "$V")"
  [[ -f "${DIR}/package-lock.json" ]] || die "no companion project for Lighthouse ${V} at ${DIR}/."
  if [[ ! -f "${DIR}/node_modules/lighthouse/package.json" ]]; then
    if [[ "$DRY_RUN" == 1 ]]; then
      echo "run-batch: Lighthouse ${V} is not installed; the run would first do: npm ci --prefix ${DIR}"
    else
      echo "run-batch: installing Lighthouse ${V} from its lockfile"
      npm ci --prefix "$DIR" --no-audit --no-fund
    fi
  fi
done

# ---------------------------------------------------------------------------
# Per batch: manifest (started), Lane 1, health card, manifest (finished), import line
# ---------------------------------------------------------------------------
BLOCKED=()
for i in "${!LABELS[@]}"; do
  LABEL="${LABELS[$i]}"
  V="${VERSIONS[$i]}"
  P="${PRESETS[$i]}"
  K="${KINDS[$i]}"
  E="${EXPECTED[$i]}"

  echo
  echo "================================================================"
  echo " ${LABEL}: Lighthouse ${V}${P:+ --preset=${P}}, ${K}, ${VANTAGE}, expecting ${E} sites"
  echo "================================================================"

  START_ARGS=(--batch "$LABEL" --vantage "$VANTAGE" --date "$RUN_DATE" --repeats "$REPEATS" --lighthouse-version "$V")
  [[ -n "$P" ]] && START_ARGS+=(--preset "$P")
  [[ -n "$SITES" ]] && START_ARGS+=(--sites "$SITES")
  [[ "$RESUME" == 1 ]] && START_ARGS+=(--resume)

  LANE_CMD=(npx tsx scripts/lane1-lighthouse.ts --batch "$LABEL" --lighthouse-version "$V" --repeats "$REPEATS")
  [[ -n "$P" ]] && LANE_CMD+=(--preset "$P")
  [[ -n "$SITES" ]] && LANE_CMD+=(--sites "$SITES")
  [[ "$RESUME" == 1 ]] && LANE_CMD+=(--resume)

  if [[ "$DRY_RUN" == 1 ]]; then
    if [[ "$V" == "$PINNED" || -f "$(companion_dir "$V")/node_modules/lighthouse/package.json" ]]; then
      npx tsx scripts/batch-manifest.ts start "${START_ARGS[@]}" --dry-run
      "${LANE_CMD[@]}" --dry-run
    fi
    echo "  would run: caffeinate -i $(words "${LANE_CMD[@]}")"
    echo "  then: ${PYTHON} scripts/health-card.py --batch ${LABEL} --expected ${E}"
    continue
  fi

  npx tsx scripts/batch-manifest.ts start "${START_ARGS[@]}"

  # caffeinate -i keeps a laptop awake for an unattended batch; absent on a Linux runner.
  set +e
  if command -v caffeinate >/dev/null 2>&1; then
    caffeinate -i "${LANE_CMD[@]}"
  else
    "${LANE_CMD[@]}"
  fi
  LANE_EXIT=$?
  "$PYTHON" scripts/health-card.py --batch "$LABEL" --expected "$E"
  HEALTH_EXIT=$?
  set -e

  npx tsx scripts/batch-manifest.ts finish --batch "$LABEL" --lane-exit "$LANE_EXIT"

  if [[ "$LANE_EXIT" != 0 ]]; then
    die "${LABEL}: Lane 1 exited ${LANE_EXIT}; stopping. The manifest has finished_at null, so --batch ${LABEL} --resume can finish it today (UTC)."
  fi
  if [[ "$HEALTH_EXIT" != 0 ]]; then
    echo "run-batch: ${LABEL} is BLOCKED by the health card (data/health-${LABEL}.json); no import line."
    BLOCKED+=("$LABEL")
    continue
  fi
  if [[ "$K" == "scratch" ]]; then
    echo "run-batch: ${LABEL} is a scratch batch; it is not for import."
  else
    echo "Import (James runs this; run-batch.sh never imports):"
    echo "  npm run import -- --batch ${LABEL}"
  fi
done

if [[ "${#BLOCKED[@]}" -gt 0 ]]; then
  die "blocked by the health card: $(words "${BLOCKED[@]}")"
fi
exit 0
