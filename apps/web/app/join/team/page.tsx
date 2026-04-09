"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TeamInviteLinkInfoResponse } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../../lib/api";
import { useI18n, getTeamRoleLabel } from "../../../lib/i18n";
import { useSession } from "../../../lib/use-session";
import { ErrorState } from "../../../components/error-state";
import { InlineFeedback } from "../../../components/inline-feedback";
import { LoadingSkeleton } from "../../../components/loading-skeleton";

function JoinTeamContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { session } = useSession();
  const token = searchParams.get("token") ?? "";
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [joined, setJoined] = useState(false);

  const infoQuery = useQuery({
    queryKey: ["inviteLinkInfo", token],
    queryFn: () => apiFetch<TeamInviteLinkInfoResponse>(`/invite-links/${token}`),
    enabled: Boolean(token) && Boolean(session),
    retry: false,
  });

  const joinMutation = useMutation({
    mutationFn: () => apiFetch<{ teamId: string; teamName: string; alreadyMember: boolean }>(`/invite-links/${token}/accept`, {
      method: "POST",
    }),
    onSuccess: (data) => {
      if (data.alreadyMember) {
        setFeedback({ message: t("joinTeam.alreadyMember"), error: null });
      } else {
        setFeedback({ message: t("joinTeam.joinSuccess"), error: null });
      }
      setJoined(true);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "joinTeam.joinError") }),
  });

  useEffect(() => {
    if (!token) return;
    if (!session) {
      const returnUrl = `/join/team?token=${token}`;
      router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    }
  }, [token, session, router]);

  if (!token) {
    return (
      <div className="join-team-page">
        <ErrorState
          title={t("joinTeam.linkInvalid")}
          description=""
          action={<Link href="/dashboard" className="btn btn-secondary">{t("joinTeam.goToDashboard")}</Link>}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="join-team-page">
        <div className="join-team-card">
          <h1 className="join-team-card-title">{t("joinTeam.title")}</h1>
          <p className="join-team-card-desc">{t("joinTeam.loginFirst")}</p>
          <Link href={`/login?returnUrl=${encodeURIComponent(`/join/team?token=${token}`)}`} className="btn btn-primary">
            {t("common.signIn")}
          </Link>
        </div>
      </div>
    );
  }

  if (infoQuery.isPending) {
    return (
      <div className="join-team-page">
        <div className="join-team-card">
          <LoadingSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (infoQuery.error) {
    return (
      <div className="join-team-page">
        <div className="join-team-card">
          <ErrorState
            title={t("joinTeam.linkInvalid")}
            description={formatApiError(infoQuery.error, t, "joinTeam.linkInvalid")}
            action={<Link href="/dashboard" className="btn btn-secondary">{t("joinTeam.goToDashboard")}</Link>}
          />
        </div>
      </div>
    );
  }

  const info = infoQuery.data!;
  const isUnavailable = info.expired || info.exhausted;

  return (
    <div className="join-team-page">
      <div className="join-team-card animate-fade-in">
        <h1 className="join-team-card-title">{t("joinTeam.title")}</h1>
        <p className="join-team-card-desc">{t("joinTeam.description")}</p>

        <div className="join-team-info-grid">
          <div className="join-team-info-item">
            <div className="join-team-info-label">{t("joinTeam.teamLabel")}</div>
            <div className="join-team-info-value">{info.teamName}</div>
          </div>
          <div className="join-team-info-item">
            <div className="join-team-info-label">{t("joinTeam.roleLabel")}</div>
            <div className="join-team-info-value">{getTeamRoleLabel(t, info.role)}</div>
          </div>
        </div>

        <InlineFeedback message={feedback.message} error={feedback.error} />

        {isUnavailable ? (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <ErrorState
              title={info.expired ? t("joinTeam.linkExpired") : t("joinTeam.linkExhausted")}
              description=""
              action={<Link href="/dashboard" className="btn btn-secondary">{t("joinTeam.goToDashboard")}</Link>}
            />
          </div>
        ) : joined ? (
          <Link href="/dashboard" className="btn btn-primary" style={{ width: "100%", display: "block", textAlign: "center" }}>
            {t("joinTeam.goToDashboard")}
          </Link>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            style={{ width: "100%" }}
            onClick={() => joinMutation.mutate()}
            disabled={joinMutation.isPending}
          >
            {joinMutation.isPending ? t("common.submitting") : t("joinTeam.joinAction")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function JoinTeamPage() {
  return (
    <Suspense>
      <JoinTeamContent />
    </Suspense>
  );
}
