# Windows 适配说明与升级指南

> 本文档记录了 `windows` 分支相对上游 `EKKOLearnAI/main` 所做的 Windows 适配，并指导后续 AI / 开发者在合并上游更新时如何保留这些修改。

---

## 1. 背景

`windows` 分支在以下提交中加入了 Windows 平台所需的兼容性修改：

| Commit | 标题 | 作用 |
|--------|------|------|
| `2bb6db6` | feat(server): add Windows compatibility support | 终端 shell 检测、`taskkill`、Python UTF-8、`gateway run` 模式、Vite 端口 8649 等 |
| `65e84c6` | refactor(hermes): normalize line endings for cross-platform parsing | 修复 CRLF 导致的 profile / session 解析失败 |
| `f511f84` | chore(config): update HERMES_BIN path in nodemon.json | 本地 Windows 开发的 hermes CLI 路径 |

合并上游时这些提交会被 git 自动保留，但**部分文件可能与上游产生冲突**——见第 4 节。

---

## 2. CRLF 解析问题（核心修复）

### 现象
在 Windows 上，侧边栏"用户"下拉只显示最后一个 profile（如 `turing`），看不到 `default`。

### 根因
hermes CLI 的 `print()` 在 Windows 上输出 CRLF (`\r\n`)。`child_process.execFile` 拿到的 stdout 同样包含 `\r\n`。

原代码 `.split('\n')` 切割行后，除最后一行外每行末尾都残留 `\r`。JS 正则中 `.` 不匹配 `\r`，末尾带 `(.*)$` 的正则全部匹配失败——只有最后一行（被 `trim()` 去掉了尾部 `\r\n`）能被解析。

以 `hermes profile list` 输出为例：

```
\r\n
 Profile          Model                        Gateway      Alias\r\n
 ───────────────    ───────────────────────────    ───────────    ────────────\r\n
 ◆default         MiniMax-M2.7                 running      —\r\n      ← \r 导致正则失败
  turing          MiniMax-M2.7                 stopped      turing         ← 最后一行无 \r，匹配成功
```

结果：`profiles` 数组只包含 `turing`，`default` 丢失。

### 修复策略
对 CLI 输出做两种等价处理之一：

| 方案 | 示例 | 用在哪 |
|------|------|--------|
| A. 先规范化再 split | `stdout.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')` | `hermes-cli.ts` |
| B. 用兼容正则 split | `stdout.split(/\r?\n/)` | `gateway-manager.ts` 等 |

两者效果相同，只要 split 之后每行不再含 `\r` 即可。

### 当前已修复的位置

| 文件 | 行（约） | 函数 |
|------|----------|------|
| `packages/server/src/services/hermes/hermes-cli.ts` | L73 | `parseSessionExport` |
| 同上 | L312–313 | `listLogFiles` |
| 同上 | L392–393 | `listProfiles`（**核心**） |
| 同上 | L430 | `getProfile`（按 `:` 分割，受影响较小） |
| `packages/server/src/services/hermes/gateway-manager.ts` | L76, L478, L653, L670 | gateway 状态解析等 |
| `packages/server/src/services/hermes/agent-bridge/manager.ts` | L78 | bridge 查找 |
| `packages/server/src/services/hermes/context-engine/gateway-client.ts` | L148 | context engine |
| `packages/server/src/services/hermes/group-chat/agent-clients.ts` | L422 | group chat |
| `packages/server/src/services/hermes/run-chat/sse-utils.ts` | L37 | SSE 行解析 |

> **新增 hermes CLI 输出解析时，必须使用上面的方案 A 或 B，禁止裸 `.split('\n')`**。

---

## 3. 其他 Windows 适配点（来自 `2bb6db6`）

合并上游时如果改到这些文件需特别留意，**不要被上游版本覆盖**：

- **`packages/server/src/services/hermes/gateway-autostart.ts`**（2026-05-21 后）
  上游在 v0.5.30 将 `gateway-bootstrap.ts` 重构为此文件，原生加入了 `process.platform === 'win32'` 检测，自动使用 `gateway run` 模式。不再需要手动删除 `startAll()` 调用。
  > `shouldUseManagedGatewayRunForAutostart()` 函数**不包含** win32 检测，这是有意为之——Windows 不自动启动所有 gateway。

- **`packages/server/src/services/hermes/gateway-manager.ts`**
  Windows 分支使用 `gateway run` 模式而非 `gateway start --daemon`；进程终止用 `taskkill /F /PID` 替代 `SIGTERM`（上游已整合）。

- **`packages/server/src/routes/hermes/terminal.ts`**
  Windows 下的 shell 探测顺序：Git Bash → PowerShell → cmd。

- **环境变量**：`PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8` 用于解决 Python 子进程在 Windows 下的编码问题。

- **`vite.config.ts`**：dev 端口改为 `8649`（避免与后端 8648 冲突），并对 `ECONNREFUSED` 做了静默处理。

- **`package.json`**：`engines.node >= 22.0.0`，新增 `cross-env` 依赖。

- **`nodemon.json`**：`HERMES_BIN` 指向本地开发用的 hermes CLI 绝对路径（当前：`D:\Code\hermes-agent\venv\Scripts\hermes.exe`）——**这是 KK 本地路径，其他开发者请勿提交修改**。上游每次重写 `nodemon.json` 都会丢失此配置，合并后必须手动补回（见第 4 节验证步骤 5）。

---

## 4. 合并上游的标准流程

假设当前在 `windows` 分支、工作区干净：

```bash
git fetch upstream
git log --oneline HEAD..upstream/main          # 看一眼有哪些新提交
git merge upstream/main --no-edit
```

### 常见冲突与处理

| 文件 | 冲突类型 | 处理方式 |
|------|----------|----------|
| `packages/server/src/services/hermes/gateway-autostart.ts` | 上游修改了 Windows gateway 逻辑 | 确认 `shouldUseManagedGatewayRun()` 仍包含 `process.platform === 'win32'` |
| `packages/server/src/services/hermes/gateway-manager.ts` | 上游改了 gateway 启动逻辑 | 谨慎合并——保留 Windows 分支的 `gateway run` 模式与 `taskkill` |
| `packages/server/src/services/hermes/hermes-cli.ts` | 上游改了解析函数 | 保留 CRLF 规范化（方案 A），把上游的功能改动叠加在规范化之后 |
| `packages/server/src/routes/hermes/terminal.ts` | 上游改了终端逻辑 | 保留 Windows shell 探测分支 |
| `README.md` | 端口说明不同 | 保留 Windows 端口 8649 |
| `vite.config.ts` / `package.json` / `nodemon.json` | 端口/依赖/路径冲突 | 保留 Windows 配置 |

### 合并后必做的验证

1. **CRLF 修复仍在**：
   ```powershell
   grep -nE "split\(/\\\\r\\?\\\\n/\)|replace\(/\\\\r" packages/server/src/services/hermes/hermes-cli.ts packages/server/src/services/hermes/gateway-manager.ts
   ```
   应能找到匹配。
2. **`gateway-autostart.ts` 含 Windows 检测**：
   ```powershell
   grep -n "win32" packages/server/src/services/hermes/gateway-autostart.ts
   ```
   应能在 `shouldUseManagedGatewayRun()` 中找到 `process.platform === 'win32'`。
3. **本文档仍存在**：`git ls-files docs/fix-windows-crlf-profile-parsing.md`
4. **Windows 三个提交仍在历史里**：
   ```powershell
   git log --oneline windows ^upstream/main
   ```
   应能看到 `2bb6db6`、`65e84c6`、`f511f84`。
5. **`nodemon.json` 的 `HERMES_BIN` 仍在**：
   ```powershell
   grep -n "HERMES_BIN" nodemon.json
   ```
   应能找到匹配。若无输出，手动补回（上游会重写此文件）：
   ```json
   "HERMES_BIN": "D:\\Code\\hermes-agent\\venv\\Scripts\\hermes.exe"
   ```

### 提交合并

```bash
git add <冲突文件>
git commit --no-edit       # 使用 git 生成的默认 merge 信息即可
```

---

## 5. 历史合并记录

| 日期 | Merge commit | 上游 HEAD | 备注 |
|------|-------------|-----------|------|
| 较早 | `c16d786` | — | 首次合并上游 |
| 较早 | `a8cf897` | — | 第二次合并 |
| 较早 | `9d1e7e2` | `acf5184` | follow-up |
| 2026-05-16 | `d16251c` | `7d7c8b7` | 86 个提交，冲突仅 `gateway-bootstrap.ts`（上游恢复了 `startAll()`，已删除） |
| 2026-05-17 | `7f96b7b` | `bbfd818` | 16 个提交，无冲突，自动合并；新增诊断字段、xAI OAuth、session bridge 等功能 |
| 2026-05-18 | — | — | 发现上游重写 `nodemon.json` 导致 `HERMES_BIN` 丢失（`spawn hermes ENOENT`），已手动补回；更新本文档并新增验证步骤 5 |
| 2026-05-21 | `39bed46` | `40109e9` | 19 个提交，冲突 2 处：`README.md`（保留 Windows 端口 8649）、`gateway-bootstrap.ts`（上游完全重构为 `gateway-autostart.ts`，接受删除）；上游新增 `process.platform === 'win32'` 原生支持，CRLF 修复已整合；`nodemon.json` 的 `HERMES_BIN` 通过 git 保留 |

> 下次合并请追加一行。
