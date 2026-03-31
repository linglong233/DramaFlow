"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/use-session";
import { LoadingSkeleton } from "../loading-skeleton";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) {
      router.replace("/login");
    }
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="app-layout">
        <main className="app-main" style={{ margin: 0 }}>
          <div className="app-content stack stack-gap-6">
            <LoadingSkeleton variant="hero" rows={4} />
            <LoadingSkeleton rows={6} />
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
