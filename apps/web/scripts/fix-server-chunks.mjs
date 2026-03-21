import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const serverDir = join(process.cwd(), ".next", "server");
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

void main();