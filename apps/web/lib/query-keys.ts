export const queryKeys = {
  teams: ["teams"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  versionComments: (versionId: string) => ["version-comments", versionId] as const,
  platformOverview: ["platform-overview"] as const,
  teamOverview: (teamId: string) => ["team-overview", teamId] as const,
};