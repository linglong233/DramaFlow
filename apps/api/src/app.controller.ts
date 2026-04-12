/**
 * @fileoverview 根控制器
 * @module api/app
 *
 * 提供健康检查端点 /health，返回服务状态和当前存储驱动信息。
 */

import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  /** 健康检查端点 */
  @Get("health")
  getHealth() {
    return {
      ok: true,
      service: "dramaflow-api",
      time: new Date().toISOString(),
      storageDriver: process.env.STORAGE_DRIVER ?? "local",
    };
  }
}
