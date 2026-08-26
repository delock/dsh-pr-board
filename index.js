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
// Client: sidebar widget (counters) + fullscreen board (5 columns) + polling + transition toasts.
// Repo & username are not hardcoded: configure via Settings in the board header on first use,
// blank username falls back to the gh login account; config lives in browser localStorage.

import { execFile } from "node:child_process";

export const name = "pr-board";
export const inject = ["webServer"];

// ---------------------------------------------------------------- host: gh execution

const GH_BIN = "gh";
const SEARCH_FIELDS = "number,title,url,author,createdAt,updatedAt,closedAt,state,isDraft";

// gh spawns fail with ENOENT when the binary is missing, and unauthenticated
// runs surface as "gh auth login" hints in stderr. Translate both into
// actionable setup messages instead of raw spawn errors.
const GH_SETUP_HINT =
  "GitHub CLI (gh) not found on the DSH host. Install it from https://cli.github.com/ " +
  "and run `gh auth login`, then restart the web profile.";

function ghError(r) {
  const raw = ((r.stderr || r.error) + "\n").split("\n")[0];
  if (/ENOENT/.test(r.error || "")) return GH_SETUP_HINT;
  if (/auth|login|credential/i.test(raw)) {
    return "GitHub CLI is not authenticated. Run `gh auth login` on the DSH host, then reload this page.";
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

// GraphQL batch fetch per-PR decision details (aliased chunks of up to 25)
async function ghDetails(owner, name, numbers) {
  const out = [];
  for (let i = 0; i < numbers.length; i += 25) {
    const chunk = numbers.slice(i, i + 25);
    const alias = chunk.map((n, j) => `p${j}: pullRequest(number:${n}){` + DETAIL_FIELDS + "}").join("\n");
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
  "reviewDecision mergeable",
  "commits(last:1) { nodes { commit { committedDate } } }",
  "reviews(last:8) { nodes { author { login } state submittedAt comments(last:5) { nodes { author { login } createdAt } } } }",
  "comments(last:8) { nodes { author { login } createdAt } }",
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

function card(pr, verdict, extra) {
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
  };
}

// ---------------------------------------------------------------- host: aggregation + cache

const cache = new Map(); // key -> {at, promise}
const TTL_MS = 60000;

async function collect(repo, me) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("repo must be owner/name");

  const open = ["--state", "open"];

  // Four pools: review-requested / reviewed-by / commented (open) / recent involvement (incl. merged)
  const [requested, reviewed, commented, recent, newest] = await Promise.all([
    ghSearch(repo, [`review-requested:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`reviewed-by:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`commenter:${me}`], [...open, "--limit", "50"]),
    ghSearch(repo, [`reviewed-by:${me}`], ["--sort", "updated", "--limit", "30"]),
    ghSearch(repo, [], [...open, "--sort", "created", "--limit", "40"]),
  ]);

  const requestedSet = new Set(requested.map((p) => p.number));
  const involvedMap = new Map();
  for (const p of [...requested, ...reviewed, ...commented]) involvedMap.set(p.number, p);

  // merged: recently merged PRs I reviewed
  const merged = recent
    .filter((p) => p.state === "merged")
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

  // inbox: newest open PRs I'm not involved in
  for (const p of newest) {
    if (involvedMap.has(p.number) || (p.author && p.author.login) === me) continue;
    cols.inbox.push(card(p, { state: "inbox", reason: "" }, { when: p.createdAt, whenTs: ts(p.createdAt) }));
  }

  cols.waiting_me.sort((a, b) => b.whenTs - a.whenTs);
  cols.waiting_author.sort((a, b) => b.whenTs - a.whenTs);
  cols.ready_merge.sort((a, b) => b.whenTs - a.whenTs);
  cols.inbox.sort((a, b) => b.whenTs - a.whenTs);

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
  };
}

async function boardData(repo, me, fresh) {
  const key = repo + "#" + me;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = collect(repo, me).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

async function resolveUser(user) {
  if (user) return user;
  const r = await gh(["api", "user", "-q", ".login"]);
  if (!r.ok) throw new Error("gh api user failed: " + ghError(r));
  return r.stdout.trim();
}

// ---------------------------------------------------------------- host: routes

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
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
  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "style", text: CSS_TEXT });
    table.push({ kind: "script", placement: "head", text: JS_TEXT });
  });

  ctx.effect(() => {
    const routes = [
      {
        kind: "exact",
        path: "/api/pr-board/data",
        handler: (req, res) => {
          if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
          const repo = queryParam(req, "repo").trim();
          if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
            return json(res, 400, { ok: false, error: "Repository not configured: set owner/name via Settings in the board header" });
          }
          const fresh = queryParam(req, "fresh") === "1";
          resolveUser(queryParam(req, "user"))
            .then((me) => boardData(repo, me, fresh))
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
            cache.delete(repo + "#" + me);
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

// ---------------------------------------------------------------- client injection

const CSS_TEXT = `
#pr-board-widget{flex:none;margin-top:8px;padding:8px 2px 2px;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent);font-size:12px;color:inherit;min-width:0;cursor:pointer}
#pr-board-widget .pbw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-weight:600;gap:6px}
#pr-board-widget .pbw-row{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
#pr-board-widget .pbw-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:8px;font-size:11px;font-weight:600;background:color-mix(in srgb,currentColor 10%,transparent)}
#pr-board-widget .pbw-chip b{font-weight:700}
#pr-board-widget .pbw-chip.me b{color:#60a5fa}
#pr-board-widget .pbw-chip.author b{color:#fbbf24}
#pr-board-widget .pbw-chip.ready b{color:#34d399}
#pr-board-widget.pbw-pulse{animation:pbw-flash 1.2s 3}
@keyframes pbw-flash{50%{background:color-mix(in srgb,#60a5fa 25%,transparent)}}
#pr-board-overlay{position:fixed;inset:0;z-index:2147483000;display:none;background:color-mix(in srgb,#000000 62%,transparent);backdrop-filter:blur(3px)}
#pr-board-overlay.pb-show{display:flex;flex-direction:column}
#pr-board-overlay .pbo-head{display:flex;align-items:center;gap:10px;padding:12px 18px;color:#fff;background:#161b22;flex:none}
#pr-board-overlay .pbo-title{font-size:15px;font-weight:700}
#pr-board-overlay .pbo-sub{font-size:12px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pr-board-overlay .pbo-spacer{flex:1}
#pr-board-overlay select,#pr-board-overlay .pbo-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:12px;cursor:pointer}
#pr-board-overlay .pbo-btn:hover{background:rgba(255,255,255,.18)}
#pr-board-overlay .pbo-body{flex:1;overflow:auto;display:grid;gap:10px;padding:12px 14px;grid-template-columns:repeat(5,minmax(230px,1fr));align-content:start}
@media (max-width:1100px){#pr-board-overlay .pbo-body{grid-template-columns:repeat(2,minmax(230px,1fr))}}
#pr-board-overlay .pbo-col{display:flex;flex-direction:column;gap:8px;min-width:0}
#pr-board-overlay .pbo-col-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#fff;padding:2px 4px;flex:none}
#pr-board-overlay .pbo-col-head .pbo-count{font-size:11px;opacity:.7;font-weight:600}
#pr-board-overlay .pbo-sort{margin-left:auto;padding:1px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:11px;cursor:pointer;flex:none}
#pr-board-overlay .pbo-sort:hover{background:rgba(255,255,255,.18)}
#pr-board-overlay .pbo-col-head i{width:8px;height:8px;border-radius:50%;flex:none}
#pr-board-overlay .pbo-card{padding:8px 10px;border-radius:8px;background:#1c2129;color:#d7dde5;font-size:12px;line-height:1.45;cursor:pointer;border:1px solid transparent;min-width:0}
#pr-board-overlay .pbo-card:hover{border-color:rgba(255,255,255,.25);background:#232935}
#pr-board-overlay .pbo-num{font-weight:700;color:#7aa7ff;margin-right:4px}
#pr-board-overlay .pbo-title-line{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#pr-board-overlay .pbo-meta{display:flex;gap:6px;align-items:center;margin-top:5px;opacity:.65;font-size:11px;flex-wrap:wrap}
#pr-board-overlay .pbo-reason{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(255,255,255,.1);color:#fff}
#pr-board-overlay .pbo-badge-conflict{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(239,68,68,.25);color:#fca5a5}
#pr-board-overlay .pbo-badge-draft{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(148,163,184,.25);color:#cbd5e1}
#pr-board-overlay .pbo-claim{margin-top:6px;width:100%;padding:3px 0;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(125,211,252,.15);color:#bae6fd;font-size:11px;font-weight:600;cursor:pointer}
#pr-board-overlay .pbo-claim:hover{background:rgba(125,211,252,.3)}
#pr-board-overlay .pbo-empty{padding:10px;border-radius:8px;border:1px dashed rgba(255,255,255,.15);color:rgba(255,255,255,.4);font-size:11px;text-align:center}
#pr-board-overlay .pbo-error{margin:20px auto;padding:10px 16px;border-radius:8px;background:rgba(239,68,68,.15);color:#fca5a5;font-size:13px;max-width:520px}
#pr-board-overlay .pbo-loading{color:rgba(255,255,255,.5);font-size:12px;padding:6px 4px}
#pr-board-toast{position:fixed;right:16px;bottom:16px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;max-width:340px}
#pr-board-toast .pbt{padding:9px 13px;border-radius:8px;background:#1f6feb;color:#fff;font-size:12.5px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;opacity:.97}
#pr-board-toast .pbt b{font-weight:700}
`;

const JS_TEXT = `(function () {
  var CFG_KEY = "prboard.cfg", LAST_KEY = "prboard.last";
  var DEFAULTS = { repo: "", user: "", interval: 5, sort: { waiting_me: "new", waiting_author: "new" } };
  var COLS = [
    { key: "waiting_me", name: "Waiting on me", color: "#60a5fa" },
    { key: "waiting_author", name: "Waiting on author", color: "#fbbf24" },
    { key: "ready_merge", name: "Ready to merge", color: "#34d399" },
    { key: "merged", name: "Merged", color: "#94a3b8" },
    { key: "inbox", name: "Inbox", color: "#c4b5fd" }
  ];
  var REASONS = {
    "review-requested": "Review requested",
    "re-request": "Re-requested",
    "author-responded": "Author responded",
    "new-commits-after-approve": "New commits after approval",
    "changes-requested": "Changes requested",
    "changes-requested-other": "Another maintainer requested changes",
    "awaiting-author": "Awaiting author",
    "conflict": "Approved but conflicting",
    "draft": "Approved but draft"
  };
  var cfg = loadCfg(), pollTimer = null, data = null, busy = false;

  function loadCfg() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  function api(path, opts) { return fetch(path, opts).then(function (r) { return r.json(); }); }

  function timeAgo(iso) {
    if (!iso) return "";
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- data loading + transition detection ----------
  function refresh(fresh, quiet) {
    if (!cfg.repo) {
      data = { ok: false, error: "Repository not configured" };
      renderWidget();
      renderBoard();
      return Promise.resolve();
    }
    if (busy) return Promise.resolve();
    busy = true;
    var q = "?repo=" + encodeURIComponent(cfg.repo) + "&user=" + encodeURIComponent(cfg.user) + (fresh ? "&fresh=1" : "");
    return api("/api/pr-board/data" + q).then(function (v) {
      busy = false;
      data = v;
      renderWidget();
      renderBoard();
      if (v.ok && !quiet) detectTransitions(v);
    }).catch(function () { busy = false; });
  }

  function detectTransitions(v) {
    var prev = null;
    try { prev = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (e) {}
    var nowMe = (v.columns.waiting_me || []).map(function (c) { return c.number; });
    if (prev && prev.repo === v.repo) {
      var prevSet = {};
      (prev.waiting_me || []).forEach(function (n) { prevSet[n] = 1; });
      var arrived = nowMe.filter(function (n) { return !prevSet[n]; });
      arrived.forEach(function (n) {
        var c = v.columns.waiting_me.filter(function (x) { return x.number === n; })[0];
        toast("PR #" + n + (c ? " " + c.title.slice(0, 40) : "") + " is back to you" +
          (c && REASONS[c.reason] ? " (" + REASONS[c.reason] + ")" : ""), c && c.url);
      });
      if (arrived.length) {
        var w = document.getElementById("pr-board-widget");
        if (w) { w.classList.remove("pbw-pulse"); void w.offsetWidth; w.classList.add("pbw-pulse"); }
      }
    }
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ repo: v.repo, t: Date.now(), waiting_me: nowMe })); } catch (e) {}
  }

  function toast(text, url) {
    var host = document.getElementById("pr-board-toast");
    if (!host) {
      host = document.createElement("div");
      host.id = "pr-board-toast";
      document.body.appendChild(host);
    }
    var t = document.createElement("div");
    t.className = "pbt";
    t.innerHTML = "<b>PR Board</b><br>" + esc(text);
    t.onclick = function () { if (url) window.open(url, "_blank"); t.remove(); };
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 30000);
  }

  // ---------- sidebar widget ----------
  // Locate the sidebar root: ui-sidebar defines --dsh-sidebar-inline-padding on it.
  // Walk up from the New-chat button first, then fall back to a full-page CSS-variable scan.
  function findSidebar() {
    var btns = document.querySelectorAll("button"), i, p, cs, d;
    for (i = 0; i < btns.length; i++) {
      if (!/(new|新建)/i.test(btns[i].textContent || "")) continue; // "新建" = New in Chinese UIs
      p = btns[i].parentElement;
      for (d = 0; p && d < 6; d++) {
        try { cs = getComputedStyle(p); } catch (e) { break; }
        if (cs.getPropertyValue("--dsh-sidebar-inline-padding")) return p;
        p = p.parentElement;
      }
    }
    var els = document.querySelectorAll("body *");
    for (i = 0; i < els.length; i++) {
      try { cs = getComputedStyle(els[i]); } catch (e) { continue; }
      if (cs.getPropertyValue("--dsh-sidebar-inline-padding")) return els[i];
    }
    return null;
  }

  function widgetHtml() {
    return '<div class="pbw-head"><span>PR Board</span></div><div class="pbw-row" id="pbw-row">' +
      '<span class="pbw-chip" style="opacity:.6">Loading…</span></div>';
  }

  // Mount the widget into the sidebar (move + clear pill inline styles if it exists)
  function mountInSidebar(sidebar) {
    var w = document.getElementById("pr-board-widget");
    if (!w) {
      w = document.createElement("div");
      w.id = "pr-board-widget";
      w.innerHTML = widgetHtml();
      w.onclick = openBoard;
    } else {
      w.style.cssText = "";
    }
    sidebar.insertBefore(w, sidebar.lastChild);
    return w;
  }

  function renderWidget() {
    var row = document.getElementById("pbw-row");
    if (!row) return;
    if (!cfg.repo) {
      row.innerHTML = '<span class="pbw-chip" style="opacity:.6">Not configured · click to set up</span>';
      return;
    }
    if (!data || !data.ok) {
      row.innerHTML = '<span class="pbw-chip" style="opacity:.6">' + esc((data && data.error) || "Loading…") + "</span>";
      return;
    }
    var c = data.counts;
    row.innerHTML =
      '<span class="pbw-chip me">Me <b>' + c.waiting_me + "</b></span>" +
      '<span class="pbw-chip author">Author <b>' + c.waiting_author + "</b></span>" +
      '<span class="pbw-chip ready">Ready <b>' + c.ready_merge + "</b></span>";
  }

  // ---------- board ----------
  function cardHtml(c, colKey) {
    var meta = '<div class="pbo-meta"><span>@' + esc(c.author) + "</span>" +
      (c.when ? "<span>" + esc(timeAgo(c.when)) + "</span>" : "");
    if (colKey !== "merged" && c.reason && REASONS[c.reason]) meta += '<span class="pbo-reason">' + esc(REASONS[c.reason]) + "</span>";
    if (c.mergeable === "CONFLICTING") meta += '<span class="pbo-badge-conflict">conflict</span>';
    if (c.isDraft) meta += '<span class="pbo-badge-draft">draft</span>';
    meta += "</div>";
    var claim = colKey === "inbox"
      ? '<button class="pbo-claim" data-claim="' + c.number + '">I&#39;ll review</button>' : "";
    return '<div class="pbo-card" data-url="' + esc(c.url) + '">' +
      '<div class="pbo-title-line"><span class="pbo-num">#' + c.number + "</span>" + esc(c.title) + "</div>" + meta + claim + "</div>";
  }

  function renderBoard() {
    var body = document.getElementById("pbo-body");
    if (!body) return;
    if (!data) { body.innerHTML = '<div class="pbo-loading">Loading…</div>'; return; }
    if (!cfg.repo) { body.innerHTML = '<div class="pbo-error">Repository not configured: set owner/name via Settings in the board header (e.g. octocat/hello-world)</div>'; return; }
    if (!data.ok) { body.innerHTML = '<div class="pbo-error">' + esc(data.error || "load failed") + "</div>"; return; }
    var sub = document.getElementById("pbo-sub");
    if (sub) sub.textContent = data.repo + " · @" + data.user + " · updated " + timeAgo(data.generatedAt);
    var html = "";
    COLS.forEach(function (col) {
      var list = (data.columns && data.columns[col.key]) || [];
      // First two columns support client-side sort toggling (new→old / old→new); others stay new→old
      var sortable = col.key === "waiting_me" || col.key === "waiting_author";
      var dir = (cfg.sort && cfg.sort[col.key]) || "new";
      if (sortable) {
        list = list.slice().sort(function (a, b) {
          return dir === "old" ? a.whenTs - b.whenTs : b.whenTs - a.whenTs;
        });
      }
      var sortBtn = sortable
        ? '<button class="pbo-sort" data-sort="' + col.key + '" title="Toggle sort order">' + (dir === "old" ? "↑ old→new" : "↓ new→old") + "</button>"
        : "";
      html += '<div class="pbo-col"><div class="pbo-col-head"><i style="background:' + col.color + '"></i>' +
        col.name + ' <span class="pbo-count">' + list.length + "</span>" + sortBtn + "</div>";
      if (!list.length) html += '<div class="pbo-empty">empty</div>';
      else html += list.map(function (c) { return cardHtml(c, col.key); }).join("");
      html += "</div>";
    });
    body.innerHTML = html;
  }

  // Settings dialog: repo required (owner/name); blank username = host uses the gh login account
  function openSettings() {
    var repo = prompt("Repository (owner/name, e.g. octocat/hello-world)", cfg.repo || "");
    if (repo === null) return;
    repo = repo.trim();
    if (!/^[^/\\s]+\\/[^/\\s]+$/.test(repo)) { toast("Repo must be owner/name; not saved"); return; }
    var user = prompt("GitHub username (blank = use the gh login account)", cfg.user || "");
    if (user === null) return;
    cfg.repo = repo;
    cfg.user = user.trim();
    saveCfg();
    restartPolling();
    refresh(true, true);
  }

  function openBoard() {
    var ov = ensureBoard();
    ov.classList.add("pb-show");
    if (!cfg.repo) { openSettings(); return; } // first run: guide straight into setup
    refresh(false, true);
  }

  function ensureBoard() {
    var ov = document.getElementById("pr-board-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "pr-board-overlay";
    ov.innerHTML =
      '<div class="pbo-head"><span class="pbo-title">PR Board</span>' +
      '<span class="pbo-sub" id="pbo-sub"></span><span class="pbo-spacer"></span>' +
      '<select id="pbo-interval">' +
      [1, 2, 5, 10, 30].map(function (m) {
        return '<option value="' + m + '"' + (m === cfg.interval ? " selected" : "") + ">" + m + " min poll</option>";
      }).join("") + "</select>" +
      '<button class="pbo-btn" id="pbo-cfg">Settings</button>' +
      '<button class="pbo-btn" id="pbo-refresh">Refresh</button>' +
      '<button class="pbo-btn" id="pbo-close">Close</button></div>' +
      '<div class="pbo-body" id="pbo-body"><div class="pbo-loading">Loading…</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) {
      if (e.target === ov) ov.classList.remove("pb-show");
      var sortEl = e.target.closest && e.target.closest("[data-sort]");
      if (sortEl) {
        var sortKey = sortEl.getAttribute("data-sort");
        cfg.sort = cfg.sort || {};
        cfg.sort[sortKey] = cfg.sort[sortKey] === "old" ? "new" : "old";
        saveCfg();
        renderBoard();
        return;
      }
      var cardEl = e.target.closest && e.target.closest(".pbo-card");
      var claimEl = e.target.closest && e.target.closest("[data-claim]");
      if (claimEl) {
        e.stopPropagation();
        var num = parseInt(claimEl.getAttribute("data-claim"), 10);
        claimEl.disabled = true;
        claimEl.textContent = "Requesting…";
        api("/api/pr-board/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: cfg.repo, user: cfg.user, number: num })
        }).then(function (v) {
          if (v.ok) { toast("PR #" + num + " added to your review queue"); refresh(true, true); }
          else { toast("Claim failed: " + (v.error || "unknown error")); claimEl.disabled = false; claimEl.textContent = "I'll review"; }
        }).catch(function () { claimEl.disabled = false; claimEl.textContent = "I'll review"; });
        return;
      }
      if (cardEl && cardEl.dataset && cardEl.dataset.url) window.open(cardEl.dataset.url, "_blank");
    });
    document.getElementById("pbo-close").onclick = function () { ov.classList.remove("pb-show"); };
    document.getElementById("pbo-refresh").onclick = function () { refresh(true, true); };
    document.getElementById("pbo-cfg").onclick = openSettings;
    document.getElementById("pbo-interval").onchange = function () {
      cfg.interval = parseInt(this.value, 10) || 5;
      saveCfg();
      restartPolling();
    };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") ov.classList.remove("pb-show");
    });
    return ov;
  }

  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () { refresh(false, false); }, (cfg.interval || 5) * 60000);
  }

  function floatPill() {
    if (document.getElementById("pr-board-widget")) return;
    var w = document.createElement("div");
    w.id = "pr-board-widget";
    w.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147482000;padding:7px 12px;border-radius:10px;background:#1f6feb;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.35)";
    w.innerHTML = widgetHtml();
    w.onclick = openBoard;
    document.body.appendChild(w);
  }

  // Pill mode: keep probing for the sidebar and embed once it appears (SPA late render)
  var embedTimer = null;
  function watchForSidebar() {
    if (embedTimer) return;
    var tries = 0;
    embedTimer = setInterval(function () {
      if (++tries > 80) { clearInterval(embedTimer); embedTimer = null; return; }
      var sidebar = findSidebar();
      if (sidebar) {
        clearInterval(embedTimer);
        embedTimer = null;
        mountInSidebar(sidebar);
      }
    }, 3000);
  }

  var sidebarTries = 0;
  function init() {
    if (document.getElementById("pr-board-widget")) return;
    var sidebar = findSidebar();
    if (!sidebar) {
      // Sidebar not rendered yet: retry ~12s, then fall back to a corner pill and keep watching
      if (++sidebarTries > 15) {
        floatPill();
        watchForSidebar();
        restartPolling();
        refresh(false, true);
        return;
      }
      setTimeout(init, 800);
      return;
    }
    mountInSidebar(sidebar);
    restartPolling();
    refresh(false, true);
  }

  // Alt+P always opens the board, even if the widget failed to render
  document.addEventListener("keydown", function (e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); openBoard(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();`;
