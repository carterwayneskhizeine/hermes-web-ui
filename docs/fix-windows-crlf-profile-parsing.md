# 修复：Windows 下用户配置文件解析失败

## 问题

在 Windows 上，侧边栏的"用户"下拉菜单只显示最后一个 profile（如 `turing`），无法看到或切换回 `default`。

## 原因

hermes CLI 的 `print()` 在 Windows 上输出 CRLF (`\r\n`) 行尾。Node.js 的 `child_process.execFile` 拿到的 stdout 同样包含 `\r\n`。

原代码使用 `.split('\n')` 切割行，导致除最后一行外的每一行末尾都残留 `\r`。JavaScript 正则中 `.` 不匹配 `\r`，因此末尾带 `(.*)$` 的正则全部匹配失败——只有最后一行（恰好没有残留 `\r`，因为 `trim()` 去掉了尾部 `\r\n`）能被解析。

以 `hermes profile list` 输出为例：

```
\r\n
 Profile          Model                        Gateway      Alias\r\n
 ───────────────    ───────────────────────────    ───────────    ────────────\r\n
 ◆default         MiniMax-M2.7                 running      —\r\n      ← \r 导致正则失败
  turing          MiniMax-M2.7                 stopped      turing         ← 最后一行无 \r，匹配成功
```

结果：`profiles` 数组只包含 `turing`，`default` 丢失。

## 修复

将所有 CLI 输出解析中的 `.split('\n')` 替换为 `.split(/\r?\n/)`，同时加固表头跳过逻辑。

### 变更文件

| 文件 | 行 | 说明 |
|------|----|------|
| `packages/server/src/services/hermes/hermes-cli.ts` | L78 | `parseSessionExport` — session 导出解析 |
| 同上 | L320 | `listLogFiles` — 日志文件列表解析 |
| 同上 | L394–404 | `listProfiles` — profile 列表解析（**核心修复**） |
| 同上 | L434 | `getProfile` — profile 详情解析 |
| `packages/server/src/services/hermes/gateway-manager.ts` | L349–351 | `listProfiles` — 网关管理器中的 profile 名称列表解析 |

### 修复前

```ts
const lines = stdout.trim().split('\n').filter(Boolean)
for (const line of lines) {
  if (line.startsWith(' Profile') || line.match(/^ ─/)) continue
  const match = line.match(/^\s+(◆)?(\S+)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(.*)$/)
  // ...
}
```

### 修复后

```ts
const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
for (const raw of lines) {
  const line = raw.replace(/\r$/, '')
  if (line.match(/^\s*(Profile|─)/)) continue
  const match = line.match(/^\s+(◆)?(\S+)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(.*)$/)
  // ...
}
```

关键改动：

1. **`split(/\r?\n/)`** — 同时兼容 LF 和 CRLF，在 split 阶段就消除了 `\r`
2. **`replace(/\r$/, '')`** — 双重保险，确保残留的 `\r` 被清除
3. **`match(/^\s*(Profile|─)/)`** — `trim()` 会去掉首行前导空格，原 `startsWith(' Profile')` 会漏掉无前导空格的表头行
