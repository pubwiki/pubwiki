import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
    // 单元测试文件目录 - 排除 e2e 测试
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    // 全局设置
    globals: true,
    // 设置文件 - 用于在测试前初始化数据库
    setupFiles: ['./test/setup.ts'],
  },
});
