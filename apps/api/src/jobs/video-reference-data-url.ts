/**
 * @fileoverview 视频参考图 Data URL 压缩工具
 * @module api/jobs
 *
 * 将图片缓冲区压缩为有界 Data URL，用于视频生成 Provider 的内联参考图传输。
 */

import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

const MIB = 1024 * 1024;

export interface VideoReferenceDataUrlOptions {
  maxDimension: number;
  jpegQuality: number;
  maxBytes: number;
}

export interface VideoReferenceDataUrlResult {
  dataUrl: string;
  mimeType: string;
  sizeInBytes: number;
}

export const DEFAULT_VIDEO_REFERENCE_DATA_URL_OPTIONS: VideoReferenceDataUrlOptions = {
  maxDimension: 1536,
  jpegQuality: 82,
  maxBytes: 4 * MIB,
};

/**
 * 将图片缓冲区压缩为有界 Data URL。
 * 自动根据源图是否含 Alpha 通道选择输出格式（PNG 或 JPEG），
 * 并在压缩后检查是否超过最大字节数限制。
 */
export async function buildVideoReferenceDataUrl(
  body: Uint8Array,
  mimeType: string,
  options: VideoReferenceDataUrlOptions = DEFAULT_VIDEO_REFERENCE_DATA_URL_OPTIONS,
): Promise<VideoReferenceDataUrlResult> {
  if (!mimeType.startsWith("image/")) {
    throw new BadRequestException("Video reference assets must be images.");
  }

  const source = Buffer.from(body);
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source, { failOn: "none" }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown image decode error";
    throw new BadRequestException(`Video reference image could not be decoded: ${message}`);
  }

  const hasAlpha = metadata.hasAlpha === true;
  const pipeline = sharp(source, { failOn: "none" })
    .rotate()
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  try {
    const outputMimeType = hasAlpha ? "image/png" : "image/jpeg";
    const output = hasAlpha
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.jpeg({ quality: options.jpegQuality, mozjpeg: true }).toBuffer();

    if (output.byteLength > options.maxBytes) {
      throw new BadRequestException(
        `Video reference image is too large after compression: ${output.byteLength} bytes exceeds ${options.maxBytes} bytes.`,
      );
    }

    return {
      dataUrl: `data:${outputMimeType};base64,${output.toString("base64")}`,
      mimeType: outputMimeType,
      sizeInBytes: output.byteLength,
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown image compression error";
    throw new BadRequestException(`Video reference image could not be compressed: ${message}`);
  }
}
