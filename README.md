# PubWiki - AI 友好的 MediaWiki 农场

<div align="center">

**一个现代化的、面向 AI 时代的 MediaWiki 农场解决方案**

[English](README_EN.md) | 简体中文

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MediaWiki](https://img.shields.io/badge/MediaWiki-1.44-green.svg)](https://www.mediawiki.org/)

</div>

> ⚠️ **警告**：本项目仍在积极开发中，请勿在生产环境使用。

## 📖 目录

- [简介](#简介)
- [特性](#特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [部署指南](#部署指南)
- [开发指南](#开发指南)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 简介

PubWiki 是一个基于 MediaWiki 的多租户农场系统，旨在让创建和管理多个 Wiki 实例变得简单高效。通过现代化的技术栈和自动化的部署流程，用户可以快速创建和管理独立的 Wiki 站点。

### 为什么选择 PubWiki？

- 🚀 **快速部署**：通过自动化工具快速创建新的 Wiki 实例
- 🔄 **统一管理**：集中管理多个 Wiki 站点，共享用户系统
- 🎨 **现代化界面**：基于 Codex（Vue 3）的友好用户界面
- 📡 **实时反馈**：通过 SSE 实时推送 Wiki 创建进度
- 🐳 **容器化部署**：完全容器化，易于部署和扩展
- 🤖 **AI 友好**：专为 AI 时代设计的架构和接口

## 特性

### 核心功能

- ✅ **多租户支持**：一套系统支持无限个独立 Wiki 站点
- ✅ **共享用户系统**：跨 Wiki 的统一用户认证和管理
- ✅ **可视化管理界面**：`Special:WikiFarm` 特殊页面提供完整的管理功能
- ✅ **异步任务处理**：后台异步创建 Wiki，不阻塞用户操作
- ✅ **实时进度反馈**：基于 SSE 的实时创建进度推送
- ✅ **模板系统**：预配置的 MediaWiki 模板快速部署

### MediaWiki 扩展

#### WikiFarm 扩展

提供核心的农场管理功能：

- **用户界面**
  - 精选 Wiki 展示
  - 我的 Wiki 列表
  - 创建新 Wiki 向导
  - 实时创建进度展示

- **REST API 代理**
  - `POST /rest.php/wikifarm/v1/wikis` - 创建 Wiki
  - `GET /rest.php/wikifarm/v1/wikis/featured` - 获取精选 Wiki 列表
  - `GET /rest.php/wikifarm/v1/users/me/wikis` - 获取用户的 Wiki
  - `GET /rest.php/wikifarm/v1/tasks/{task_id}/events` - SSE 进度订阅

- **数据库表**
  - `wikifarm_wikis` - Wiki 元数据
  - `wikifarm_tasks` - 异步任务跟踪

#### WikiManage 扩展

提供 Wiki 管理功能的扩展。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                        Traefik                          │
│                    (反向代理/负载均衡)                    │
└───────────┬─────────────────────────────┬───────────────┘
            │                             │
            ▼                             ▼
┌───────────────────────┐     ┌──────────────────────────┐
│   MediaWiki Farm      │     │   Provisioner Service    │
│   (PHP-FPM + Nginx)   │────▶│      (Rust/Axum)         │
│                       │     │                          │
│  - WikiFarm Extension │     │  - Wiki 创建服务         │
│  - 共享用户系统        │     │  - 任务调度器            │
│  - REST API 代理      │     │  - SSE 事件推送          │
└───────────┬───────────┘     └──────────┬───────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────┐
│                      MariaDB                            │
│                   (共享数据库)                           │
│                                                         │
│  - 共享用户表 (user, user_properties, actor)            │
│  - WikiFarm 元数据表                                     │
│  - 各 Wiki 独立数据库                                    │
└─────────────────────────────────────────────────────────┘
```

### 组件说明

1. **Traefik**：提供反向代理、TLS 终止、自动路由
2. **MediaWiki Farm**：主 Wiki 农场应用，处理用户请求
3. **Provisioner Service**：用 Rust 编写的微服务，负责 Wiki 创建和管理
4. **MariaDB**：关系型数据库，存储所有数据

## 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- Git
- [Just](https://github.com/casey/just) (可选，用于构建脚本)

### 本地开发环境

1. **克隆仓库**

```bash
git clone https://github.com/pubwiki/pubwiki.git
cd pubwiki
```

2. **启动基础设施服务**

```bash
cd deploy/infra
cp .env.example .env  # 编辑配置文件
docker compose up -d
```

3. **启动数据库服务**

```bash
cd deploy/dev
docker compose up -d
```

4. **构建并启动应用服务**

```bash
# 使用 Just 构建镜像
just template v1.0
just wikifarm v1.0
just provisioner v1.0

# 或手动构建
cd deploy/app/mediawikifarm
docker compose up -d
```

5. **访问应用**

- 主 Wiki：`http://localhost` 或配置的域名
- WikiFarm 管理页面：`http://localhost/wiki/Special:WikiFarm`
- Traefik 仪表板：`http://localhost:8080`

## 部署指南

### 生产环境部署

详细部署流程请参见 [deploy/README.md](deploy/README.md)。

#### 目录结构

```
$WORKDIR/
├── infra/              # 基础设施服务
│   ├── .env           # 环境变量配置
│   └── traefik/       # Traefik 配置
├── dev/               # 开发服务
│   └── mariadb/       # MariaDB 配置
└── app/               # 应用服务
    ├── mainwiki/      # 主 Wiki
    └── mediawikifarm/ # Wiki 农场
        ├── template/  # MediaWiki 部署模板
        └── wikis/     # 各个 Wiki 实例
            ├── wiki1/
            ├── wiki2/
            └── ...
```

#### 创建新 Wiki 的流程

1. **构建部署模板**（如果还没有）

```bash
cd $WORKDIR/app/mediawikifarm/template
docker run --rm -v .:/template m4tsuri/pubwiki-template:v1.2
```

2. **创建 Wiki 目录**

```bash
export WIKINAME=mywiki
cp -r $WORKDIR/app/mediawikifarm/template/mediawiki-1.44.0 \
      $WORKDIR/app/mediawikifarm/wikis/$WIKINAME
```

3. **配置 Wiki**

编辑 `$WORKDIR/app/mediawikifarm/wikis/$WIKINAME/pubwiki.ini`：

```ini
WIKI_SITE_NAME = 我的Wiki
WIKI_HOST_URL = https://mywiki.example.com
WIKI_META_NAMESPACE = Project

WIKI_DB_HOST = mariadb
WIKI_DB_NAME = mywiki_db
WIKI_DB_USER = mywiki_user
WIKI_DB_PASSWORD = secure_password
WIKI_SHARED_DB_NAME = shared_db

WIKI_LANG = zh-hans
```

4. **创建数据库和用户**

```sql
CREATE DATABASE IF NOT EXISTS mywiki_db;
CREATE USER IF NOT EXISTS 'mywiki_user'@'%' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON mywiki_db.* TO 'mywiki_user'@'%';
GRANT SELECT, UPDATE, INSERT ON shared_db.user TO 'mywiki_user'@'%';
GRANT SELECT, UPDATE, INSERT ON shared_db.user_properties TO 'mywiki_user'@'%';
GRANT SELECT, UPDATE, INSERT ON shared_db.actor TO 'mywiki_user'@'%';
FLUSH PRIVILEGES;
```

5. **生成 OAuth 密钥**

```bash
mkdir -p /path/to/oauth && cd /path/to/oauth
openssl genrsa -out oauth.key 2048
openssl rsa -in oauth.key -pubout -out oauth.cert
chown -R www-data:www-data .
```

6. **初始化 Wiki**

```bash
php /var/www/html/maintenance/installPreConfigured.php
php /var/www/html/maintenance/createAndPromote.php admin password123 \
    --sysop --bureaucrat --force
```

### 自动化部署

通过 Provisioner 服务，可以通过 API 自动完成上述流程：

```bash
curl -X POST http://localhost:8080/provisioner/v1/wikis \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的Wiki",
    "slug": "mywiki",
    "language": "zh-hans",
    "visibility": "public",
    "owner": {
      "id": 1,
      "username": "admin"
    }
  }'
```

## 开发指南

### 构建项目

使用 Just 命令（需要先安装 [Just](https://github.com/casey/just)）：

```bash
# 构建模板镜像
just template v1.0

# 构建 Wiki 农场镜像
just wikifarm v1.0

# 构建主 Wiki 镜像
just mainwiki v1.0

# 构建 MariaDB 镜像
just mariadb v1.0

# 构建 Provisioner 服务镜像
just provisioner v1.0
```

### 开发 WikiFarm 扩展

```bash
cd extensions/WikiFarm

# 前端开发（使用 ResourceLoader）
# 编辑 resources/ext.wikifarm/src/App.vue
# MediaWiki 会自动处理前端资源

# 后端开发
# 编辑 includes/ 目录下的 PHP 文件
```

### 开发 Provisioner 服务

```bash
cd services/provisioner

# 运行开发服务器
cargo run

# 运行测试
cargo test

# 构建发布版本
cargo build --release
```

### API 测试

```bash
# 创建 Wiki
curl -X POST http://localhost:8080/provisioner/v1/wikis \
  -H "Content-Type: application/json" \
  -d @examples/create_wiki.json

# 订阅创建进度（SSE）
curl -N http://localhost:8080/provisioner/v1/tasks/{task_id}/events

# 列出公共 Wiki
curl http://localhost:8080/provisioner/v1/wikis/public?limit=20
```

## 项目结构

```
pubwiki/
├── deploy/                    # 部署配置
│   ├── infra/                # 基础设施（Traefik）
│   ├── dev/                  # 开发环境（MariaDB）
│   └── app/                  # 应用服务
│       ├── mainwiki/         # 主 Wiki 容器配置
│       └── mediawikifarm/    # Wiki 农场容器配置
│           ├── nginx/        # Nginx 配置
│           ├── php-fpm/      # PHP-FPM 配置
│           └── template/     # MediaWiki 模板
├── extensions/               # MediaWiki 扩展
│   ├── WikiFarm/            # 核心农场扩展
│   │   ├── includes/        # PHP 后端代码
│   │   ├── resources/       # 前端资源（Vue 3 + Codex）
│   │   ├── i18n/           # 国际化文件
│   │   └── sql/            # 数据库架构
│   └── WikiManage/          # Wiki 管理扩展
├── services/                # 微服务
│   └── provisioner/         # Wiki 创建服务（Rust）
│       ├── src/            # 源代码
│       ├── tests/          # 测试
│       └── examples/       # 示例代码
├── Justfile                 # 构建脚本
├── LICENSE                  # 许可证
└── README.md               # 本文件
```

## 技术栈

### 前端
- **Vue 3** - 渐进式 JavaScript 框架
- **Codex** - Wikimedia 设计系统
- **ResourceLoader** - MediaWiki 资源加载器
- **Server-Sent Events (SSE)** - 实时进度推送

### 后端
- **MediaWiki 1.44** - Wiki 引擎
- **PHP 8.1+** - MediaWiki 运行环境
- **Rust** - Provisioner 微服务语言
- **Axum** - 异步 Web 框架
- **Tokio** - 异步运行时

### 基础设施
- **Docker** - 容器化
- **Docker Compose** - 容器编排
- **Nginx** - Web 服务器
- **PHP-FPM** - PHP 进程管理器
- **Traefik** - 反向代理和负载均衡
- **MariaDB** - 关系型数据库

### 开发工具
- **Just** - 命令运行器
- **Cargo** - Rust 包管理器
- **Composer** - PHP 依赖管理

## 配置说明

### MediaWiki 配置

在 `LocalSettings.php` 中添加：

```php
// WikiFarm 服务配置
$wgWikiFarmServiceURL = 'http://provisioner:8080/provisioner/v1';

// 创建 Wiki 权限
$wgGroupPermissions['user']['create-wiki'] = true;

// 精选 Wiki 分页大小
$wgWikiFarmFeaturedPageSize = 20;
```

### 环境变量

Provisioner 服务环境变量：

```env
DATABASE_URL=mysql://user:password@mariadb:3306/shared_db
BIND_ADDR=0.0.0.0:8080
RUST_LOG=info
```

## API 文档

完整的 API 文档请参见：
- [Provisioner OpenAPI 规范](services/provisioner/openapi.yaml)
- [WikiFarm 扩展 API 文档](extensions/WikiFarm/README.md)

### 主要端点

#### 创建 Wiki
```http
POST /provisioner/v1/wikis
Content-Type: application/json

{
  "name": "示例Wiki",
  "slug": "example",
  "language": "zh-hans",
  "visibility": "public",
  "owner": {
    "id": 1,
    "username": "admin"
  }
}
```

#### 订阅创建进度
```http
GET /provisioner/v1/tasks/{task_id}/events
Accept: text/event-stream
```

## 常见问题

### Q: 如何更改 Wiki 的语言？
A: 编辑 Wiki 的 `pubwiki.ini` 文件中的 `WIKI_LANG` 参数。

### Q: 如何备份 Wiki 数据？
A: 备份对应的 MariaDB 数据库和 Wiki 文件目录。

### Q: 支持哪些 MediaWiki 版本？
A: 目前支持 MediaWiki 1.44+。

### Q: 可以自定义 Wiki 模板吗？
A: 可以，修改 `deploy/app/mediawikifarm/template/` 目录下的模板文件。

## 贡献指南

我们欢迎所有形式的贡献！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 开发规范

- 遵循现有代码风格
- 添加适当的测试
- 更新相关文档
- 保持提交信息清晰明确

## 路线图

- [ ] 完善 Web UI 界面
- [ ] 添加 Wiki 删除功能
- [ ] 实现 Wiki 备份和恢复
- [ ] 支持更多 MediaWiki 扩展
- [ ] 添加监控和日志系统
- [ ] 实现多节点部署支持
- [ ] OAuth 2.0 集成
- [ ] REST API 完整文档

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 致谢

- [MediaWiki](https://www.mediawiki.org/) - 强大的 Wiki 引擎
- [Wikimedia Foundation](https://wikimediafoundation.org/) - Codex 设计系统
- 所有贡献者

## 联系方式

- 项目主页：https://github.com/pubwiki/pubwiki
- 问题反馈：https://github.com/pubwiki/pubwiki/issues

---

<div align="center">

**[⬆ 回到顶部](#pubwiki---ai-友好的-mediawiki-农场)**

Made with ❤️ by PubWiki Team

</div>
