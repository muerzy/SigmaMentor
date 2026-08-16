/**
 * 全局测试 setup：每个 bun test 进程把数据库指到临时文件，
 * 绝不碰 packages/db/sigmamentor.sqlite（开发库）。
 * bunfig.toml [test].preload 在任何 import 前执行。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.SIGMA_DB_PATH) {
  process.env.SIGMA_DB_PATH = join(mkdtempSync(join(tmpdir(), "sigma-test-")), "test.sqlite");
}
process.env.LLM_MODE ??= "off";
