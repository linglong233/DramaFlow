/**
 * @fileoverview 存储 Provider 接口定义
 * @module shared/storage
 *
 * 定义文件存储的抽象接口，支持本地磁盘和 S3 兼容对象存储两种实现。
 */

import type { UploadTarget } from "./domain";

/** 上传对象输入参数 */
export interface PutObjectInput {
  /** 存储键名 */
  key: string;
  /** 文件内容 */
  body: Buffer | string;
  /** MIME 类型 */
  contentType: string;
}

/** 创建上传目标输入参数 */
export interface CreateUploadTargetInput {
  /** 存储键名 */
  key: string;
  /** MIME 类型 */
  contentType: string;
}

/** 存储 Provider 统一接口 */
export interface StorageProvider {
  /** 上传对象到存储 */
  putObject(input: PutObjectInput): Promise<{ key: string; publicUrl?: string }>;
  /** 获取对象的访问 URL */
  getObjectUrl(key: string): Promise<string>;
  /** 读取对象内容 */
  readObject(key: string): Promise<Uint8Array>;
  /** 删除对象 */
  deleteObject(key: string): Promise<void>;
  /** 复制对象 */
  copyObject(sourceKey: string, targetKey: string): Promise<{ key: string; publicUrl?: string }>;
  /** 创建前端直传的上传目标 */
  createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTarget>;
}
