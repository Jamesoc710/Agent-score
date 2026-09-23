import Link from "next/link";
import { agentLabel } from "@/lib/dataset";
import { EDITION } from "@/lib/edition-data";
import { formatDate } from "@/lib/format";
import { formatR } from "@/lib/stats";

// The one registered sensitivity (decision D14), printed beside the published correlation and
// never in its place. Every figure and name is the edition snapshot's, pinned by P6a's
// `sensitivity` block; the caller renders this only when its own batch is the edition's.

function siteName(siteId: string): string {
  return EDITION.sites.find((s) => s.site_id === siteId)?.name ?? siteId;
}

export default function SensitivityLine({ className = "" }: { className?: string }) {
  const { sensitivity } = EDITION.stats;
  const agents = Object.entries(sensitivity.by_agent);
  const n = [...new Set(agents.map(([, s]) => s.n))];
  const pending = EDITION.pending;
  const registered = pending.find((p) => p.registered_on)?.registered_on ?? null;

  return (
    <p className={className}>
      Sensitivity under the registered rule (b), sites whose every recorded trial was the
      harness&apos;s own error removed ({sensitivity.excluded.map(siteName).join(", ")}):{" "}
      {n.length === 1 && <>n&nbsp;=&nbsp;{n[0]}, </>}ρ&nbsp;=&nbsp;
      {agents
        .map(([agentId, s]) => `${formatR(s.point)} (${agentLabel(agentId)})`)
        .join(", ")}
      . Rule (d), sites named by the first complete instrument control, is pending:{" "}
      {registered ? <>registered on {formatDate(registered)}, not yet run</> : <>not yet run</>}
      {pending.length > 0 && (
        <> (the control is predicted to name {pending.map((p) => siteName(p.site_id)).join(", ")}; until it runs, no sensitivity excludes it)</>
      )}
      .{" "}
      <Link href="/methodology#sensitivity" className="link-ink">
        The rule
      </Link>
      .
    </p>
  );
}
