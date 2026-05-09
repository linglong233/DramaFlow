/**
 * @fileoverview 版本差异视图
 * @module web/components/project-workspace
 *
 * 两个版本之间的内容差异对比。
 */

"use client";

import { useMemo, useState } from "react";
import type { VersionRecord } from "@dramaflow/shared";
import { diffContents, type DiffEntry } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";

interface Props {
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "content" | "createdAt">>;
  onClose: () => void;
}

export function VersionDiffView({ versions, onClose }: Props) {
  const { t } = useI18n();
  const [baseId, setBaseId] = useState(versions[1]?.id || "");
  const [compareId, setCompareId] = useState(versions[0]?.id || "");

  const baseVersion = useMemo(() => versions.find((version) => version.id === baseId), [baseId, versions]);
  const compareVersion = useMemo(() => versions.find((version) => version.id === compareId), [compareId, versions]);

  const entries = useMemo(() => {
    if (!baseVersion?.content || !compareVersion?.content) {
      return null;
    }
    return diffContents(baseVersion.content, compareVersion.content);
  }, [baseVersion, compareVersion]);

  if (versions.length < 2) {
    return (
      <div className="vdiff-root">
        <div className="vdiff-header">
          <h3 className="heading-4">{t("versionDiff.title")}</h3>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("versionDiff.close")}</button>
        </div>
        <p className="muted" style={{ padding: "var(--space-6)", textAlign: "center" }}>{t("versionDiff.noVersions")}</p>
      </div>
    );
  }

  return (
    <div className="vdiff-root">
      <div className="vdiff-header">
        <h3 className="heading-4">{t("versionDiff.title")}</h3>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("versionDiff.close")}</button>
      </div>

      <div className="vdiff-selectors">
        <div className="form-group">
          <label className="form-label">{t("versionDiff.selectBase")}</label>
          <select className="input" value={baseId} onChange={(event) => setBaseId(event.target.value)}>
            {versions.map((version) => <option key={version.id} value={version.id}>V{version.versionNumber} - {version.title}</option>)}
          </select>
        </div>
        <div className="vdiff-arrow">-&gt;</div>
        <div className="form-group">
          <label className="form-label">{t("versionDiff.selectCompare")}</label>
          <select className="input" value={compareId} onChange={(event) => setCompareId(event.target.value)}>
            {versions.map((version) => <option key={version.id} value={version.id}>V{version.versionNumber} - {version.title}</option>)}
          </select>
        </div>
      </div>

      <div className="vdiff-body">
        {entries === null ? (
          <p className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>{t("versionDiff.noVersions")}</p>
        ) : entries.length === 0 ? (
          <div className="vdiff-same">{t("versionDiff.same")}</div>
        ) : (
          <div className="vdiff-entries">
            {entries.map((entry, index) => (
              <div key={`${entry.label}-${index}`} className={`vdiff-entry vdiff-entry--${entry.type}`}>
                <div className="vdiff-entry__header">
                  <span className={`vdiff-badge vdiff-badge--${entry.type}`}>
                    {entry.type === "added" ? t("versionDiff.added") : entry.type === "removed" ? t("versionDiff.removed") : t("versionDiff.modified")}
                  </span>
                  <span className="vdiff-entry__label">{entry.label}</span>
                </div>
                <div className="vdiff-entry__details">
                  {entry.details.map((detail) => <div key={detail} className="vdiff-detail">{detail}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
