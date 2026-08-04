/**
 * @fileoverview Next.js 配置
 * @module web
 *
 * Next.js 构建和运行时配置。
 */

import { cp, mkdir, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { NextConfig } from "next";

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
  experimental: {
    // Windows 上禁用 webpack build worker / worker threads 以规避长路径与文件监听问题；
    // 其他平台同样关闭以保持一致行为（构建以单线程串行运行更稳定）。
    webpackBuildWorker: false,
    workerThreads: false,
  },
  compiler: {
    runAfterProductionCompile: async ({ distDir, projectDir }) => {
      await mirrorServerChunks(projectDir, distDir);
    },
  },
};

export default nextConfig;
