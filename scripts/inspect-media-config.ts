import { loadEnvFile } from "node:process";
import { PrismaService } from "../apps/api/src/common/prisma.service";
import { GrokMediaProvider } from "../apps/api/src/jobs/grok-media.provider";
import type { ProviderEntry } from "@dramaflow/shared";
import sharp from "sharp";

loadEnvFile(".env");
const prisma = new PrismaService();
function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(summarize);
  if (!value || typeof value !== "object") return null;
  const config = value as Record<string, unknown>;
  return {
    keys: Object.keys(config),
    provider: config.provider,
    baseUrl: typeof config.baseUrl === "string" ? new URL(config.baseUrl).origin + new URL(config.baseUrl).pathname : undefined,
    model: config.model,
    apiKeyConfigured: typeof config.apiKey === "string" && config.apiKey.length > 0 && config.apiKey !== "replace-me",
    config: config.config ? summarize(config.config) : undefined,
  };
}
async function main() {
  if (process.argv.includes("--probe")) {
    const users = await prisma.user.findMany({ select: { id: true, imageProviders: true } });
    for (const user of users) {
      for (const entry of (user.imageProviders ?? []) as unknown as ProviderEntry[]) {
        if (entry.provider !== "grok" || !entry.apiKey) continue;
        const started = Date.now();
        const baseUrl = process.env.GROK_PROBE_BASE_URL ?? entry.baseUrl;
        const apiKey = process.env.GROK_PROBE_API_KEY ?? entry.apiKey;
        const modelIndex = process.argv.indexOf("--model");
        const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : entry.model;
        if (process.argv.includes("--models")) {
          const response = await fetch(`${baseUrl}${new URL(baseUrl!).pathname.endsWith("/v1") ? "" : "/v1"}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
          console.log("Model discovery HTTP", response.status);
          console.log((await response.text()).replaceAll(apiKey, "<REDACTED>").slice(0, 12000));
          continue;
        }
        try {
          const result = await new GrokMediaProvider().generateImage(
            { prompt: "A simple blue ceramic cup on a plain white table, portrait composition, no text", shotId: "connection-check", style: "studio", aspectRatio: "9:16" },
            { provider: "grok", apiKey, baseUrl, model },
          );
          const metadata = await sharp(result.inlineBody as Buffer).metadata();
          console.log(JSON.stringify({ provider: "grok", model, success: true, width: metadata.width, height: metadata.height, format: metadata.format, elapsedMs: Date.now() - started }));
          if (process.argv.includes("--apply") && model) {
            const entries = user.imageProviders as unknown as ProviderEntry[];
            const updated = await prisma.user.updateMany({
              where: { id: user.id, imageProviders: { equals: user.imageProviders! } },
              data: { imageProviders: JSON.parse(JSON.stringify(entries.map(item => item.id === entry.id ? { ...item, model, baseUrl, apiKey } : item))) },
            });
            if (updated.count !== 1) throw new Error("Configuration changed during verification; update was not applied");
            console.log("Updated verified image model; all other saved settings preserved.");
          }
        } catch (error) {
          console.log(JSON.stringify({ provider: "grok", model, success: false, error: error instanceof Error ? error.message.replaceAll(apiKey, "<REDACTED>") : "Request failed", elapsedMs: Date.now() - started }));
          process.exitCode = 1;
        }
      }
    }
    return;
  }
  for (const [scope, rows] of [
    ["user", await prisma.user.findMany({ select: { imageGenerationConfig: true, imageProviders: true, videoProviders: true } })],
    ["team", await prisma.team.findMany({ select: { imageGenerationConfig: true, imageProviders: true, videoProviders: true } })],
  ] as const) {
    console.log(JSON.stringify({ scope, configurations: rows.map(row => ({ imageGenerationConfig: summarize(row.imageGenerationConfig), imageProviders: summarize(row.imageProviders), videoProviders: summarize(row.videoProviders) })) }, null, 2));
  }
}
main().finally(() => prisma.$disconnect());
