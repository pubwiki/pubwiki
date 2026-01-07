import { defineConfig } from 'vitest/config';

// E2E 测试配置 - 使用 wrangler unstable_dev 启动真实服务器
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30000, // E2E 测试需要更长的超时时间
    hookTimeout: 30000,
    globals: true,
    // E2E 测试需要串行运行，因为每个测试文件都会启动自己的 worker 实例
    // 并行运行会导致多个 worker 实例访问同一个 D1 数据库产生冲突
    fileParallelism: false,
  },
});
