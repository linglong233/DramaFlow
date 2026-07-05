/**
 * @fileoverview 根控制器
 * @module api/app
 *
 * 提供健康检查端点 /health，返回服务状态和当前存储驱动信息。
 * 提供 /health/providers，返回各 AI provider 路径的配置状态。
 */

import { Controller, Get } from "@nestjs/common";

import { resolveProviderHealth, type ProviderHealth } from "./common/config-bootstrap";

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

  /** AI provider 配置状态（不暴露 key 本身，只暴露布尔） */
  @Get("health/providers")
  getProviderHealth(): ProviderHealth {
    return resolveProviderHealth(process.env);
  }
}
