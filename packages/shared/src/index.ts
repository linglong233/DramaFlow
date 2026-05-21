/**
 * @fileoverview 共享包入口文件
 * @module shared
 *
 * 统一导出所有共享类型、接口、枚举和工具函数。
 * 前端、后端、Worker 统一从此入口导入共享契约。
 */

export * from "./api-contracts";
export * from "./business-rules";
export * from "./domain";
export * from "./impact-rules";
export * from "./project-permissions";
export * from "./providers";
export * from "./storyboard";
export * from "./storage";
export * from "./document-content";
export * from "./version-diff";
