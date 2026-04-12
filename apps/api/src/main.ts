/**
 * @fileoverview DramaFlow API 服务启动入口
 * @module api/main
 *
 * 初始化 NestJS 应用、配置 CORS、Swagger 文档、并启动 HTTP 服务。
 */

import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import express from "express";

import { AppModule } from "./app.module";

/**
 * 验证 JWT 密钥配置的安全性
 * 生产环境下强制要求安全密钥，开发环境只警告
 */
function validateSecrets() {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  const unsafeValues = [undefined, "", "replace-me", "replace-me-too", "dramaflow-access-secret", "dramaflow-refresh-secret"];

  if (process.env.NODE_ENV === "production") {
    if (!accessSecret || unsafeValues.includes(accessSecret)) {
      throw new Error("JWT_ACCESS_SECRET must be set to a secure value in production");
    }
    if (!refreshSecret || unsafeValues.includes(refreshSecret)) {
      throw new Error("JWT_REFRESH_SECRET must be set to a secure value in production");
    }
  } else {
    if (!accessSecret || unsafeValues.includes(accessSecret)) {
      process.stdout.write("\n⚠️  WARNING: JWT_ACCESS_SECRET is using an unsafe default. Set it in .env for security.\n\n");
    }
  }
}

/** 应用启动函数 */
async function bootstrap() {
  validateSecrets();
  const app = await NestFactory.create(AppModule);
  const allowedOrigin = process.env.APP_URL ?? "http://localhost:3000";
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });
  app.use("/uploads/direct", express.raw({ type: "*/*", limit: "100mb" }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("DramaFlow API")
    .setDescription("Director-facing short drama generation platform API")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  process.stdout.write(`DramaFlow API listening on http://localhost:${port}\n`);
}

bootstrap();
