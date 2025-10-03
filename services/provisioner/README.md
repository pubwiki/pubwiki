# WikiFarm 微服务（规范草案）

实现 MediaWiki 扩展所代理的创建/列表/进度接口。服务使用与 MediaWiki 相同的 MariaDB 实例，并直接读写由扩展创建和维护的表（`wikifarm_wikis`, `wikifarm_tasks`）。

已按约束设计：
- 仅 SSE 反馈创建进度，不提供轮询查询
- 不做服务间鉴权（单机部署），未来可扩展
- 表结构由扩展负责迁移，本服务不创建/修改表

## 技术栈建议

- Web：Axum（Tokio/Tower）或 Actix-web
- DB：sqlx（MariaDB/MySQL 驱动），采用连接池
- 日志：tracing
- 配置：环境变量（如 `DATABASE_URL`, `BIND_ADDR`）

## API 契约（v1）

Base URL 示例：`/provisioner/v1`

- POST `/wikis`
  - 说明：创建 wiki（异步）
  - 请求（JSON）：
    - `name`: string
    - `slug`: string（唯一标识）
    - `language`: string（`zh-hans`/`en` 等）
    - `template`?: string
    - `visibility`?: `public|private|unlisted`（默认 `public`）
    - `owner`: { `id`: number, `username`: string }（由扩展注入）
  - 响应：`202 { "task_id": "uuid" }`
  - 语义：写入 `wikifarm_tasks`（status=queued, progress=0），并准备由 Worker 执行

- GET `/wikis`（仅用于精选）
  - 查询参数：`featured=1`、`limit`、`offset`
  - 响应：`{ wikis: Wiki[], next_offset?: number }`

- GET `/users/{user_id}/wikis`
  - 响应：`{ wikis: Wiki[] }`

- GET `/tasks/{task_id}/events`（SSE）
  - 响应头：`Content-Type: text/event-stream`，`Cache-Control: no-cache`
  - 事件：
    - `event: progress`，`data: { type: "progress", status: queued|running, progress: number, message?, phase? }`
    - `event: status`，`data: { type: "status", status: succeeded|failed, wiki_id?, message? }`

示例：

```text
event: progress
data: {"type":"progress","status":"running","progress":60,"message":"install site","phase":"docker_install"}

event: status
data: {"type":"status","status":"succeeded","wiki_id":123}
```

> 普通 JSON 方式的 `GET /tasks/{id}` 暂不提供。

## 数据表（由扩展创建）

- 见 `extension/sql/tables.sql`。
- 仅说明约束：
  - `wikifarm_wikis.slug` 唯一
  - `wikifarm_tasks.id` 为 UUID 字符串（36 字符）
  - 外键 `wikifarm_tasks.wiki_id -> wikifarm_wikis.id`
 - 若历史实例缺少唯一索引，可应用 `extension/sql/20250928_add_unique_index_wikifarm_wikis_slug.sql`

## 任务生命周期

- `queued` → `running` → `succeeded`/`failed`
- Worker 负责：
  1) 校验 `slug` 未占用
  2) 创建数据库/初始化（通过维护脚本或内部 provisioner）
  3) 填充 `wikifarm_wikis`（status=pending→ready）
  4) 更新 `wikifarm_tasks.progress` 与 `status`，并向 SSE 推送事件
- 异常处理：
  - 任一步失败：`status=failed`，记录 `message`，必要时回滚（删除残留 DB/配置）

## SSE 推送策略

- 服务端持有每个 `task_id` 的广播句柄；状态变化时发送事件
- 事件节流：避免过于密集（例如每步关键阶段或进度整点）
- 连接存活：server 发送注释/心跳行（`:\n`）防代理超时（可选）

## 错误码

- 400：参数错误
- 409：命名冲突（`slug` 已存在）
- 429：限流（未来）
- 500：内部错误

## 参考实现结构（Axum 示例）

- 二进制：
  - `api`：对外 HTTP（路由：/wikis, /users/*/wikis, /tasks/*/events）
  - `worker`：后台执行器（可与 `api` 同进程不同任务，或独立进程）
- 模块：
  - `db`（sqlx Pool，查询封装）
  - `models`（Wiki/Task 数据结构）
  - `sse`（Task 事件总线：`tokio::sync::broadcast` 或 `tokio::sync::watch`）
  - `provision`（与 MediaWiki 维护脚本/内部服务交互）

## 环境变量

- `DATABASE_URL`（示例：`mysql://user:pass@127.0.0.1:3306/mediawiki`）
- `BIND_ADDR`（示例：`0.0.0.0:8080`）

## OpenAPI


## 开发与测试建议

---

## MVP 运行方式

本仓库提供一个使用 Axum 的服务骨架（见 `src/main.rs`），已接入 MySQL 与 Redis 队列：

- POST `/provisioner/v1/wikis`：检查 `slug` 唯一性（MySQL），入队到 Redis（list `wikifarm:jobs`），并通过 PubSub 频道 `wikifarm:tasks/{task_id}` 推送 `queued` 事件
- GET `/provisioner/v1/tasks/{task_id}/events`：`text/event-stream`，从 Redis PubSub 订阅该任务频道，转发 `progress` 和最终 `status` 事件
- GET `/provisioner/v1/wikis`、GET `/provisioner/v1/users/{user_id}/wikis`：已实现数据库查询（精选支持分页 `limit/offset`）
- GET `/health`：返回 `ok`

### 启动（fish）

```fish
# 在 service 目录，确保环境变量：
set -x DATABASE_URL 'mysql://user:pass@127.0.0.1:3306/mediawiki'
set -x REDIS_URL 'redis://127.0.0.1/'
set -x BIND_ADDR '127.0.0.1:8080'

cargo run
```

### 快速验证

```fish
# 创建一个任务
curl -s -X POST http://127.0.0.1:8080/provisioner/v1/wikis \
  -H 'content-type: application/json' \
  -d '{"name":"Demo","slug":"demo"}'

# 得到 task_id 后连到 SSE（示例用 jq 提取）
set -l TASK (curl -s -X POST http://127.0.0.1:8080/provisioner/v1/wikis -H 'content-type: application/json' -d '{"name":"Demo2","slug":"demo2"}' | jq -r .task_id)

curl -N http://127.0.0.1:8080/provisioner/v1/tasks/$TASK/events
```

### 后续工作

- 完成列表查询（精选、用户）与分页
- 将示例 Worker 替换为真实安装/初始化流程，并更新 DB 状态
- 引入任务清理、错误上报与指标
- 注意：生产环境代理需正确处理 `text/event-stream`（禁用缓冲/gzip）

### 安全说明

- 数据库初始化过程避免了拼接多语句和直接格式化注入：
  - 标识符（数据库名、用户名）采用严格白名单校验（仅 ASCII 字母、数字、下划线、连字符，最长 64），并用反引号包裹；
  - 字符串字面量（例如密码）通过将单引号加倍进行转义；
  - 所有语句拆分为单条依次执行（不使用多语句执行）。
  这些措施保证在无法用占位符绑定标识符的管理类 SQL 中，仍然规避 SQL 注入风险。
