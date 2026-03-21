import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import express from "express";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
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
