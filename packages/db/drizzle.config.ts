import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

// SQLite（MVP）。生产切换 PostgreSQL 18 时（PRD I4）：dialect 换 "postgresql"，
// schema 换 pg-core + jsonb()，url 走 DATABASE_URL。
export default defineConfig({
  dialect: "sqlite",
  schema: "./schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: fileURLToPath(new URL("./sigmamentor.sqlite", import.meta.url)),
  },
});
