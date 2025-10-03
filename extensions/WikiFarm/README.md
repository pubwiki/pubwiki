# WikiFarm 扩展（规范草案）

面向 MediaWiki 1.44 的最小化规范，提供一个基于 Codex 的 `Special:WikiFarm` 首页，以及一组 REST 代理端点调用后端微服务。该扩展不实现创建逻辑，仅负责 UI 与 API 代理，并负责在共享 MariaDB 上创建所需数据表。

本规范已根据以下约束调整：
- UI 框架：Codex（Vue 3 + ResourceLoader）
- 进度反馈：仅使用 SSE（Server-Sent Events），不做轮询降级
- 数据库：扩展负责在 MediaWiki 的 MariaDB 实例上创建/维护所需表；微服务复用同一实例
- 安全：当前仅单机部署，不做服务间鉴权（后续可加）

## 功能概述

- SpecialPage `Special:WikiFarm` 作为 wikifarm 首页，未登录时强调登录；登录后展示“我的 Wikis”和“创建新 Wiki”。
- 右侧/下方展示“精选 Wikis（Featured）”。
- 创建 Wiki 时，调用扩展的 REST 代理转发到 Rust 微服务；返回 `task_id` 后通过 SSE 订阅进度。

## UI 布局与组件（Codex）

- 响应式布局
  - 桌面端：左右分栏（左：登录表单；右：内容区）
  - 移动端：上下分栏（上：登录表单；下：内容区）
- 左/上：登录区域
  - 优先用 MW `clientlogin` API 于前端完成登录；如遇 2FA/复杂流程，提供跳转 `Special:UserLogin` 的入口。
- 右/下：三个模块
  1) Featured Wikis 列表（公开可见）
  2) 我的 Wikis（需登录）
  3) 创建新 Wiki 表单（需登录，有 `create-wiki` 权限）
- 组件建议：
  - 布局：Codex grid / stack
  - 表单：`CdxTextInput`, `CdxSelect`, `CdxButton`, `CdxMessage`
  - 进度：`CdxProgressBar`（仅作为装饰，真实进度由 SSE 驱动）

> 前端仅依赖 ResourceLoader 模块，不引入外部打包工具。建议一个主入口模块（例如 `ext.wikifarm.ui`）并拆分子模块（表单、列表、SSE 订阅器）。

## SpecialPage

- 名称：`WikiFarm`（路径 `Special:WikiFarm`）
- 责任：渲染容器与必要初始数据（登录状态、用户名、i18n 文案），加载前端模块。
- 文案：通过 i18n（`i18n/*.json`）提供多语言（至少 `en`、`zh-hans`）。

## REST 代理端点（扩展提供，转发到服务）

前缀示例：`/rest.php/wikifarm/v1`。

- POST `/wikis`
  - 功能：提交创建请求
  - 权限：需登录且拥有 `create-wiki` 权限
  - 请求体（JSON）：
    - `name`（string）
    - `slug`（string，作为子域/路径唯一标识）
    - `language`（string，如 `zh-hans`, `en`）
    - `template`（string，可选）
    - `visibility`（`public|private|unlisted`，可选，默认 `public`）
  - 由扩展注入身份：`owner` 对象（来自当前登录用户），形如 `{ id: number, username: string }`
  - 响应：`202 { task_id: string }`

- GET `/wikis/featured`
  - 功能：获取精选 wikis 列表（分页可选）
  - 响应：`{ wikis: Wiki[], next_offset?: number }`
  - 说明：扩展内部转发到服务端 `GET /provisioner/v1/wikis?featured=1`（基础 URL 由 `$wgWikiFarmServiceURL` 配置）

- GET `/users/me/wikis`
  - 功能：获取当前用户创建的 wikis
  - 响应：`{ wikis: Wiki[] }`
  - 说明：扩展根据当前登录用户 ID 转发到服务端 `GET /provisioner/v1/users/{user_id}/wikis`

- GET `/tasks/{task_id}/events`
  - 功能：SSE 代理，转发后端事件流
  - 响应头：`Content-Type: text/event-stream`，`Cache-Control: no-cache`
  - 事件：`progress`/`status`，`data` 为 JSON
  - 说明：扩展直接将服务端 `GET /provisioner/v1/tasks/{task_id}/events` 的事件流透传给前端

> 注：根据“仅使用 SSE”的约束，不提供轮询用的 `GET /tasks/{id}` 普通查询端点。

### 代理实现要点

- 权限：创建端点需 `create-wiki` 权限；列表端点公开/登录可见分别控制。
- 参数校验：在扩展层做基础验证（必填、长度、slug 合法字符、保留字）。
- 转发：使用 HTTP 客户端请求 Rust 服务（基础 URL 由配置提供），不做鉴权签名（当前阶段）。
- SSE 代理：
  - 设置合适的 headers 并逐块转发 `data:`/`event:` 行；
  - 确保输出缓冲关闭/刷新（`flush()`），避免 FastCGI 缓冲阻塞；
  - 建议在 Nginx/Apache 层开启对 `text/event-stream` 的合适代理设置（禁用 gzip，减小代理缓冲）。

## 数据库（由扩展创建）

- 目标：在 MediaWiki 连接的 MariaDB 上创建与维护表结构（InnoDB）。
- 文件：`extension/sql/tables.sql`（见同仓库文件）
- 升级：通过 `LoadExtensionSchemaUpdates` 在安装/升级时应用。
- 表：
  - `wikifarm_wikis`：wiki 元数据
  - `wikifarm_tasks`：异步任务（创建）与进度

> 微服务不负责迁移或变更表结构（只读/读写数据），以避免 schema 竞争。

## 配置项（LocalSettings.php）

- `$wgWikiFarmServiceURL`：后端服务基础地址（如 `http://127.0.0.1:8080/provisioner/v1`）
- `$wgGroupPermissions['user']['create-wiki'] = true;`（示例）
- `$wgWikiFarmFeaturedPageSize = 20;`（可选）

## 数据模型（摘要）

- Wiki
  - `id, name, slug, domain?, path?, language, owner_user_id, owner_username, visibility, status, is_featured, created_at, updated_at`
- Task（创建）
  - `id(UUID), type(create_wiki), status(queued|running|succeeded|failed), progress(0-100), message, wiki_id?, created_by, created_at, started_at?, finished_at?`

## SSE 事件格式

后端事件采用带标签的 JSON，对应两种事件名（`progress` 与 `status`），payload 内含 `type` 字段（与事件名一致，均为小写）。

- 进度事件（event: `progress`）
  - 数据结构：
    - `type`: `"progress"`
    - `status`: `"queued" | "running"`
    - `message?`: string（可选，提示信息）
    - `phase?`: `"dir_copy" | "render_ini" | "db_provision" | "oauth" | "docker_install" | "docker_index_cfg" | "flip_bootstrap" | "index"`（可选，当前阶段）
  - 示例：
    - `{"type":"progress","status":"queued","message":"queued"}`
    - `{"type":"progress","status":"running","phase":"db_provision","message":"db provision"}`

- 状态事件（event: `status`）
  - 成功：`{"type":"status","status":"succeeded","wiki_id":123}`
  - 失败：`{"type":"status","status":"failed","message":"provision error: ..."}`

## 后续可扩展（非本阶段）

- 服务间鉴权（HMAC/JWT/MTLS）
- 速率限制与审计
- 模板 wiki 克隆、审批/配额