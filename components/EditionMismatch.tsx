import { EDITION } from "@/lib/edition-data";

// The batch-mismatch guard's banner (design S2-4 section 8). A page that reads the database
// shows it when the batch it read is not the edition snapshot's batch, and withholds every
// snapshot figure beneath it, so two editions never print side by side.

export default function EditionMismatch({ pageBatch }: { pageBatch: string }) {
  return (
    <div role="status" className="card-notice mb-8">
      <p className="text-sm font-semibold text-notice-ink">
        This page and the published edition describe different batches.
      </p>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-notice-body">
        The table here reads batch{" "}
        <code className="rounded bg-notice-soft px-1 py-0.5 font-mono text-xs">{pageBatch}</code>;
        the edition snapshot ({EDITION.edition.title}) is batch{" "}
        <code className="rounded bg-notice-soft px-1 py-0.5 font-mono text-xs">
          {EDITION.batch_label}
        </code>
        . The snapshot&apos;s figures (the exclusion notes and the registered sensitivity) are
        withheld until the two agree.
      </p>
    </div>
  );
}
