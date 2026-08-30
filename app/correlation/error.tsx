"use client";

import ErrorState from "@/components/ErrorState";

export default function CorrelationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState what="the correlation study" error={error} reset={reset} />;
}
