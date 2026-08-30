"use client";

import ErrorState from "@/components/ErrorState";

export default function SubAuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState what="the sub-audit breakdown" error={error} reset={reset} />;
}
