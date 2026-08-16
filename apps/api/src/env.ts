/**
 * 根目录 .env 加载：bun 默认只读 cwd 下的 .env，workspace 内运行时手动锚定仓库根。
 * 用 ?? 保持已设置的环境变量优先（测试/部署注入不覆盖）。
 */
import { fileURLToPath } from "node:url";

const ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

try {
  process.loadEnvFile(ROOT_ENV);
} catch {
  // 根 .env 不存在时静默——.env.example 复制后即可
}
