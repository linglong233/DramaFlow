import type {
  CommentRecord,
  DocumentRecord,
  JobRecord,
  ProjectMemberRecord,
  ProjectRecord,
  RefreshTokenRecord,
  TeamMemberRecord,
  TeamRecord,
  UploadAssetRecord,
  UserRecord,
  VersionRecord,
} from "@dramaflow/shared";

export interface ProjectInviteRecord {
  id: string;
  projectId: string;
  email: string;
  role: ProjectMemberRecord["role"];
  createdBy: string;
  status: "pending" | "accepted";
  createdAt: string;
}

export interface DevDatabase {
  users: UserRecord[];
  refreshTokens: RefreshTokenRecord[];
  teams: TeamRecord[];
  teamMembers: TeamMemberRecord[];
  projects: ProjectRecord[];
  projectMembers: ProjectMemberRecord[];
  projectInvites: ProjectInviteRecord[];
  documents: DocumentRecord[];
  versions: VersionRecord[];
  comments: CommentRecord[];
  jobs: JobRecord[];
  assets: UploadAssetRecord[];
  updatedAt: string;
}

export function createEmptyDatabase(): DevDatabase {
  return {
    users: [],
    refreshTokens: [],
    teams: [],
    teamMembers: [],
    projects: [],
    projectMembers: [],
    projectInvites: [],
    documents: [],
    versions: [],
    comments: [],
    jobs: [],
    assets: [],
    updatedAt: new Date().toISOString(),
  };
}
