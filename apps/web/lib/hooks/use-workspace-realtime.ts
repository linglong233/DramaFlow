"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeJobUpdatedEvent, RealtimeReviewUpdatedEvent, TaskListResponse } from "@dramaflow/shared";
import { queryKeys } from "../query-keys";
import { useRealtime } from "../../components/realtime-provider";

function mergeProjectJobs(
  current: TaskListResponse | undefined,
  nextJob: TaskListResponse["jobs"][number],
): TaskListResponse {
  const existingJobs = current?.jobs ?? [];
  const jobs = [nextJob, ...existingJobs.filter((job) => job.id !== nextJob.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    jobs,
    total: current ? Math.max(current.total, jobs.length) : jobs.length,
  };
}

/** 订阅工作区实时事件（作业更新、审核更新），自动管理 socket 生命周期 */
export function useWorkspaceRealtime(projectId: string) {
  const queryClient = useQueryClient();
  const { socket, subscribeProject, unsubscribeProject } = useRealtime();

  useEffect(() => {
    if (!projectId) return;

    subscribeProject(projectId);
    return () => unsubscribeProject(projectId);
  }, [projectId, subscribeProject, unsubscribeProject]);

  useEffect(() => {
    if (!socket) return;

    async function handleJobUpdated(event: RealtimeJobUpdatedEvent) {
      if (event.projectId !== projectId) return;

      queryClient.setQueryData<TaskListResponse>(queryKeys.projectJobs(projectId), (current) => mergeProjectJobs(current, event.job));

      if (event.job.type === "export_video") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
      }

      if (event.job.status === "completed" || event.job.status === "failed") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
        ]);
      }
    }

    function handleReviewUpdated(event: RealtimeReviewUpdatedEvent) {
      if (event.projectId !== projectId) return;

      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.versionComments(event.versionId) });
    }

    socket.on("job.updated", handleJobUpdated);
    socket.on("review.updated", handleReviewUpdated);

    return () => {
      socket.off("job.updated", handleJobUpdated);
      socket.off("review.updated", handleReviewUpdated);
    };
  }, [projectId, queryClient, socket]);
}
