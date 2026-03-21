import type {
  AccessContext,
  ProjectRole,
  ReviewPolicyMode,
  TeamRole,
  VersionStatus,
} from "./domain";

const TEAM_ADMIN_ROLES: TeamRole[] = ["tenant_owner", "tenant_admin"];
const PROJECT_EDITOR_ROLES: ProjectRole[] = [
  "project_admin",
  "director",
  "writer",
  "artist",
];
const PROJECT_REVIEW_ROLES: ProjectRole[] = ["project_admin", "reviewer"];

export function resolveReviewRequired(
  teamDefaultPolicy: Exclude<ReviewPolicyMode, "inherit">,
  projectPolicy: ReviewPolicyMode,
): boolean {
  if (projectPolicy === "required") {
    return true;
  }

  if (projectPolicy === "bypass") {
    return false;
  }

  return teamDefaultPolicy === "required";
}

export function getSubmittedStatus(reviewRequired: boolean): VersionStatus {
  return reviewRequired ? "pending_review" : "approved";
}

export function canTransitionVersionStatus(
  currentStatus: VersionStatus,
  nextStatus: VersionStatus,
): boolean {
  const allowed: Record<VersionStatus, VersionStatus[]> = {
    draft: ["submitted", "pending_review", "approved"],
    submitted: ["pending_review", "approved", "rejected"],
    pending_review: ["approved", "rejected"],
    approved: [],
    rejected: ["draft", "submitted", "pending_review"],
  };

  return allowed[currentStatus].includes(nextStatus);
}

export function canManageTenant(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.teamRoles.some((role) => TEAM_ADMIN_ROLES.includes(role));
}

export function canEditProject(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => PROJECT_EDITOR_ROLES.includes(role));
}

export function canReviewProject(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => PROJECT_REVIEW_ROLES.includes(role));
}
