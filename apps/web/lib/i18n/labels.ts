import type {
  AnchorType,
  DocumentType,
  JobStatus,
  JobType,
  ProjectRole,
  ReviewPolicyMode,
  TeamRole,
  VersionStatus,
} from "@dramaflow/shared";

import type { TranslateFn, TranslationKey } from "./messages";

export function getDocumentTypeLabel(t: TranslateFn, value: DocumentType) {
  return t(`enums.documentType.${value}` as TranslationKey);
}

export function getReviewPolicyLabel(t: TranslateFn, value: ReviewPolicyMode) {
  return t(`enums.reviewPolicyMode.${value}` as TranslationKey);
}

export function getVersionStatusLabel(t: TranslateFn, value: VersionStatus) {
  return t(`enums.versionStatus.${value}` as TranslationKey);
}

export function getJobStatusLabel(t: TranslateFn, value: JobStatus) {
  return t(`enums.jobStatus.${value}` as TranslationKey);
}

export function getJobTypeLabel(t: TranslateFn, value: JobType) {
  return t(`enums.jobType.${value}` as TranslationKey);
}

export function getShotDensityLabel(t: TranslateFn, value: "sparse" | "balanced" | "dense") {
  return t(`enums.shotDensity.${value}` as TranslationKey);
}

export function getTeamRoleLabel(t: TranslateFn, value: TeamRole) {
  return t(`enums.teamRole.${value}` as TranslationKey);
}

export function getProjectRoleLabel(t: TranslateFn, value: ProjectRole) {
  return t(`enums.projectRole.${value}` as TranslationKey);
}

export function getAnchorTypeLabel(t: TranslateFn, value: AnchorType) {
  return t(`enums.anchorType.${value}` as TranslationKey);
}

export function getStorageDriverLabel(t: TranslateFn, value: "local" | "s3") {
  return t(`enums.storageDriver.${value}` as TranslationKey);
}
