import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Load `.env` from the project root (next to this file), not only from `process.cwd()`,
// so `npx prisma validate` / `migrate` work reliably.
loadEnv({ path: path.join(projectRoot, ".env") });
process.env.DATABASE_URL ??= "file:./dev.db";

export default defineConfig({
  schema: path.join(projectRoot, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(projectRoot, "prisma", "migrations"),
    seed: "node prisma/seed.mjs",
  },
});
