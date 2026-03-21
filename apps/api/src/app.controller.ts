import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
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
