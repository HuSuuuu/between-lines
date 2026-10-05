# 字里行间 · Between Lines

一部可以翻阅、演奏，也可以亲手编写的歌词书。黑白宋体、点击转弯、双指双押、滑动选路；音乐、曲库与创作都在浏览器本机完成。

[在线演奏与创作](https://rhythm-combat-demo.pages.dev/space/) · [源码仓库](https://github.com/HuSuuuu/between-lines) · [直接下载源码](https://rhythm-combat-demo.pages.dev/space/source.zip)

## 开始

需要 Node.js 22.12+。

```sh
npm ci
npm run dev
```

打开终端显示的地址。生产构建与校验：

```sh
npm test
npm run build
npm run validate -- public/example.chart.json
```

`dist/` 可部署到静态服务器或 Cloudflare Pages。没有运行时后端、账号或云端 AI 依赖。锁文件固定依赖；练习音乐、字群和路线使用固定种子生成。

## 游玩与创作

- 翻开曲集，目录支持搜索、最近、收藏和自己的作品；作品页可左右翻页、点击页边按钮或使用方向键。
- 普通节点点击演奏区任意位置。双押用双指或 F＋J；岔路按预告方向滑动，键盘方向键或 WASD。
- 最多两个球，按段落分裂与汇合。三个操作共用时间预读，玩家无需分别瞄准球。
- 从「＋创作」进入：导入音乐 → 导入或粘贴 TXT/LRC → 跟着音乐敲谱 → 生成地图 → 试玩与保存。
- 录谱区支持单击、双指或空格/F/J。时间轴可拖动、改变类型、删除；节拍吸附可撤销，原始点击保留在 `rawTimes`。
- 试听时可标记歌词起点；无时间戳歌词按段落编排。构图可选横排、竖排、重点词嵌入，并添加双球段落。
- 草稿自动保存，支持撤销重做与版本副本。导出完整 ZIP 谱包，或导出只含谱面和歌词的 ZIP；后者导入后附加相同音乐。
- 可直接导入 v11 JSON 谱面，再附加音乐；所有内容均为声明式数据，不执行脚本。

音乐按实际浏览器解码能力支持 MP3/WAV/M4A/OGG。音乐不支持或导入失败时保留已有草稿。录制范围默认全曲，可设置起止时间进行循环重录。

## 离线与保存

IndexedDB 保存音乐、草稿、曲库、设置和成绩。安装完成的 Service Worker 缓存程序和完整宋体字库；示例音乐在成功播放后缓存。自己的音乐保存在 IndexedDB，导入后无需联网。

首次访问与离线资源准备需要网络。浏览器可能限制或清理本机存储；保存失败会明确显示未持久保存，内容仍暂存在当前会话，可以立即导出谱包备份。音量分开控制，校准仅作用于下一次演奏；设置、演奏中断、方向变化和后台切换保留位置。

成绩按谱面 ID、内容指纹与难度区分。练习、试玩和曾开启演示的局不进入最高分；旧版设置与纪录保留。

## 开源结构

- `src/engine.ts`：显式节奏判定与分支选择，不从几何拐角猜测节奏。
- `src/audio.ts` / `src/input.ts`：音乐输出时钟、音效与多指生命周期。
- `src/generator.ts` / Worker：确定性路线与密铺宋体词云，保留输入时间；原歌词完整保留，大词、中词、小词重复嵌合填满视野。
- `src/editor.ts` / `src/main.ts`：创作闭环、书籍导航、设置与结果。
- `src/store.ts` / `src/packages.ts`：本机保存、可移植谱包与资源校验。
- `src/legacy.ts`：旧版 v10 谱面适配，保留原始时间与路线。

接口、格式与扩展方式见 [谱面文档](docs/chart-format.md)、[架构](docs/architecture.md)、[贡献指南](CONTRIBUTING.md)。公开 Schema 为 `public/chart.schema.json`，示例为 `public/example.chart.json`。

源码仓库仅携带原创练习内容。网页现有的《反乌托邦》资源独立于 MIT 引擎许可；将已有 `legacy-chart.json`、`legacy-lyrics.json` 与 `anti-utopia.mp3` 放入 `public/assets/` 后，构建会自动适配并添加这首作品。资源文件不提交到源码仓库。

## 验证边界

自动测试覆盖任意录谱时间、整曲判定、双押和触点取消、两球速度与分合、岔路同分、字形间隙、暂停续播、谱包往返、存储恢复与纪录资格。浏览器回归覆盖创作和演奏流程、手机与平板视口及横屏。

实际 iPhone Safari、Android Chrome 与 iPad Safari 的延迟、帧耗时和触觉体验需要按 [验收表](docs/qa.md) 进行真机检查。视口模拟与自动测试不能替代真实设备的手感验证。

代码 MIT；字体 SIL Open Font License；原创练习音乐与文本 CC0。见 [NOTICE](NOTICE.md)。
