"use client";

import { useRef, useState } from "react";
import { useI18n } from "../../../../../lib/i18n";
import { apiFetch } from "../../../../../lib/api";

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 9V2.5M4.5 5L7 2.5 9.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 9v2.5h9V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReferenceImageUploader({
  images,
  onChange,
  projectId,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  projectId: string;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const targetRes = await apiFetch<{
        asset: { id: string };
        target: { publicUrl?: string; method: string; url: string; driver: string };
      }>("/uploads", {
        method: "POST",
        body: { projectId, filename: file.name, contentType: file.type, sizeInBytes: file.size },
      });

      if (targetRes.target.driver === "local") {
        const key = targetRes.target.url.replace(/.*\/uploads\/direct\//, "");
        const buffer = await file.arrayBuffer();
        const uploadRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/uploads/direct/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": file.type,
              Authorization: `Bearer ${typeof window !== "undefined" ? JSON.parse(localStorage.getItem("session") || "{}").accessToken : ""}`,
            },
            body: buffer,
          },
        );
        if (!uploadRes.ok) throw new Error("Upload failed");
        const result = await uploadRes.json();
        onChange([...images, result.publicUrl || targetRes.target.publicUrl || `/uploads/${key}`]);
      } else {
        await fetch(targetRes.target.url, {
          method: targetRes.target.method,
          body: file,
          headers: { "Content-Type": file.type },
        });
        onChange([...images, targetRes.target.publicUrl || ""]);
      }
    } catch {
      // Silently handle upload failure
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="wb-ref-images">
      {images.map((url, i) => (
        <div key={`${url}-${i}`} className="wb-ref-image-thumb">
          <img src={url} alt="" />
          <button
            type="button"
            className="wb-ref-image-remove"
            onClick={() => onChange(images.filter((_, idx) => idx !== i))}
          >
            x
          </button>
        </div>
      ))}
      <button
        type="button"
        className="wb-ref-image-add"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "..." : <><UploadIcon /> {t("worldBible.uploadReferenceImage")}</>}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
