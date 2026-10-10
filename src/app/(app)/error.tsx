"use client";

import { Card, ErrorState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dbDown = /ECONNREFUSED|Server selection|MONGODB_URI/.test(error.message);
  return (
    <Card>
      <ErrorState
        message={dbDown ? "The database is unavailable. Make sure MongoDB is running, then try again." : "An unexpected error occurred while loading this page."}
        onRetry={reset}
      />
    </Card>
  );
}
