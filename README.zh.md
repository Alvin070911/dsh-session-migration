# 会话迁移 · DSH Session Migration

> 在 DeepSeek Harness 的**会话标题栏**里加一个按钮：把整段会话（日志、`header.cwd`、工作区归属）
> 迁移到另一个工作目录，并附带会话浏览、一键备份导出与工作区体检。

[English](README.md) | 中文

![图标](icon.svg)

## 它解决什么问题

DSH 里一个会话属于哪个工作区，由**三处**共同决定：

| # | 位置 | 说明 |
|---|---|---|
| ① | `~/.dsh/sessions/<projectKey(cwd)>/<sessionId>/session.v4.jsonl.zstd` | 目录名就是工作目录的编码 |
| ② | 日志**第 1 帧**里的 header `cwd` | 日志内部又存了一份 |
| ③ | `~/.dsh/storages/workspace.json` → `workspace.sessionIds` | 决定它出现在哪个工作区的列表里 |

所以「把会话挪到别的工作区」不是拖一下文件夹就能完成的。少改一处、改错顺序，会分别触发三种
真实的崩溃模式：

- **A**：同一个 `sessionId` 留了两份（用了复制而不是移动）→ 启动扫描冲突、会话列表错乱；
- **B**：注册表里留了一条指向不存在数据的 id → **整个工作区打不开**，并连带
  `directoryPickerController unavailable`；
- **C**：DSH 运行期间手改 `workspace.json` → 退出时被内存状态覆盖，改动时有时无。

本插件把这套流程做成了一个按钮，并且**只走 DSH 自己的服务与格式约定**：数据用移动不用复制、
只重写日志的第 1 帧、注册表只通过运行中的 `workspaceRegistry` 服务写入。

## 功能

- **会话迁移**：选择目标工作区（已有工作区下拉，或浏览任意目录），先预检、再执行；
  自动备份、逐字节校验、失败自动回滚并打印回滚命令。
- **可选搬运工作目录文件**：勾选后把源工作目录的顶层条目一并搬到目标目录（同名冲突即拒绝，
  源目录保留为空，不会破坏其它会话）。
- **会话列表**：id / 工作目录 / 日志大小 / 帧数 / 最后写入时间 / 当前归属 / 异常标记。
- **体检（doctor）**：悬空引用、重复 id、header 与目录不符、0 字节日志、工作区目录缺失、
  未登记的孤立会话；悬空引用可通过 `workspaceRegistry` **安全摘除**（不需要关停 DSH）。
- **导出备份**：把会话目录完整复制到你指定的目录，附 `migration-export.json` 清单，不改注册表。

## 安装

### 方式一：本地目录安装（开发/自用首选）

把本仓库放到任意位置，然后在 DSH 里：

```text
plugin_manager install_bundle  target = C:\path\to\dsh-session-migration
```

也可以手动加进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: session-migration
      name: dsh-session-migration
```

### 方式二：从 GitHub 安装

```text
plugin_manager install_bundle
  target = git+https://github.com/<your-name>/dsh-session-migration.git
```

### 方式三：npm（发布后）

```text
plugin_manager install_bundle  target = dsh-session-migration
```

安装后浏览器半侧会自动被 `dsh.client` 声明加载。**如果按钮没出现，刷新一次页面**（新装的
客户端 bundle 需要页面重新走一次模块图）。

## 使用

1. 打开任意会话，标题栏右侧多出一个图标按钮（两个面板 + 箭头）。
2. 点开后选择左侧要迁移的会话。**当前正在使用的会话不能自迁**——它的日志被占用，
   插件会明确拒绝。
3. 选择目标工作区，或切到「自定义路径」输入/浏览任意目录。
4. 看预检结果：`projectKey` 是否变化、目标会话目录、目标工作区是否将新建、文件搬运的条目数与冲突。
5. 点「开始迁移」，再点一次「确认迁移」。
6. 结果区会列出每一步：备份 → 数据搬迁 → header 改写 → 校验 → 文件搬运 → 工作区归属。

### 关于「需要重启 DSH」

工作区归属那一步会显示 `pending-restart`，这是**设计如此**，不是失败：

> 运行中的工作区注册表是在启动时按 header 建的一份索引快照，插件无法在运行中刷新它；
> 强行手改 `workspace.json` 就是崩溃模式 C。

因此插件把「补写归属」写进队列（`~/.dsh/plugin-data/dsh-session-migration/pending.json`），
**下次启动 DSH 时自动补写**，并在日志里报告结果。你不需要做任何操作，重启一次即可看到
会话出现在新工作区里。「待补写」页可以手动重试。

## 安全模型

| 不变量 | 实现 |
|---|---|
| 只移动、绝不复制 | 目标会话目录已存在即拒绝；迁移后校验目标日志大小 |
| 注册表不出现悬空引用 | 注册表只经由 `workspaceRegistry` 写入；归属补写在数据就位之后 |
| header 只改第 1 帧 | 解压首帧、改 `cwd`、重压首帧、其余字节原样拼接 |
| 完整性可验证 | 比较「第 2 帧起」的字节；帧数变化（迁移后继续聊天）不算失败 |
| 幂等 | 重复迁移同一目标 → `same-target` 空操作拒绝，不会产生第二份 |
| 可回滚 | 任一步失败 → 逆序回搬数据 / 还原 `.bak` / 删除新建工作区；成功与失败都会打印可复制的回滚命令 |
| 使用中的会话不自迁 | 通过 `agents` 服务判定，命中即拒绝 |

### 为什么不能「解压全文再改再压」

`zlib.zstdDecompressSync(log)` 只返回**第一帧**（通常就是 200 多字节的 header）。看起来像
「整个日志只有一行」，据此判断会话为空或已损坏，就会误删用户数据。本插件因此：

- 帧边界用 RFC 8878 的帧/块头逐帧走查（失败才退化为魔数扫描）；
- 统计帧数用分块扫描，不把 18 MB 日志读进内存；
- 改写只替换第 1 帧。

## 体检项

| code | 级别 | 含义 | 能否自动修 |
|---|---|---|---|
| `dangling-reference` | error | 注册表引用了一个磁盘上不存在的会话 | ✅ 一键摘除 |
| `duplicate-session` | error | 同一 sessionId 在多个工作目录下各有一份 | ❌ 需人工（保留较新、备份另一份） |
| `cwd-mismatch` | error | `header.cwd` 与所在项目目录不符 | ❌ 需人工 |
| `id-mismatch` | error | 目录名与 `header.id` 不一致 | ❌ 需人工 |
| `empty-log` / `missing-log` | error | 0 字节或没有日志 | ❌ 需人工 |
| `missing-workspace-dir` | warn | 工作区目录不存在 | ❌ 仅提示 |
| `orphan-session` | warn | 会话没有被任何工作区登记（界面上看不到） | ❌ 仅提示 |

> 「日志很小」**不是**脏数据：空会话的 header 大约 300 字节，完全合法。

## 配置

`cordis.patch.yml` 的 row `config`（不写就用默认值）：

```yaml
- id: session-migration
  name: dsh-session-migration
  config:
    backupBeforeMove: true        # 迁移前完整备份会话目录
    keepBackups: 10               # 保留最近 N 份自动备份
    tryImmediateAttach: true      # 先尝试立即补写归属（通常会被索引快照挡下）
    pendingApplyDelayMs: 2500     # 启动后多久尝试补写队列
    dshHome: ''                   # 默认 $DSH_HOME，其次 ~/.dsh
    sessionsRoot: ''              # 默认 <dshHome>/sessions
```

数据位置：

```text
<dshHome>/plugin-data/dsh-session-migration/
  pending.json                 待补写的归属
  backups/<时间>-<sessionId>/  迁移前备份
  exports/<时间>-<sessionId>/  手动导出
```

## 手动回滚

每次迁移都会在结果里给出可复制的回滚命令，形如（DSH 完全退出后执行）：

```powershell
Remove-Item -Recurse -Force "<targetDir>"
Copy-Item -Recurse "<backup>" "<targetDir>"
```

会话目录里的 `session.v4.jsonl.zstd.bak` 是 header 改写前的那一份，DSH 不会把它当作正式日志。
如果迁移后确实需要把归属改回去，删除 `pending.json` 里的对应条目即可。

## 开发

```text
node --check index.js client.js lib/*.js
node --test            # 31 个用例：projectKey / 帧走查 / header 改写 / 迁移 & 回滚 / 客户端契约
```

代码结构：

```text
index.js        Host 入口：注册 /dsh-session-migration/api，启动后补写归属
lib/paths.js    projectKey / encodeSegment / DSH home / 路径规范化（对齐 DSH 自身规则）
lib/frames.js   zstd 帧走查、首帧读取、只替换首帧、尾段逐字节比较
lib/scan.js     会话扫描、原始注册表读取、doctor 判定
lib/engine.js   预检 / 迁移 / 校验 / 回滚 / 文件搬运 / 导出 / 待补写队列 / HTTP 分派
client.js       浏览器半侧：标题栏按钮 + shell.overlay 对话框
```

插件只依赖 Node 内置模块，不 import DSH 的内部包，因此可以独立发布。

## 已知边界

- **当前打开的会话不能自迁**（日志被占用），这是限制也是保护。
- 迁移后重写的是 header 的第 1 帧，格式版本仍为 v4；跨大版本升级请先让 DSH 自己完成迁移。
- 工作区目录被整体移动（而不是搬内容）不在支持范围内：工作区路径在注册时由 `realpath` 固定，
  移动目录会让旧工作区变成 `missing-dir`。插件只搬**内容**，保留源目录本身。
- 复制正在写入的会话做导出时可能得到被截断的尾部；DSH 读取时会丢弃撕裂的尾部，不影响源数据。

## 发布

```powershell
gh repo create dsh-session-migration --public --source . --remote origin --push
```

之后任何人都可以直接安装：

```text
plugin_manager install_bundle  target = git+<仓库地址>
```

## 许可

MIT。DSH 的存储格式、`projectKey` 规则与工作区语义以你所使用版本的源码为准
（`dsh-session-persistence-jsonl`、`dsh-workspace`）。
