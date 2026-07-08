# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目与用户背景

无限画布 AI 创作工具（生图 / 生视频 / 提示词生成 / AI 聊天），**React 19 + TypeScript + Zustand + Vite + react-rnd + Tailwind 4**——不是 Vue，不要被目录名误导。

**项目所有者是设计师，不是程序员**：用中文沟通，说人话、少术语；git 操作、部署、排错由 Claude 代劳并解释清楚后果；不要假设用户会自己跑命令或看代码。

## 常用命令

```bash
npm run dev      # vite dev，端口 5273。注意：/api/* 是 Vercel serverless，本地跑不了
                 # （.env.development.local 清空了 R2 URL，本地走 GitHub-only 路径）
npm run build    # tsc -b && vite build——提交前必跑，这是唯一的验证手段（没有测试）
npm run lint     # eslint。存量约 17 个 error（set-state-in-effect 等），改动前后对比数量即可，别顺手修无关的
```

部署：Vercel + 自定义域名（canvas-hello.cyus.net），**push 到 main 即自动上线**。查部署状态：
`gh api repos/xiaobinginging-cpu/canvas-hello/commits/<sha>/status --jq .state`。
提交风格：中文 conventional（`fix(canvas): …` / `feat(image-gen): …`），一个关注点一个提交，改完 build 通过就提交推送。

## 架构

```
components/   UI（CanvasPage/ 是主体：Canvas 视口 + ImageItem/VideoItem/TextCardItem + 各生成面板）
store/        useStore.ts（项目/画布/选择/生成配置，~1000 行）+ useChatStore.ts（聊天会话）
lib/          业务流程 + 持久化。canvasGeneration.ts 是生成编排层；github.ts 是持久化 god-file（见下）
api/          Vercel serverless：llm.ts（通用 LLM 流式代理）、apimart.ts、fetch-image.ts（下载代理）、r2-*.ts
types/        领域类型（image/project/video/chat/library）
```

### 存储（github.ts，~2000 行，历史原因得名）

R2 为主、GitHub repo 为遗留兜底，五块揉在一个文件里：R2 层（顶部）→ GitHub 层 → library → chat → 离线 pending 队列。要点：

- 每个项目 = R2 里 `project-{id}/meta.json + canvas.json + assets/*`；资产文件名带 nanoid **不可变** → fetch 用 `force-cache`；meta/canvas/library/chat 等**可变 JSON 一律 `no-store`**，别改反
- `saveProject` 走模块级串行队列；入口对 null meta/canvas 直接 throw；最终失败经 `PERSIST_ERROR_EVENT`（CustomEvent，因为 useStore 反向依赖本模块、import store 会成环）冒泡到 CanvasPage toast
- **R2 写失败不准写 GitHub 兜底**（读路径 R2-first 读不到会脑裂覆盖丢数据）——失败入 pending 队列重试或直接报错
- UI 门禁用 `storageReady()`（R2 配置了即可用），不要用 `isAuthenticated()`（那是 GitHub PAT，遗留形态）
- GitHub repo（canvas-tool-projects）里是迁移前的测试数据，用户已确认不迁移；Vercel 上的 R2 环境变量是"敏感"类型只写不读，要密钥得去 Cloudflare 重建令牌
- 每日备份：`.github/workflows/r2-backup.yml`（rclone 镜像到 canvas-hello-backup，history/ 保留 30 天）

### 最重要的不变式：异步生成 × 项目切换

生成要几十秒，期间用户可能切项目/回首页（store 被换掉）。**任何 await 之后要写回 store 或 saveProject 的地方，必须先校验 `getState().currentProjectId === 开始时捕获的 projectId`**——这类竞态曾造成把 null 或别的项目的画布写进远端。聊天的 persist/loadForProject 同理。新增任何异步流程都要遵守这个模式。

### 画布性能不变式

- 平移/缩放走 `liveViewportRef` + rAF 直写 DOM，松手/防抖后才 commit 到 store——**高频事件里绝不逐帧 setState**
- item 拖拽/缩放期间不回写 store（react-rnd 自己操作 DOM），只在 `onDragStop`/`onResizeStop` 提交
- 视口剔除：只挂载可见区 ± 一屏的 item，选中项始终保留；**objectURL 生命周期归 store 管**（removeImage/removeVideo/切项目时回收），组件 unmount 不准 revoke，否则剔除后回视野要重新下载
- zustand selector 禁止内联新引用（空数组用模块级 `EMPTY_*` 常量）；`wheel` 监听必须原生 `{ passive: false }`，React 的 `onWheel` prop 是 passive 的、`preventDefault` 无效还刷屏

### AI 接入模式

- **聊天/提示词（文本类）**：全走 OpenAI 兼容 + `/api/llm/<provider>` 流式代理。加一家 = `api/llm.ts` UPSTREAM 加一行 + `chatProviders.ts` 加 agent + `apiKeys.ts` 加 provider + SettingsPage 加配置行。key 是 BYOK 存 localStorage。火山豆包（volcengine）注意：提示词生成要带 `thinking: {type:'disabled'}`，否则深度思考慢到超时
- **APImart 异步任务（生图/生视频）**：提交 → 轮询统一 `/v1/tasks/{id}`。轮询必须用**放宽的完成判定**（APImart 常卡 processing 99% 不翻 completed）+ 10 分钟超时；结果下载先直连、CORS 被拒回退 `/api/fetch-image` 代理（域名白名单在该文件，GPT Image 2 的结果在无 CORS 头的 getapib.org）
- **Midjourney**：专用 `/midjourney/generations` 端点，一次回 **4 张独立变体**（不是四宫格），比例经 `--ar` 拼 prompt，不吃参考图；每张带 `metadata.mjTaskId + mjIndex`，工具栏「放大」按 index 调 upscale（按次计费）
- 生成失败必须落到占位卡的 `uploadError`（不能让异常从 `void run…()` 逃逸成 unhandled rejection + 无限转圈）；参考图收集等"生成前置步骤"要包进 try
