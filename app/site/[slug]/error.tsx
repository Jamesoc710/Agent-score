"use client";

import ErrorState from "@/components/ErrorState";

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState what="this site's results" error={error} reset={reset} />;
}
