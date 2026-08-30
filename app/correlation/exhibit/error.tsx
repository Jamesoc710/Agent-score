"use client";

import ErrorState from "@/components/ErrorState";

export default function ExhibitError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState what="the Goodhart exhibit" error={error} reset={reset} />;
}
