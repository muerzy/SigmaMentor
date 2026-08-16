/**
 * 迁移执行：drizzle-kit generate 生成 SQL，本脚本用 drizzle-orm/bun-sqlite/migrator 应用。
 * 不用 `drizzle-kit migrate`——它走 node driver，与 bun:sqlite 不匹配（HANDOFF 踩坑表）。
 */
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { db } from "./client";

const migrationsFolder = fileURLToPath(new URL("./drizzle", import.meta.url));

await migrate(db, { migrationsFolder });

console.info(`[db] migrations applied -> ${migrationsFolder}`);
