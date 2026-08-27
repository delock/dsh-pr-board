# dsh-pr-board

Maintainer PR review queue board for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
It answers one question: **which PRs need me, right now?**

一个为 DeepSeek Harness 做的**维护者 PR 看板**：回答一个问题——**现在哪些 PR 在等我？**

---

## Why / 解决什么问题

Reviewing PRs is a queue-management problem. GitHub's native views don't tell you:
"the author just pushed a fix after my change request — it's back on your plate".
This board classifies every PR you're involved in into five states and **detects the
moment a PR moves back to you**.

Review PR 本质是队列管理。GitHub 原生界面无法直接告诉你"作者刚在你 request changes
之后推了新提交，又该你出手了"。本插件把你参与的每个 PR 归入五种状态，并**在 PR
回到你手上的一刻提醒你**。

## The five states / 五种状态

| Column / 列 | Meaning / 含义 | How it's decided / 判定依据 |
| --- | --- | --- |
| **Waiting on me** 等我行动 | Your move / 该你出手 | Review requested; or the author pushed/replied after your last review; or new commits landed after your approval |
| **Waiting on author** 等作者行动 | Their move / 等作者 | You (or another maintainer) requested changes and the author has been quiet since; approved but draft or conflicting |
| **Ready to merge** 可合并 | Green light / 绿灯 | `reviewDecision = APPROVED`, mergeable, not draft — or already sitting in a merge queue |
| **Merged** 已合并 | Done / 完成 | Recently merged PRs you reviewed |
| **Inbox** 新 PR 待分诊 | New & unclaimed | Newest open PRs you haven't touched — one click ("我来 review") adds you as reviewer |

Transition detection: when a PR crosses **author → you** (author responded, or
re-requested your review), you get a toast and the sidebar widget pulses.
Status-quo polling keeps the board fresh (interval configurable: 1–30 min).

状态迁移检测：当 PR 从"等作者"切到"等你"（作者回复 / 重新 request 你 review）时弹
toast 提醒、侧边栏小部件闪烁；轮询间隔 1–30 分钟可配。

## Requirements / 依赖

- The DSH **host** machine has the [GitHub CLI](https://cli.github.com/) (`gh`)
  installed and **authenticated** (`gh auth login`). The plugin shells out to `gh`
  for search + GraphQL queries, so it respects your `gh` token scopes and GitHub's
  rate limits. If `gh` is missing or logged out, the board shows a setup hint
  instead of raw errors.
- DSH web profile (GUI). This plugin is a web-profile client plugin.

DSH 宿主机上需安装并登录 `gh`；插件通过 `gh` 的 search + GraphQL 查询取数，
速率限制遵循你 gh token 的配额。若 `gh` 缺失或未登录，看板会显示安装/登录
指引而不是原始报错。

## Install / 安装

```bash
dsh plugin --profile web add github:delock/dsh-pr-board
```

(or publish to npm and `dsh plugin --profile web add dsh-pr-board`)

Then restart the web profile and refresh the page.

## Configure / 配置

1. Click the **PR Board** widget at the bottom of the sidebar (or press
   **Alt+P**). On first open you're prompted to add a repository
   (`owner/name`, e.g. `octocat/hello-world`).
2. **Multiple repositories**: the widget lists every monitored repo with its
   own Me / Author / Ready / Inbox counters. The **+** button in the widget header
   (or on the board's tab bar) adds another repo; hovering a tab in the board
   shows an **×** to stop monitoring it (removal lives inside the board only).
   Repos are identified by short name, falling back to the full `owner/name`
   when two monitored repos share a name.
3. **GitHub username** — set via **Settings**; leave blank to auto-use the
   `gh` login account (one identity across all repos).
4. **Review workspace** — also in **Settings**. When set, clicking a PR card
   jumps into the matching conversation inside DSH. Sessions are matched
   through a local PR→session binding table first, then by title search
   (`repo#N`, which works once a session's LLM-generated title exists); a
   miss creates a new session in the configured workspace, binds it, and —
   unless auto-prompt is off — sends it a first message naming the PR and
   asking what you'd like to do (review the diff, check CI, draft a
   comment, …). That first message is also what generates the session
   title. With no workspace set (or via the per-card **↗** button) cards
   open GitHub.
5. Config is stored per-browser (localStorage).

配置存在浏览器 localStorage（每个浏览器/设备设一次）；用户名留空则自动采用 host
上 `gh` 登录的账号；多仓库以短名区分，重名时回退完整 `owner/name`。

## How states are computed / 状态如何计算

For every open PR you have reviewed / commented on / been requested on, the host
fetches via GraphQL: `reviewDecision`, `mergeable`, draft flag, last commit time,
and the full review + comment timeline. Then:

- Your last action time vs the author's last activity time → who moved last
- Your approval timestamp vs the last commit timestamp → did new code land after
  your OK
- Other maintainers' change requests count as "waiting on author" too

对每个你参与过的 open PR，host 端经 GraphQL 取 `reviewDecision`、`mergeable`、
draft 标记、最后提交时间及完整 review/评论时间线，据此计算"双方最后动作"、
"批准后有无新提交"、"其他 maintainer 是否提过修改意见"等，得出最终分类。

## Privacy / 隐私

All queries run locally through your own `gh` CLI. No third-party service, no
telemetry, no data leaves your machine except GitHub API calls.

所有查询经本机 `gh` CLI 完成，无第三方服务、无遥测。

## License / 许可

[MIT](./LICENSE)
