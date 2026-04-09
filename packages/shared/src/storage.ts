import type { UploadTarget } from "./domain";

export interface PutObjectInput {
  key: string;
  body: Buffer | string;
  contentType: string;
}

export interface CreateUploadTargetInput {
  key: string;
  contentType: string;
}

export interface StorageProvider {
  putObject(input: PutObjectInput): Promise<{ key: string; publicUrl?: string }>;
  getObjectUrl(key: string): Promise<string>;
  readObject(key: string): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  copyObject(sourceKey: string, targetKey: string): Promise<{ key: string; publicUrl?: string }>;
  createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTarget>;
}
