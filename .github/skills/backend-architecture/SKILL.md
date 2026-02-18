---
name: Backend Architecture Overview
description: This skill tells you the current backend architecture. This is considered a preliminary document before developing the backend part of this project Pub.Wiki
---

## 产品简介

我们的产品是一个依托于AI生成内容的UGC平台。在用户侧，这个平台分为两部分：

1. 一个用于内容创作的工作站（Studio）：这一部分是一个用户可编辑的流图，我们将一个流图称为一个Artifact。我们最终实现的效果是用户能够完全通过对流图的操作，在AI的帮助下创作他自己的，带有持久化状态支持AI游戏，同时他还能把可复用的部分分享出去，在创作的过程中也能复用来自其他用户的成果。为了实现这一点，我们实现了一种兼顾创作和架构设计的结构。 其中节点的种类分为以下几种：
   - PROMPT：内容是文本，用于承载用户编写的Prompt
     - 入边：通过特殊的语法引用其他节点中的文本内容
       - PROMPT
       - GENERATED
     - 出边：
       - PROMPT
       - INPUT
   - INPUT：内容同样是文本，用户承载一次会话，用户通过INPUT node向Agent发出指令，INPUT node可能会使用特殊的语法引用PROMPT node，也可以将PROMPT node作为system prompt
     - 入边：
       - PROMPT
       - GENERATED
       - VFS
     - 出边
       - GENERATED：包含这次会话中，AI生成的内容（一个INPUT节点可能连接到多个GENERATED节点）
   - GENERATED：内容为文本，是一次会话中AI的输出
     - 入边：
       - INPUT
     - 出边：
       - PROMPT
       - INPUT
   - VFS：内容是一个文件夹，其中可能包含代码，可以挂载到一个INPUT节点，为一次对话提供文件系统支持
     - 入边：
       - VFS：挂载到当前VFS的某个目录下的另一个文件夹
     - 出边：
       - VFS
       - SANDBOX：当其中包含前端代码时
       - LOADER：当其中包含后端服务代码时
       - INPUT：当需要为Agent提供文件系统时
   - LOADER：这是一个功能性的节点，它和STATE节点以及SANDBOX节点一起构成了一种对前端全栈应用的模拟执行环境。其中LOADER节点作为serverless服务的运行时，STATE节点作为数据库，SANDBOX节点作为浏览器（使用iframe实现）
     - 入边：
       - VFS：提供服务代码，支持lua和ts
       - STATE：提供数据库服务，是一个RDF数据库
     - 出边：
       - SANDBOX：相当于前后端之间的通信信道
   - SANDBOX：功能性节点，用于作为用户入口，渲染AI游戏的网页前端
     - 入边：
       - VFS：提供前端代码（自动bundle）
       - LOADER：提供后端服务
     - 出边：无
   - STATE：功能性节点，相当于一个游戏存档槽位，作为RDF数据库使用
     - 入边：无
     - 出边：
       - LOADER：作为服务代码的外挂数据库
   - SAVE：这种类型在后端被作为一个节点，但是在前端中实际上是不显示的，SAVE节点承载一个STATE节点的数据库快照，作为存档使用。
- 一个用于索引平台内容的市场（Hub）：用户在这里发布自己的作品（Artifact），围绕作品形成社区（Project）。同时可以游玩其他人的作品。在这一部分，用户可见的资源包括：
  - Artifact：一个单独的作品，可以进行游玩（如果作者设置了Entrypoint）或派生
  - Project：多个Artifact的集合
  - Article：通过Artifact的游玩记录派生出来的小说，往往内置多个存档点（对相应Artifact中SAVE节点的引用），其他用户可以通过存档点进行游玩

## 后端职责

后端的职责可以使用一句话描述：对平台上的资源进行索引和管理。

1. Node：这是我们平台上的最基本资源，其他的资源实质上都是Node的派生和组合。因此，我们要处理
   1. Node的版本管理：我们通过版本管理保证可回溯性。所有的Node实质上形成一个巨大版本森林。我们支持分叉，但是不支持合并。森林中的每棵树都对应一个唯一ID（`node_id`），版本树中的每个版本对应一个唯一commit，node的commit在森林中是全局唯一的，因此我们可以仅使用commit来索引一个node的特定版本。
   2. Node之间的依赖管理，如某一个GENERATED可能依赖特定commit的INPUT，VFS以及PROMOT node。这揭示了特定node的血缘
2. Artifact：这是用户（内容消费者）可见的最小资源。一个Artifact由多个Node组成
   1. Artifact的版本管理：Artifact的版本历史是线性无分叉的，它实际上是功能性的，用于实现用户侧的版本管理和自动同步。每个Artifact版本对应一系列node的版本。Artifact的作者允许和node的作者是不同的，只要他拥有对应node的读权限。
3. Article：Article实际上是用户游玩了平台上的AI文游之后产出出来的小说（大概率是使用他的聊天记录），用户可以为小说的关键剧情节点附上他的存档（SAVE节点）
4. Project：Artifact的集合，Project没有版本控制，它永远指向artifact的最新版本

## 技术栈

- TypeScript+ESLint
- 后端全部运行在cloudflare worker
- 使用drizzle ORM配合cloudflare D1数据库
- 使用R2配合可寻址内容模式存储VFS和SAVE

## 目录结构

- `packages/api`：包含了
  - openapi.yaml格式的api定义
  - 自动生成的后端zod校验schema以及前端client
  - 前后端通用的一些工具，主要是commit hash的计算
- `packages/db`：包含
  - drizzle ORM schema
  - 各个不同domain的服务定义
- `services/hub`：api的路由实现
