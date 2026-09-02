// dsh-pr-board — maintainer PR review queue board for DeepSeek Harness
// ---------------------------------------------------------------
// State machine (for open PRs I'm involved in or requested on):
//   waiting_me     my move: review requested / author pushed or replied after my last action /
//                  new commits landed after my approval
//   waiting_author author's move: I (or another maintainer) requested changes and the author
//                  has been quiet since, or approved but draft/conflicting
//   ready_merge    ready: reviewDecision=APPROVED, mergeable, not draft
//   merged         done: recently merged
//   inbox          new & unclaimed: open PRs I never touched, one click adds me as reviewer
// Data: host-side execFile gh (search + batched GraphQL), cached 60s.
// Client: client/client.js — a first-class client plugin (module-loader bundle)
// with sidebar widget (counters) + fullscreen board (5 columns) + polling +
// transition toasts + click-a-card-to-open-or-start-the-review-session.
// Repo & username are not hardcoded: configure via Settings in the board header on first use,
// blank username falls back to the gh login account. Config is synced host-side
// (~/.dsh/pr-board.config.json) so every device hitting this web UI shares it;
// only the poll interval stays per-browser.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

export const name = "pr-board";
export const inject = ["webServer"];

// ---------------------------------------------------------------- host: gh execution

const GH_BIN = "gh";
const SEARCH_FIELDS = "number,title,url,author,createdAt,updatedAt,closedAt,state,isDraft";
// `gh search issues --json` rejects PR-only fields like isDraft.
const ISSUE_SEARCH_FIELDS = "number,title,url,author,createdAt,updatedAt,closedAt,state";

const GH_SETUP_HINT =
  "GitHub CLI (gh) not found on the DSH host. Install it from https://cli.github.com/ " +
  "and run `gh auth login`, then restart the web profile.";

// gh spawns fail with ENOENT when the binary is missing, and a genuinely
// unauthenticated gh surfaces as the CLI's own "gh auth login" onboarding
// hint in stderr. Everything else auth-FLAVOURED — proxy 401/407 (the word
// "Unauthorized" merely contains the letters "auth"), TLS, socket, timeout
// and 5xx blips — is transient and self-heals on the next poll; reporting
// those as "not authenticated" turned recoverable proxy hiccups into false
// auth alarms.
function ghError(r) {
  const raw = ((r.stderr || r.error) + "\n").split("\n")[0];
  if (/ENOENT/.test(r.error || "")) return GH_SETUP_HINT;
  if (/rate limit|secondary rate/i.test(raw)) {
    return "GitHub API rate limit hit (search allows ~30 requests/min). The board keeps showing the last good data — retry in a minute.";
  }
  // The CLI's own onboarding / re-auth instruction: the only persistent
  // "logged out" — it never heals by itself.
  if (/gh auth (login|refresh)/i.test(raw)) {
    return "GitHub CLI is not authenticated. Run `gh auth login` on the DSH host, then reload this page.";
  }
  // GitHub's canonical rejected-token body: persistent until the token is
  // fixed — point at gh auth status instead of promising a retry.
  if (/bad credentials/i.test(raw)) {
    return "GitHub rejected the token (Bad credentials). Run `gh auth status` on the DSH host to check the account.";
  }
  // Auth-adjacent but upstream-shaped: proxy 401/407, timeouts, connection
  // resets, TLS, 5xx, and silently-killed gh spawns. Transient — the board
  // keeps the last good data and retries on the next poll.
  if (/auth|login|credential|proxy|unauthorized|\b40[17]\b|http 5\d\d|\b5\d\d\b|timeout|timed out|connection|socket|tls|certificate|command failed/i.test(raw)) {
    return "Transient gh failure (proxy/network/GitHub API) — keeping the last good data, retrying next poll [" + raw.slice(0, 140) + "]";
  }
  return raw;
}

function gh(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(GH_BIN, args, { timeout: timeoutMs || 45000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""), error: err ? String(err.message) : "" });
    });
  });
}

async function ghSearch(repo, qualifiers, extraArgs) {
  const args = ["search", "prs", "--repo", repo, ...qualifiers, ...extraArgs, "--json", SEARCH_FIELDS];
  const r = await gh(args);
  if (!r.ok) throw new Error(ghError(r));
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error("failed to parse gh search output");
  }
}

// Repo-less PR search (the "mine" view spans every repo I authored in).
async function ghSearchAllPrs(qualifiers, extraArgs) {
  const args = ["search", "prs", ...qualifiers, ...extraArgs, "--json", SEARCH_FIELDS];
  const r = await gh(args);
  if (!r.ok) throw new Error(ghError(r));
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error("failed to parse gh search output");
  }
}

// Issue search: `gh search issues` also returns PRs unless `is:issue` pins it.
async function ghSearchIssues(repo, qualifiers, extraArgs) {
  const args = ["search", "issues", "--repo", repo, "is:issue", ...qualifiers, ...extraArgs, "--json", ISSUE_SEARCH_FIELDS];
  const r = await gh(args);
  if (!r.ok) throw new Error(ghError(r));
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error("failed to parse gh search output");
  }
}

// GraphQL batch fetch per-PR decision details (aliased chunks of up to 25)
async function ghDetails(owner, name, numbers) {
  return ghAliasedDetails(owner, name, numbers, "pullRequest", DETAIL_FIELDS);
}

async function ghIssueDetails(owner, name, numbers) {
  return ghAliasedDetails(owner, name, numbers, "issue", ISSUE_FIELDS);
}

async function ghAliasedDetails(owner, name, numbers, field, fields) {
  const out = [];
  for (let i = 0; i < numbers.length; i += 25) {
    const chunk = numbers.slice(i, i + 25);
    const alias = chunk.map((n, j) => `p${j}: ${field}(number:${n}){` + fields + "}").join("\n");
    const query = "query($o:String!,$n:String!){repository(owner:$o,name:$n){" + alias + "}}";
    const r = await gh(["api", "graphql", "-f", `query=${query}`, "-F", `o=${owner}`, "-F", `n=${name}`], 60000);
    if (!r.ok) throw new Error("graphql failed: " + ghError(r));
    let data;
    try {
      data = JSON.parse(r.stdout);
    } catch (e) {
      throw new Error("failed to parse graphql output");
    }
    if (data.errors) throw new Error("graphql error: " + JSON.stringify(data.errors).slice(0, 200));
    const repo = data.data && data.data.repository;
    for (let j = 0; j < chunk.length; j++) if (repo && repo["p" + j]) out.push(repo["p" + j]);
  }
  return out;
}

const DETAIL_FIELDS = [
  "number title url state isDraft",
  "author { login }",
  "createdAt updatedAt",
  "reviewDecision mergeable isInMergeQueue mergeStateStatus autoMergeRequest { enabledAt }",
  "commits(last:1) { nodes { commit { committedDate statusCheckRollup { state } } } }",
  "reviews(last:8) { nodes { author { login } state submittedAt comments(last:5) { nodes { author { login } createdAt } } } }",
  "comments(last:8) { nodes { author { login } createdAt } }",
].join("\n");

const ISSUE_FIELDS = [
  "number title url state",
  "author { login }",
  "createdAt updatedAt",
  "assignees(first:10) { nodes { login } }",
  "comments(last:10) { nodes { author { login } createdAt } }",
].join("\n");

// ---------------------------------------------------------------- host: state machine

function ts(v) {
  return v ? Date.parse(v) : 0;
}

function isBot(login) {
  return !login || /\[bot\]$/i.test(login) || login === "github-actions";
}

// Classify one PR. requestedSet = PR numbers where my review is requested.
function classify(pr, me, requestedSet) {
  const author = (pr.author && pr.author.login) || "";
  if (author === me) return "mine";

  const reviews = (pr.reviews && pr.reviews.nodes) || [];
  const comments = (pr.comments && pr.comments.nodes) || [];
  const lastCommit = ts(pr.commits && pr.commits.nodes && pr.commits.nodes[0] && pr.commits.nodes[0].commit && pr.commits.nodes[0].commit.committedDate);

  // My last action (review / issue comment / reply inside a review thread)
  let myLastAction = 0;
  let myLastReview = null;
  for (const rv of reviews) {
    if (rv.author && rv.author.login === me) {
      myLastAction = Math.max(myLastAction, ts(rv.submittedAt));
      if (!myLastReview || ts(rv.submittedAt) > ts(myLastReview.submittedAt)) myLastReview = rv;
    }
    for (const rc of (rv.comments && rv.comments.nodes) || []) {
      if (rc.author && rc.author.login === me) myLastAction = Math.max(myLastAction, ts(rc.createdAt));
    }
  }
  for (const c of comments) {
    if (c.author && c.author.login === me) myLastAction = Math.max(myLastAction, ts(c.createdAt));
  }

  // Author's last activity (push / issue comment / reply inside a review thread)
  let authorLast = lastCommit;
  for (const c of comments) {
    if (c.author && c.author.login === author) authorLast = Math.max(authorLast, ts(c.createdAt));
  }
  for (const rv of reviews) {
    if (rv.author && rv.author.login === author) authorLast = Math.max(authorLast, ts(rv.submittedAt));
    for (const rc of (rv.comments && rv.comments.nodes) || []) {
      if (rc.author && rc.author.login === author) authorLast = Math.max(authorLast, ts(rc.createdAt));
    }
  }

  // Any other maintainer's CHANGES_REQUESTED newer than my last review
  let otherChangeRequest = false;
  for (const rv of reviews) {
    const who = rv.author && rv.author.login;
    if (rv.state === "CHANGES_REQUESTED" && !isBot(who) && who !== me && who !== author) {
      if (!myLastReview || ts(rv.submittedAt) > ts(myLastReview.submittedAt)) otherChangeRequest = true;
    }
  }

  const requested = requestedSet.has(pr.number);
  const approved = pr.reviewDecision === "APPROVED";
  const myApproved = myLastReview && myLastReview.state === "APPROVED" ? ts(myLastReview.submittedAt) : 0;
  const commitsAfterMyApproval = myApproved && lastCommit > myApproved;

  // Merge queue: the merge machinery has taken over — but "taken over" splits
  // by CI state. Checks not STARTED (EXPECTED/absent) usually means a human
  // gate — in approval-gated workflows, mine: the queue is stalled until I
  // let the tests run, which is exactly a waiting-on-me. Checks RUNNING
  // (PENDING) or green is nobody's move; checks failed mid-queue get the PR
  // kicked out, and the fix is the author's.
  if (pr.isInMergeQueue) {
    const lastCommitNode = pr.commits && pr.commits.nodes && pr.commits.nodes[0] && pr.commits.nodes[0].commit;
    const ci = (lastCommitNode && lastCommitNode.statusCheckRollup && lastCommitNode.statusCheckRollup.state) || "";
    if (ci === "FAILURE" || ci === "ERROR") return { state: "waiting_author", reason: "queue-checks-failed" };
    if (ci === "EXPECTED" || ci === "") return { state: "waiting_me", reason: "queue-checks-awaiting" };
    return { state: "ready_merge", reason: "merge-queue" };
  }

  // Auto-merge: a standing promise to merge once requirements are met. When
  // something human-fixable blocks it (failing checks = BLOCKED, out-of-date
  // branch = BEHIND, conflicts = DIRTY) the fix is the author's job; while the
  // requirements are merely pending (UNKNOWN) or already green (CLEAN) nobody
  // has a move — the promise will complete itself. NOTE: the boolean field was
  // removed from the schema — on open PRs a non-null autoMergeRequest with an
  // enabledAt timestamp IS the armed signal (verified by introspection).
  if (pr.autoMergeRequest && pr.autoMergeRequest.enabledAt) {
    const blocked = pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "DIRTY";
    return blocked
      ? { state: "waiting_author", reason: "auto-merge-blocked" }
      : { state: "ready_merge", reason: "auto-merge" };
  }

  if (approved && !commitsAfterMyApproval) {
    if (pr.isDraft) return { state: "waiting_author", reason: "draft" };
    if (pr.mergeable === "CONFLICTING") return { state: "waiting_author", reason: "conflict" };
    return { state: "ready_merge", reason: "approved" };
  }
  // my move
  if (requested && (!myLastReview || myLastReview.state === "DISMISSED")) {
    return { state: "waiting_me", reason: myLastReview ? "re-request" : "review-requested" };
  }
  if (commitsAfterMyApproval) return { state: "waiting_me", reason: "new-commits-after-approve" };
  if (myLastAction && authorLast > myLastAction) return { state: "waiting_me", reason: "author-responded" };
  // author's move
  if (myLastReview && myLastReview.state === "CHANGES_REQUESTED") return { state: "waiting_author", reason: "changes-requested" };
  if (otherChangeRequest || pr.reviewDecision === "CHANGES_REQUESTED") return { state: "waiting_author", reason: "changes-requested-other" };
  if (myLastAction) return { state: "waiting_author", reason: "awaiting-author" };
  return "other";
}

// Support-queue state machine for issues: no review machinery, the turnstile
// is the comment timeline. Only the REPORTER's replies pull the thread back to
// "waiting on me" — third-party comments don't (they may be answering, not
// asking me); assigned/mentioned threads with no word from me yet are mine.
function classifyIssue(d, me, assignedSet, mentionedSet) {
  const comments = (d.comments && d.comments.nodes) || [];
  let myLast = 0, reporterLast = 0;
  for (const c of comments) {
    const who = c.author && c.author.login;
    const t = ts(c.createdAt);
    if (who === me) myLast = Math.max(myLast, t);
    else if (who === ((d.author && d.author.login) || "") && !isBot(who)) reporterLast = Math.max(reporterLast, t);
  }
  const assigned = assignedSet.has(d.number);
  const mentioned = mentionedSet.has(d.number);
  if (reporterLast > myLast) return { state: "waiting_me", reason: "replied", whenTs: reporterLast };
  if (myLast > 0) return { state: "waiting_reporter", reason: "awaiting-reporter", whenTs: myLast };
  if (assigned) return { state: "waiting_me", reason: "assigned", whenTs: ts(d.createdAt) };
  if (mentioned) return { state: "waiting_me", reason: "mentioned", whenTs: ts(d.createdAt) };
  return "other"; // commented-only thread with nothing new — not shown
}

// State machine for PRs I AUTHORED (the developer half of the board). The
// turnstile mirrors the maintainer view: a reviewer's change request, a red
// CI, conflicts or an unanswered reviewer comment are MY move; everything
// else — crickets, re-review, approved-awaiting-merge, queue, auto-merge —
// waits on others. The queue/auto-merge gates are the MAINTAINER's side, so
// they land in waiting_others even when blocked on a human.
function classifyMine(d, me) {
  const reviews = (d.reviews && d.reviews.nodes) || [];
  const comments = (d.comments && d.comments.nodes) || [];
  const lastCommitNode = d.commits && d.commits.nodes && d.commits.nodes[0] && d.commits.nodes[0].commit;
  const lastCommitTs = ts(lastCommitNode && lastCommitNode.committedDate);
  const ci = (lastCommitNode && lastCommitNode.statusCheckRollup && lastCommitNode.statusCheckRollup.state) || "";

  let myLast = lastCommitTs; // pushes are my actions
  let othersLast = 0;
  let changeRequestedAfterMyMove = false;
  let anyReview = false;
  for (const rv of reviews) {
    const who = rv.author && rv.author.login;
    const at = ts(rv.submittedAt);
    if (who === me) {
      myLast = Math.max(myLast, at);
    } else if (!isBot(who)) {
      anyReview = true;
      othersLast = Math.max(othersLast, at);
      if (rv.state === "CHANGES_REQUESTED" && at > myLast) changeRequestedAfterMyMove = true;
    }
    for (const rc of (rv.comments && rv.comments.nodes) || []) {
      const rca = (rc.author && rc.author.login) || "";
      const rcat = ts(rc.createdAt);
      if (rca === me) myLast = Math.max(myLast, rcat);
      else if (!isBot(rca)) othersLast = Math.max(othersLast, rcat);
    }
  }
  for (const c of comments) {
    const who = c.author && c.author.login;
    const at = ts(c.createdAt);
    if (who === me) myLast = Math.max(myLast, at);
    else if (!isBot(who)) othersLast = Math.max(othersLast, at);
  }

  if (d.isInMergeQueue) {
    if (ci === "FAILURE" || ci === "ERROR") return { state: "waiting_me", reason: "ci-failing", whenTs: othersLast || lastCommitTs };
    return { state: "waiting_others", reason: "merge-queue", whenTs: lastCommitTs };
  }
  if (d.autoMergeRequest && d.autoMergeRequest.enabledAt) {
    const mss = d.mergeStateStatus;
    if (ci === "FAILURE" || ci === "ERROR" || mss === "BLOCKED" || mss === "BEHIND" || mss === "DIRTY") {
      return { state: "waiting_me", reason: "auto-merge-blocked", whenTs: othersLast || lastCommitTs };
    }
    return { state: "waiting_others", reason: "auto-merge", whenTs: lastCommitTs };
  }
  if (changeRequestedAfterMyMove || d.reviewDecision === "CHANGES_REQUESTED") {
    return { state: "waiting_me", reason: "changes-requested", whenTs: othersLast || lastCommitTs };
  }
  if (ci === "FAILURE" || ci === "ERROR") return { state: "waiting_me", reason: "ci-failing", whenTs: lastCommitTs };
  if (d.mergeable === "CONFLICTING") return { state: "waiting_me", reason: "conflict", whenTs: lastCommitTs };
  if (othersLast > myLast) return { state: "waiting_me", reason: "respond", whenTs: othersLast };
  if (d.reviewDecision === "APPROVED") return { state: "waiting_others", reason: "approved", whenTs: othersLast || lastCommitTs };
  if (!anyReview) return { state: "waiting_others", reason: "awaiting-first-review", whenTs: d.createdAt ? ts(d.createdAt) : lastCommitTs };
  return { state: "waiting_others", reason: "re-review", whenTs: myLast };
}

function card(pr, verdict, extra) {
  // CI rollup rides the last-commit lookup (single field, same batched query);
  // search-API cards (inbox/merged) simply carry no ci.
  const lastCommit = pr.commits && pr.commits.nodes && pr.commits.nodes[0] && pr.commits.nodes[0].commit;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: (pr.author && pr.author.login) || "",
    isDraft: !!pr.isDraft,
    state: verdict && verdict.state ? verdict.state : verdict,
    reason: verdict && verdict.reason ? verdict.reason : "",
    when: extra && extra.when ? extra.when : "",
    whenTs: extra && extra.whenTs ? extra.whenTs : 0,
    mergeable: pr.mergeable,
    ci: (lastCommit && lastCommit.statusCheckRollup && lastCommit.statusCheckRollup.state) || "",
  };
}

// ---------------------------------------------------------------- host: aggregation + cache

const cache = new Map(); // key -> {at, promise}
const TTL_MS = 60000;

async function collect(repo, me, days) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("repo must be owner/name");

  const open = ["--state", "open"];

  // Inactivity filter: anything whose updatedAt (any touch — comments, pushes,
  // label changes) is older than N days drops out of every column. days<=0
  // disables it. Applied host-side so the counts the sidebar shows agree with
  // the board, and the threshold rides the cache key.
  const daysN = Number(days);
  const cutoff = Number.isFinite(daysN) && daysN > 0 ? Date.now() - daysN * 86400 * 1000 : 0;
  const active = (iso) => !cutoff || ts(iso) >= cutoff;

  // Four pools: review-requested / reviewed-by / commented (open) / recent involvement (incl. merged)
  // Issue pools degrade to empty on failure — issue data must never sink the
  // PR board (the sidebar's "error" chip should only mean the PR pipeline died).
  const iss = (p) => p.then((v) => v, () => []);
  const [requested, reviewed, commented, recent, newest, issAssigned, issMentioned, issCommented, issRecent] = await Promise.all([
    ghSearch(repo, [`review-requested:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`reviewed-by:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`commenter:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`reviewed-by:${me}`], ["--sort", "updated", "--limit", "30"]),
    ghSearch(repo, [], [...open, "--sort", "created", "--limit", "40"]),
    iss(ghSearchIssues(repo, [`assignee:${me}`], [...open, "--limit", "50"])),
    iss(ghSearchIssues(repo, [`mentions:${me}`], [...open, "--limit", "50"])),
    iss(ghSearchIssues(repo, [`commenter:${me}`], [...open, "--limit", "50"])),
    iss(ghSearchIssues(repo, [`involves:${me}`], ["--sort", "updated", "--limit", "30"])),
  ]);

  const requestedSet = new Set(requested.map((p) => p.number));
  const involvedMap = new Map();
  for (const p of [...requested, ...reviewed, ...commented]) involvedMap.set(p.number, p);

  // merged: recently merged PRs I reviewed
  const merged = recent
    .filter((p) => p.state === "merged" && active(p.closedAt))
    .sort((a, b) => ts(b.closedAt) - ts(a.closedAt))
    .slice(0, 8)
    .map((p) => card(p, { state: "merged", reason: "" }, { when: p.closedAt, whenTs: ts(p.closedAt) }));

  // Involved open PRs: fetch decision details via GraphQL
  const numbers = [...involvedMap.keys()];
  const details = numbers.length ? await ghDetails(owner, name, numbers) : [];
  const detailMap = new Map(details.map((d) => [d.number, d]));

  const cols = { waiting_me: [], waiting_author: [], ready_merge: [], inbox: [] };
  for (const num of numbers) {
    const d = detailMap.get(num);
    if (!d || d.state !== "OPEN") continue;
    if (!active(d.updatedAt)) continue; // dormant beyond the inactivity window
    const verdict = classify(d, me, requestedSet);
    if (typeof verdict === "string") continue; // mine / other: not shown
    let when = "", whenTs = 0;
    if (verdict.state === "waiting_me") {
      const lastCommit = d.commits && d.commits.nodes[0] && d.commits.nodes[0].commit;
      whenTs = Math.max(ts(d.updatedAt), ts(lastCommit && lastCommit.committedDate));
    } else if (verdict.state === "ready_merge" || verdict.state === "waiting_author") {
      whenTs = ts(d.updatedAt);
    }
    if (whenTs) when = new Date(whenTs).toISOString();
    cols[verdict.state].push(card(d, verdict, { when, whenTs }));
  }

  // inbox: newest open PRs I'm not involved in (updatedAt, not createdAt — a
  // 40-day-old PR the author still pushes to is active)
  for (const p of newest) {
    if (involvedMap.has(p.number) || (p.author && p.author.login) === me) continue;
    if (!active(p.updatedAt)) continue;
    cols.inbox.push(card(p, { state: "inbox", reason: "" }, { when: p.createdAt, whenTs: ts(p.createdAt) }));
  }

  cols.waiting_me.sort((a, b) => b.whenTs - a.whenTs);
  cols.waiting_author.sort((a, b) => b.whenTs - a.whenTs);
  cols.ready_merge.sort((a, b) => b.whenTs - a.whenTs);
  cols.inbox.sort((a, b) => b.whenTs - a.whenTs);

  // ---------------- issues: support-queue view ----------------
  const assignedSet = new Set(issAssigned.map((i) => i.number));
  const mentionedSet = new Set(issMentioned.map((i) => i.number));
  const issueMap = new Map();
  for (const i of [...issAssigned, ...issMentioned, ...issCommented]) issueMap.set(i.number, i);

  const issueCols = { waiting_me: [], waiting_reporter: [], closed_recent: [] };
  const issueNumbers = [...issueMap.keys()];
  const issueDetails = issueNumbers.length ? await ghIssueDetails(owner, name, issueNumbers) : [];
  const issueDetailMap = new Map(issueDetails.map((d) => [d.number, d]));
  for (const num of issueNumbers) {
    const d = issueDetailMap.get(num);
    if (!d || d.state !== "OPEN") continue;
    if (!active(d.updatedAt)) continue;
    const verdict = classifyIssue(d, me, assignedSet, mentionedSet);
    if (typeof verdict === "string") continue;
    const when = verdict.whenTs ? new Date(verdict.whenTs).toISOString() : "";
    issueCols[verdict.state].push(card(d, { state: verdict.state, reason: verdict.reason }, { when, whenTs: verdict.whenTs || 0 }));
  }
  // recently closed issues I was involved in (regression watch), newest first
  const CLOSED_WINDOW_MS = 14 * 86400 * 1000;
  const closedRecent = issRecent
    .filter((i) => i.state === "CLOSED" && Date.now() - ts(i.closedAt) < CLOSED_WINDOW_MS && active(i.closedAt))
    .sort((a, b) => ts(b.closedAt) - ts(a.closedAt))
    .slice(0, 8)
    .map((i) => card(i, { state: "closed_recent", reason: "" }, { when: i.closedAt, whenTs: ts(i.closedAt) }));
  issueCols.closed_recent = closedRecent;

  issueCols.waiting_me.sort((a, b) => b.whenTs - a.whenTs);
  issueCols.waiting_reporter.sort((a, b) => b.whenTs - a.whenTs);

  return {
    ok: true,
    repo,
    user: me,
    generatedAt: new Date().toISOString(),
    counts: {
      waiting_me: cols.waiting_me.length,
      waiting_author: cols.waiting_author.length,
      ready_merge: cols.ready_merge.length,
      merged: merged.length,
      inbox: cols.inbox.length,
    },
    columns: { ...cols, merged },
    issueCounts: {
      waiting_me: issueCols.waiting_me.length,
      waiting_reporter: issueCols.waiting_reporter.length,
      closed_recent: issueCols.closed_recent.length,
    },
    issueColumns: issueCols,
  };
}

async function boardData(repo, me, fresh, days) {
  const key = repo + "#" + me + "#" + (days || 0);
  const hit = cache.get(key);
  // fresh=1 (the Refresh button) bypasses the 60s TTL but not an 8s floor:
  // two quick clicks would otherwise fire the full 9-search burst per repo
  // straight into the 30-requests/min search quota.
  const minAge = fresh ? 8000 : TTL_MS;
  if (hit && Date.now() - hit.at < minAge) return hit.promise;
  const promise = collect(repo, me, days).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

async function boardDataMulti(repos, me, fresh, days) {
  // One collect() per repo, each cached independently; a repo that fails
  // degrades to its own error entry instead of sinking the whole response.
  // The "mine" view (PRs I authored, every repo) rides along, cached apart.
  const [out, mine] = await Promise.all([
    Promise.all(
      repos.map(async (repo) => {
        try {
          const d = await boardData(repo, me, fresh, days);
          if (!d.ok) return { repo, ok: false, error: d.error };
          return { repo, ok: true, counts: d.counts, columns: d.columns, issueCounts: d.issueCounts, issueColumns: d.issueColumns };
        } catch (e) {
          return { repo, ok: false, error: String((e && e.message) || e) };
        }
      })
    ),
    boardDataMine(me, fresh, days),
  ]);
  return { ok: true, user: me, generatedAt: new Date().toISOString(), repos: out, mine };
}

// "owner/name" out of a PR url — the global author search spans repos, so the
// board's repo identity comes from each result itself.
function repoFromUrl(url) {
  const m = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\//.exec(url || "");
  return m ? m[1] + "/" + m[2] : "";
}

async function collectMine(me, days) {
  const open = ["--state", "open"];
  const [mineOpen, mineRecent] = await Promise.all([
    ghSearchAllPrs([`author:${me}`], [...open, "--limit", "50"]),
    ghSearchAllPrs([`author:${me}`], ["--sort", "updated", "--limit", "30"]),
  ]);

  const daysN = Number(days);
  const cutoff = Number.isFinite(daysN) && daysN > 0 ? Date.now() - daysN * 86400 * 1000 : 0;
  const active = (iso) => !cutoff || ts(iso) >= cutoff;

  // Group open PRs by repo for the batched per-repo detail fetches.
  const byRepo = new Map();
  for (const p of mineOpen) {
    const repo = repoFromUrl(p.url);
    if (!repo) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push(p.number);
  }
  const detailLists = await Promise.all(
    [...byRepo.entries()].map(async ([repo, numbers]) => {
      const [owner, name] = repo.split("/");
      try {
        return (await ghAliasedDetails(owner, name, numbers, "pullRequest", DETAIL_FIELDS)).map((d) => ({ ...d, repo }));
      } catch (e) {
        return []; // one repo's details failing must not sink the whole view
      }
    })
  );

  const cols = { waiting_me: [], waiting_others: [] };
  for (const d of detailLists.flat()) {
    if (d.state !== "OPEN" || !active(d.updatedAt)) continue;
    const verdict = classifyMine(d, me);
    const when = verdict.whenTs ? new Date(verdict.whenTs).toISOString() : "";
    const c = card(d, { state: verdict.state, reason: verdict.reason }, { when, whenTs: verdict.whenTs || 0 });
    c.repo = d.repo;
    cols[verdict.state].push(c);
  }
  const CLOSED_WINDOW_MS = 14 * 86400 * 1000;
  const merged = mineRecent
    .filter((p) => p.state === "merged" && Date.now() - ts(p.closedAt) < CLOSED_WINDOW_MS && active(p.closedAt))
    .sort((a, b) => ts(b.closedAt) - ts(a.closedAt))
    .slice(0, 8)
    .map((p) => {
      const c = card(p, { state: "merged", reason: "" }, { when: p.closedAt, whenTs: ts(p.closedAt) });
      c.repo = repoFromUrl(p.url);
      return c;
    });

  cols.waiting_me.sort((a, b) => b.whenTs - a.whenTs);
  cols.waiting_others.sort((a, b) => b.whenTs - a.whenTs);
  return {
    ok: true,
    counts: { waiting_me: cols.waiting_me.length, waiting_others: cols.waiting_others.length, merged: merged.length },
    columns: { ...cols, merged },
  };
}

async function boardDataMine(me, fresh, days) {
  const key = "mine#" + me + "#" + (days || 0);
  const hit = cache.get(key);
  const minAge = fresh ? 8000 : TTL_MS;
  if (hit && Date.now() - hit.at < minAge) return hit.promise;
  const promise = collectMine(me, days).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

// Resolved-username cache: with a blank configured username every /data call
// used to hit `gh api user` — one REST call per refresh per browser for a fact
// that changes ~never. 10-minute TTL.
const userCache = new Map();
const USER_TTL_MS = 10 * 60 * 1000;

async function resolveUser(user) {
  if (user) return user;
  const hit = userCache.get("me");
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.login;
  const r = await gh(["api", "user", "-q", ".login"]);
  if (!r.ok) throw new Error("gh api user failed: " + ghError(r));
  const login = r.stdout.trim();
  userCache.set("me", { at: Date.now(), login });
  return login;
}

// ---------------------------------------------------------------- host: routes

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------- host: shared config
// Survives plugin reinstalls (lives in ~/.dsh, not the managed package dir)
// and is shared by every browser/device hitting this web UI. Only the fields
// that make sense account-wide sync; per-device preferences (poll interval)
// stay in each browser's localStorage.

const HOST_CFG_FILE = join(homedir(), ".dsh", "pr-board.config.json");

function sanitizeCfg(c) {
  if (!c || typeof c !== "object") return null;
  const repos = Array.isArray(c.repos)
    ? c.repos.filter((r) => typeof r === "string" && /^[^/\s]+\/[^/\s]+$/.test(r)).slice(0, 50)
    : [];
  const user = typeof c.user === "string" ? c.user.slice(0, 80) : "";
  const autoprompt = c.autoprompt !== false;
  const days = Number(c.inactiveDays);
  const inactiveDays = Number.isFinite(days) ? Math.min(365, Math.max(0, Math.round(days))) : 30;
  // Per-repo review workspaces (repo -> workspaceId). There is no global
  // default; a legacy scalar `workspace` in the payload is ignored (clients
  // migrate it into the map themselves).
  const workspaces = {};
  if (c.workspaces && typeof c.workspaces === "object" && !Array.isArray(c.workspaces)) {
    for (const [repo, id] of Object.entries(c.workspaces)) {
      if (typeof repo === "string" && /^[^/\s]+\/[^/\s]+$/.test(repo) && typeof id === "string" && id.length <= 120) {
        workspaces[repo] = id;
      }
    }
  }
  return { repos, user, workspaces, autoprompt, inactiveDays };
}

async function readHostCfg() {
  try {
    return sanitizeCfg(JSON.parse(await readFile(HOST_CFG_FILE, "utf8")));
  } catch (e) {
    return null;
  }
}

async function writeHostCfg(cfg) {
  await writeFile(HOST_CFG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------- host: global PR→session bindings
// Separate file and merge-style endpoints (never whole-object replace): a
// binding is written the moment a card click creates/adopts a session, and
// every browser reads the shared map so the FIRST click on a new device
// resolves exactly instead of betting on LLM titles containing "#N".

const HOST_BIND_FILE = join(homedir(), ".dsh", "pr-board.bindings.json");
const BINDINGS_CAP = 500;

function validBindingKey(key) {
  return typeof key === "string" && /^[^/\s]+\/[^/\s]+#\d+$/.test(key) && key.length <= 160;
}

async function readHostBindings() {
  try {
    const raw = JSON.parse(await readFile(HOST_BIND_FILE, "utf8"));
    const out = {};
    if (raw && typeof raw === "object") {
      for (const [key, entry] of Object.entries(raw)) {
        if (!validBindingKey(key) || !entry || typeof entry.sid !== "string" || entry.sid.length > 120) continue;
        // Keys are canonicalized to lowercase: repo casing varies across
        // devices and case-sensitive keys split one PR into two bindings.
        const lk = key.toLowerCase();
        if (!out[lk] || (Number(entry.t) || 0) >= (out[lk].t || 0)) out[lk] = { sid: entry.sid, t: Number(entry.t) || 0 };
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

async function writeHostBindings(map) {
  await writeFile(HOST_BIND_FILE, JSON.stringify(map, null, 2) + "\n", "utf8");
}

// Merge one binding (newest wins per key) and optionally release any OTHER
// key still pointing at the same session (a session belongs to one PR).
async function mergeHostBinding(key, sid, release) {
  const map = await readHostBindings();
  key = String(key).toLowerCase();
  map[key] = { sid, t: Date.now() };
  if (release) {
    for (const k of Object.keys(map)) {
      if (k !== key && map[k].sid === sid) delete map[k];
    }
  }
  // Cap growth: drop the oldest entries beyond the limit.
  const keys = Object.keys(map);
  if (keys.length > BINDINGS_CAP) {
    keys.sort((a, b) => (map[a].t || 0) - (map[b].t || 0));
    for (const k of keys.slice(0, keys.length - BINDINGS_CAP)) delete map[k];
  }
  await writeHostBindings(map);
  return map;
}

function queryParam(req, key) {
  try {
    return new URL(req.url || "", "http://localhost").searchParams.get(key) || "";
  } catch (e) {
    return "";
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(buf || "{}"));
      } catch (e) {
        resolve({});
      }
    });
  });
}

export function apply(ctx) {
  ctx.effect(() => {
    const routes = [
      {
        kind: "exact",
        path: "/api/pr-board/bindings",
        handler: (req, res) => {
          if (req.method === "GET") {
            readHostBindings().then((bindings) => json(res, 200, { ok: true, bindings }), (e) => json(res, 500, { ok: false, error: String((e && e.message) || e) }));
            return;
          }
          if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
          readBody(req).then(async (body) => {
            const key = body && body.key;
            const sid = body && body.sid;
            // sid === "" is a DELETE: the bound session is gone or archived
            // and the stale entry must not haunt every other browser.
            if (!validBindingKey(key) || typeof sid !== "string" || sid.length > 120) {
              return json(res, 400, { ok: false, error: "invalid binding" });
            }
            try {
              if (sid === "") {
                const map = await readHostBindings();
                delete map[String(key).toLowerCase()];
                await writeHostBindings(map);
              } else {
                await mergeHostBinding(key, sid, body.release === true);
              }
              json(res, 200, { ok: true });
            } catch (e) {
              json(res, 500, { ok: false, error: "binding write failed: " + String((e && e.message) || e) });
            }
          });
        },
      },
      {
        kind: "exact",
        path: "/api/pr-board/config",
        handler: (req, res) => {
          if (req.method === "GET") {
            readHostCfg().then((cfg) => json(res, 200, { ok: true, config: cfg }), (e) => json(res, 500, { ok: false, error: String((e && e.message) || e) }));
            return;
          }
          if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
          readBody(req).then(async (body) => {
            const cfg = sanitizeCfg(body);
            if (!cfg) return json(res, 400, { ok: false, error: "invalid config" });
            try {
              await writeHostCfg(cfg);
              json(res, 200, { ok: true });
            } catch (e) {
              json(res, 500, { ok: false, error: "config write failed: " + String((e && e.message) || e) });
            }
          });
        },
      },
      {
        kind: "exact",
        path: "/api/pr-board/data",
        handler: (req, res) => {
          if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
          const repos = queryParam(req, "repos").split(",").map((r) => r.trim()).filter(Boolean);
          if (!repos.length) {
            return json(res, 400, { ok: false, error: "No repositories configured: add one via + in the sidebar widget" });
          }
          const fresh = queryParam(req, "fresh") === "1";
          const daysRaw = parseInt(queryParam(req, "days"), 10);
          const days = Number.isFinite(daysRaw) ? daysRaw : 30;
          resolveUser(queryParam(req, "user"))
            .then((me) => boardDataMulti(repos, me, fresh, days))
            .then((v) => json(res, 200, v), (e) => json(res, 500, { ok: false, error: String((e && e.message) || e) }));
        },
      },
      {
        kind: "exact",
        path: "/api/pr-board/watch",
        handler: (req, res) => {
          if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
          readBody(req).then(async (body) => {
            const repo = body.repo || "";
            const number = parseInt(body.number, 10);
            const me = body.user || "";
            if (!/^[^/]+\/[^/]+$/.test(repo) || !number || !me) return json(res, 400, { ok: false, error: "missing parameters" });
            const r = await gh(["api", "-X", "POST", `repos/${repo}/pulls/${number}/requested_reviewers`, "-f", `reviewers[]=${me}`]);
            if (!r.ok) return json(res, 200, { ok: false, error: ghError(r) });
            for (const key of [...cache.keys()]) if (key.startsWith(repo + "#" + me + "#")) cache.delete(key);
            json(res, 200, { ok: true });
          });
        },
      },
    ];
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "pr-board: routes");
}


