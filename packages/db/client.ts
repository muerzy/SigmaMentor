import { Database } from "bun:sqlite";
/**
 * SQLite 客户端（MVP · bun:sqlite 内置，零部署依赖）。
 *
 * 踩坑修正（HANDOFF 第十节）：路径必须用 new URL() 锚定到源文件所在目录，
 * 不能依赖 cwd——Windows 下 api 从任意目录启动都曾因此连到空库（no such table）。
 * fileURLToPath 完成 Windows 盘符修正（/D:/... → D:/...）与百分号解码。
 * 测试可用 SIGMA_DB_PATH 覆盖（如临时文件）。
 */
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

const url = new URL("./sigmamentor.sqlite", import.meta.url);

export const DB_PATH = process.env.SIGMA_DB_PATH ?? fileURLToPath(url);

export const sqlite = new Database(DB_PATH);

export const db = drizzle({ client: sqlite, schema });

export * from "./schema";
export { schema };
