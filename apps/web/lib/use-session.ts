"use client";

import { useEffect, useState } from "react";
import type { SessionPayload } from "@dramaflow/shared";

import { readSession, SESSION_EVENT_NAME } from "./api";

export function useSession() {
  const [session, setSession] = useState<SessionPayload | null | undefined>(undefined);

  useEffect(() => {
    function syncSession() {
      setSession(readSession());
    }

    syncSession();
    window.addEventListener("storage", syncSession);
    window.addEventListener(SESSION_EVENT_NAME, syncSession);

    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener(SESSION_EVENT_NAME, syncSession);
    };
  }, []);

  return {
    session: session ?? null,
    ready: session !== undefined,
  };
}