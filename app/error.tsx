"use client";

import ErrorState from "@/components/ErrorState";

export default function LeaderboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState what="the leaderboard" error={error} reset={reset} />;
}
