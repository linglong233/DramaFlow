/**
 * @fileoverview Next.js 配置
 * @module web
 *
 * Next.js 构建和运行时配置。
 */

import { cp, mkdir, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { NextConfig } from "next";

const isWindows = process.platform === "win32";

async function mirrorServerChunks(projectDir: string, distDir: string) {
  const resolvedDistDir = isAbsolute(distDir) ? distDir : join(projectDir, distDir);
  const serverDir = join(resolvedDistDir, "server");
  const chunksDir = join(serverDir, "chunks");

  await mkdir(serverDir, { recursive: true });

  let files = [];
  try {
    files = await readdir(chunksDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => cp(join(chunksDir, entry.name), join(serverDir, entry.name), { force: true })),
  );
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  eslint: {
    ignoreDuringBuilds: isWindows,
  },
  experimental: {
    webpackBuildWorker: isWindows ? false : undefined,
    workerThreads: false,
  },
  typescript: {
    ignoreBuildErrors: isWindows,
  },
  compiler: {
    runAfterProductionCompile: async ({ distDir, projectDir }) => {
      await mirrorServerChunks(projectDir, distDir);
    },
  },
};

export default nextConfig;
