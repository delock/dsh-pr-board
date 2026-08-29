// dsh-pr-board client plugin — the browser half of the PR board.
// --------------------------------------------------------------
// Registered through window.__ModuleLoader__ (same contract as every client
// plugin): the factory returns module.exports carrying { name, inject, apply }.
// inject lists SERVICE names ("sessions", "workspaces"), resolved once the
// providing packages materialize. apply(ctx) receives the client root context.
//
// What changed vs the old index-inject script: this bundle is a first-class
// GUI module. ctx.sessions / ctx.workspaces give it the ability to find, open
// and create review conversations, so clicking a PR card jumps into the
// matching session (matched by the "review owner/repo#N" title convention,
// remembered via rename on creation) instead of opening GitHub. GitHub stays
// available through the per-card ↗ button. Visuals are unchanged on purpose.
(function () {
  var CSS_TEXT = `
#pr-board-widget{flex:none;margin-top:8px;padding:8px 2px 2px;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent);font-size:12px;color:inherit;min-width:0;cursor:pointer}
#pr-board-widget .pbw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-weight:600;gap:6px}
#pr-board-widget .pbw-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:8px;font-size:11px;font-weight:600;background:color-mix(in srgb,currentColor 10%,transparent)}
#pr-board-widget .pbw-chip b{font-weight:700}
#pr-board-widget .pbw-chip.me b{color:#60a5fa}
#pr-board-widget .pbw-chip.author b{color:#fbbf24}
#pr-board-widget .pbw-chip.ready b{color:#34d399}
#pr-board-widget .pbw-add{flex:none;width:18px;height:18px;line-height:16px;text-align:center;padding:0;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;font-size:13px;font-weight:700;cursor:pointer}
#pr-board-widget .pbw-add:hover{background:color-mix(in srgb,currentColor 15%,transparent)}
#pr-board-widget .pbw-list{display:flex;flex-direction:column;gap:3px}
#pr-board-widget .pbw-repo{display:flex;align-items:center;gap:4px;min-width:0;padding:1px 0;border-radius:6px}
#pr-board-widget .pbw-repo:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
#pr-board-widget .pbw-repo .pbw-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#pr-board-widget .pbw-repo .pbw-chip{flex:none;min-width:16px;justify-content:center;padding:1px 4px;font-weight:700}
#pr-board-widget .pbw-repo .pbw-chip.me{color:#60a5fa}
#pr-board-widget .pbw-repo .pbw-chip.author{color:#fbbf24}
#pr-board-widget .pbw-repo .pbw-chip.ready{color:#34d399}
#pr-board-widget .pbw-repo .pbw-chip.inbox{color:#c4b5fd}
/* Two-row repo block: name column | kind-label column (right-aligned, hugs
   the numbers) | four number columns. The issue row's numbers land in the
   same columns as the PR row's, so me/reporter sit directly under their PR
   counterparts, and both kind labels share one right edge. */
#pr-board-widget .pbw-rblock{display:grid;grid-template-columns:minmax(0,1fr) auto repeat(4,minmax(17px,auto));gap:2px 4px;padding:1px 0;border-radius:6px;align-items:center}
#pr-board-widget .pbw-rblock:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
#pr-board-widget .pbw-rblock .pbw-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#pr-board-widget .pbw-rblock .pbw-kind{grid-column:2;justify-self:end;font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.55;white-space:nowrap}
#pr-board-widget .pbw-rblock .pbw-kind.pbw-kind-iss{grid-row:2}
/* Issue numbers are EXPLICITLY placed: sparse auto-flow keeps its cursor at
   the end of row 1, so after the explicitly placed label the two auto cells
   would land in row 2 columns 1-2 (left of / under the label) — the exact
   misplacement this fixes. */
#pr-board-widget .pbw-rblock .pbw-ic1{grid-row:2;grid-column:3}
#pr-board-widget .pbw-rblock .pbw-ic2{grid-row:2;grid-column:4}
#pr-board-widget .pbw-rblock .pbw-cell{display:inline-flex;justify-content:center;min-width:17px;padding:1px 4px;border-radius:8px;font-size:11px;font-weight:700;background:color-mix(in srgb,currentColor 10%,transparent)}
#pr-board-widget .pbw-rblock .pbw-cell.me{color:#60a5fa}
#pr-board-widget .pbw-rblock .pbw-cell.author{color:#fbbf24}
#pr-board-widget .pbw-rblock .pbw-cell.ready{color:#34d399}
#pr-board-widget .pbw-rblock .pbw-cell.inbox{color:#c4b5fd}
#pr-board-widget.pbw-pulse{animation:pbw-flash 1.2s 3}
@keyframes pbw-flash{50%{background:color-mix(in srgb,#60a5fa 25%,transparent)}}
#pr-board-overlay{position:fixed;inset:0;z-index:2147483000;display:none;background:color-mix(in srgb,#000000 62%,transparent);backdrop-filter:blur(3px)}
#pr-board-overlay.pb-show{display:flex;flex-direction:column}
#pr-board-overlay .pbo-head{display:flex;align-items:center;gap:10px;padding:12px 18px;color:#fff;background:#161b22;flex:none}
#pr-board-overlay .pbo-title{font-size:15px;font-weight:700}
#pr-board-overlay .pbo-sub{font-size:12px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pr-board-overlay .pbo-spacer{flex:1}
#pr-board-overlay .pbo-tabs{display:flex;gap:6px;align-items:center;padding:8px 14px 0;flex-wrap:wrap;flex:none}
#pr-board-overlay .pbo-tab{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);font-size:12px;font-weight:600;cursor:pointer;max-width:220px}
#pr-board-overlay .pbo-tab:hover{background:rgba(255,255,255,.12);color:#fff}
#pr-board-overlay .pbo-tab.pb-active{background:rgba(31,111,235,.35);border-color:rgba(96,165,250,.5);color:#fff}
#pr-board-overlay .pbo-tab .pbo-tab-x{display:none;font-style:normal;font-size:13px;line-height:1;opacity:.7;padding:0 1px}
#pr-board-overlay .pbo-tab:hover .pbo-tab-x{display:inline-block}
#pr-board-overlay .pbo-tab .pbo-tab-x:hover{opacity:1;color:#fca5a5}
#pr-board-overlay .pbo-tab-add{border-style:dashed;padding:3px 12px;font-weight:700}
#pr-board-overlay select,#pr-board-overlay .pbo-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:12px;cursor:pointer}
#pr-board-overlay .pbo-dwrap{display:inline-flex;align-items:center;gap:3px;font-size:12px;color:rgba(255,255,255,.75)}
#pr-board-overlay .pbo-dwrap input{width:48px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:12px}
#pr-board-overlay .pbo-btn:hover{background:rgba(255,255,255,.18)}
#pr-board-overlay .pbo-body{flex:1;overflow:auto;display:grid;gap:10px;padding:12px 14px;grid-template-columns:repeat(5,minmax(230px,1fr));align-content:start;align-items:start}
/* Narrow widths: keep the five columns on ONE row at fixed width and pan
   horizontally — one-finger swipe on touch, drag-to-pan (grab cursor) or
   shift+wheel with a mouse. Columns never wrap below their usable width. */
@media (max-width:1270px){
  #pr-board-overlay .pbo-body{grid-template-columns:repeat(5,minmax(250px,320px));overflow-x:auto;cursor:grab}
  #pr-board-overlay .pbo-body.pbw-panning{cursor:grabbing;user-select:none;-webkit-user-select:none}
}
#pr-board-overlay .pbo-col{display:flex;flex-direction:column;gap:8px;min-width:0}
#pr-board-overlay .pbo-col-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#fff;padding:2px 4px;flex:none}
#pr-board-overlay .pbo-col-head .pbo-count{font-size:11px;opacity:.7;font-weight:600}
#pr-board-overlay .pbo-sort{margin-left:auto;padding:1px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:11px;cursor:pointer;flex:none}
#pr-board-overlay .pbo-sort:hover{background:rgba(255,255,255,.18)}
#pr-board-overlay .pbo-col-head i{width:8px;height:8px;border-radius:50%;flex:none}
#pr-board-overlay .pbo-card{position:relative;padding:8px 10px;border-radius:8px;background:#1c2129;color:#d7dde5;font-size:12px;line-height:1.45;cursor:pointer;border:1px solid transparent;min-width:0}
#pr-board-overlay .pbo-card:hover{border-color:rgba(255,255,255,.25);background:#232935}
#pr-board-overlay .pbo-num{font-weight:700;color:#7aa7ff;margin-right:4px;text-decoration:none;cursor:pointer}
#pr-board-overlay .pbo-card:hover .pbo-num{text-decoration:underline}
#pr-board-overlay .pbo-title-line{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;padding-right:16px}
#pr-board-overlay .pbo-meta{display:flex;gap:6px;align-items:center;margin-top:5px;opacity:.65;font-size:11px;flex-wrap:wrap}
#pr-board-overlay .pbo-reason{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(255,255,255,.1);color:#fff}
#pr-board-overlay .pbo-badge-conflict{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(239,68,68,.25);color:#fca5a5}
#pr-board-overlay .pbo-badge-cifail{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(239,68,68,.3);color:#f87171}
#pr-board-overlay .pbo-badge-cirun{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(251,191,36,.22);color:#fcd34d}
#pr-board-overlay .pbo-badge-ciqueue{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(148,163,184,.25);color:#cbd5e1}
#pr-board-overlay .pbo-badge-cipass{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(52,211,153,.2);color:#6ee7b7}
#pr-board-overlay .pbo-badge-draft{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(148,163,184,.25);color:#cbd5e1}
#pr-board-overlay .pbo-claim{margin-top:6px;width:100%;padding:3px 0;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(125,211,252,.15);color:#bae6fd;font-size:11px;font-weight:600;cursor:pointer}
#pr-board-overlay .pbo-claim:hover{background:rgba(125,211,252,.3)}
/* pointer-events:none until hover: on touch there is no hover, and an
   invisible-but-tappable corner button hijacked card taps (tap → GitHub
   instead of the review session). */
#pr-board-overlay .pbo-gh{position:absolute;top:4px;right:4px;width:18px;height:18px;line-height:16px;text-align:center;padding:0;border:none;border-radius:5px;background:transparent;color:rgba(255,255,255,.4);font-size:12px;cursor:pointer;opacity:0;pointer-events:none}
#pr-board-overlay .pbo-card:hover .pbo-gh{opacity:1;pointer-events:auto}
@media (hover:none){#pr-board-overlay .pbo-gh{opacity:.45;pointer-events:auto}}
#pr-board-overlay .pbo-gh:hover{background:rgba(255,255,255,.15);color:#fff}
#pr-board-overlay .pbo-empty{padding:10px;border-radius:8px;border:1px dashed rgba(255,255,255,.15);color:rgba(255,255,255,.4);font-size:11px;text-align:center}
#pr-board-overlay .pbo-error{margin:20px auto;padding:10px 16px;border-radius:8px;background:rgba(239,68,68,.15);color:#fca5a5;font-size:13px;max-width:520px}
#pr-board-overlay .pbo-loading{color:rgba(255,255,255,.5);font-size:12px;padding:6px 4px}
#pr-board-toast{position:fixed;right:16px;bottom:16px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;max-width:340px}
#pr-board-toast .pbt{padding:9px 13px;border-radius:8px;background:#1f6feb;color:#fff;font-size:12.5px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;opacity:.97}
#pr-board-toast .pbt b{font-weight:700}
#pr-board-wspick{position:fixed;inset:0;z-index:2147483500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
#pr-board-wspick .pbw-wsbox{min-width:300px;max-width:440px;max-height:70vh;overflow:auto;padding:14px;border-radius:10px;background:#1c2129;color:#d7dde5;box-shadow:0 8px 30px rgba(0,0,0,.5)}
#pr-board-wspick .pbw-wstitle{font-size:13px;font-weight:700;margin-bottom:10px;color:#fff;word-break:break-all}
#pr-board-wspick .pbw-wsopt{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);margin-bottom:6px;cursor:pointer;font-size:12.5px}
#pr-board-wspick .pbw-wsopt:hover{background:rgba(96,165,250,.18);border-color:rgba(96,165,250,.4)}
#pr-board-wspick .pbw-wsnew{border-style:dashed;color:#bae6fd}
#pr-board-wspick .pbw-wsnote{font-size:11.5px;opacity:.6;padding:4px 2px}
#pr-board-wspick .pbw-wscancel{cursor:pointer;margin-top:6px}
#pr-board-wspick .pbw-wscancel:hover{opacity:1;text-decoration:underline}
`;

  var name = "pr-board";
  var inject = ["sessions", "workspaces"];

  // ---------------------------------------------------------------- frontend

  var CTX = null;

  var CFG_KEY = "prboard.cfg", LAST_KEY = "prboard.last", BIND_KEY = "prboard.sessions";
  var DEFAULTS = { repos: [], user: "", workspaces: {}, autoprompt: true, inactiveDays: 30, interval: 5, sort: { waiting_me: "new", waiting_author: "new" } };
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
    "draft": "Approved but draft",
    "merge-queue": "In merge queue",
    "queue-checks-awaiting": "Merge queue: checks not started (approve the run?)",
    "queue-checks-failed": "Merge queue: checks failed",
    "auto-merge": "Auto-merge armed",
    "auto-merge-blocked": "Auto-merge blocked (failing checks / branch)"
  };
  // Issue board: support-queue vocabulary (three columns, no merge machinery).
  var ISS_COLS = [
    { key: "waiting_me", name: "Waiting on me", color: "#60a5fa" },
    { key: "waiting_reporter", name: "Waiting on reporter", color: "#fbbf24" },
    { key: "closed_recent", name: "Recently closed", color: "#94a3b8" }
  ];
  var ISS_REASONS = {
    "assigned": "Assigned to me",
    "mentioned": "Mentioned me",
    "replied": "Reporter replied",
    "awaiting-reporter": "Awaiting reporter"
  };
  // "Mine" board: PRs I authored across every repo — the developer half.
  var MINE_COLS = [
    { key: "waiting_me", name: "My move", color: "#60a5fa" },
    { key: "waiting_others", name: "Waiting on others", color: "#fbbf24" },
    { key: "merged", name: "Merged", color: "#94a3b8" }
  ];
  var MINE_REASONS = {
    "changes-requested": "Changes requested",
    "ci-failing": "CI failing",
    "conflict": "Conflicts",
    "respond": "Reviewer commented — awaiting your reply",
    "auto-merge-blocked": "Auto-merge blocked (fix checks/branch)",
    "awaiting-first-review": "Awaiting first review",
    "re-review": "Awaiting re-review",
    "approved": "Approved — awaiting merge",
    "merge-queue": "In merge queue",
    "auto-merge": "Auto-merge armed",
    "in-review": "In review"
  };
  var cfg = loadCfg(), pollTimer = null, data = null, busy = false, activeRepo = "";
  var boardMode = "pr"; // "pr" | "issue" | "mine" — which panel the board shows
  var currentCards = {}; // number -> card object (for the click-to-session flow)
  var jumpBusy = false;

  function loadCfg() {
    var c;
    try { c = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); }
    catch (e) { c = Object.assign({}, DEFAULTS); }
    // migrate the old single-repo config to the repos array
    if (!Array.isArray(c.repos)) c.repos = [];
    if (c.repo && /^[^/\s]+\/[^/\s]+$/.test(c.repo) && c.repos.indexOf(c.repo) < 0) c.repos.push(c.repo);
    delete c.repo;
    if (!c.sort) c.sort = { waiting_me: "new", waiting_author: "new" };
    if (!c.workspaces || typeof c.workspaces !== "object" || Array.isArray(c.workspaces)) c.workspaces = {};
    // One-time migration from the old global default: seed every configured
    // repo without its own entry, then the default ceases to exist. Repos are
    // meant to each carry an explicit workspace; unset ones open GitHub.
    if (typeof c.workspace === "string" && c.workspace) {
      c.repos.forEach(function (r) { if (!c.workspaces[r]) c.workspaces[r] = c.workspace; });
      wsMigrated = true; // pullCfg must PUSH this, not adopt a stale empty host map over it
    }
    delete c.workspace;
    if (typeof c.autoprompt !== "boolean") c.autoprompt = true;
    if (typeof c.inactiveDays !== "number" || !isFinite(c.inactiveDays) || c.inactiveDays < 0 || c.inactiveDays > 365) c.inactiveDays = 30;
    return c;
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
    cfgDirtyAt = Date.now();
    if (!adopting) pushCfg();
  }

  // ---------- host-synced config ----------
  // Account-wide fields live on the host (~/.dsh/pr-board.config.json) so
  // every device hitting this web UI shares them. The poll interval stays
  // per-browser. saveCfg pushes; pullCfg adopts host changes unless this
  // browser edited something in the last two minutes (anti ping-pong).
  var SYNC_KEYS = ["repos", "user", "workspaces", "autoprompt", "inactiveDays"];
  var cfgDirtyAt = 0;
  var adopting = false;
  var wsMigrated = false; // set by loadCfg when the scalar default was just seeded into the map

  function syncedCfg() {
    var out = {};
    SYNC_KEYS.forEach(function (k) { out[k] = cfg[k]; });
    return out;
  }

  function pushCfg() {
    api("/api/pr-board/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(syncedCfg())
    }).catch(function () {});
  }

  function pullCfg(cb) {
    api("/api/pr-board/config").then(function (v) {
      if (!v || !v.ok) return cb && cb();
      // Migration: a device that configured the board before host-sync existed
      // seeds the host file on first contact.
      if (!v.config) {
        if (cfg.repos.length) pushCfg();
        return cb && cb();
      }
      var remote = v.config;
      var same = SYNC_KEYS.every(function (k) { return JSON.stringify(cfg[k]) === JSON.stringify(remote[k]); });
      if (same) return cb && cb();
      // A just-migrated local map outranks a host that never received it:
      // PUSH the seed instead of adopting an empty/stale map over it.
      if (wsMigrated) {
        wsMigrated = false;
        pushCfg();
        return cb && cb();
      }
      if (Date.now() - cfgDirtyAt < 120000) return cb && cb(); // local edit wins, for now
      adopting = true;
      SYNC_KEYS.forEach(function (k) { cfg[k] = remote[k]; });
      if (activeRepo && cfg.repos.indexOf(activeRepo) < 0) activeRepo = cfg.repos[0] || "";
      saveCfg(); // persists locally; adoption must not echo back to the host
      adopting = false;
      restartPolling();
      renderWidget();
      renderBoard();
      refresh(false, true);
      cb && cb();
    }).catch(function () { cb && cb(); });
  }

  // ---------- PR ↔ session bindings ----------
  // Exact, immediate association ("owner/repo#N" -> sessionId). Two layers:
  // localStorage (instant, per-browser) and a HOST-SHARED map (merge-style,
  // read at init/poll, written on every bind) — LLM titles are semantic and
  // cannot be trusted to contain "#N", so the shared map is what makes the
  // first click on a new device resolve exactly.
  var hostBindings = {}; // repo#N -> {sid, t}, refreshed from the host

  function loadBindings() {
    try { var b = JSON.parse(localStorage.getItem(BIND_KEY) || "{}"); return b && typeof b === "object" ? b : {}; }
    catch (e) { return {}; }
  }
  function saveBindings(b) { try { localStorage.setItem(BIND_KEY, JSON.stringify(b)); } catch (e) {} }
  function bindSession(key, sid) {
    var b = loadBindings();
    // One session belongs to at most one PR: if this session was previously
    // bound to another PR (blank-session reuse), release the old claim.
    var released = false;
    for (var k in b) if (b[k] && b[k].sid === sid && k !== key) { delete b[k]; released = true; }
    b[key] = { sid: sid, t: Date.now() };
    saveBindings(b);
    hostBindings[key] = { sid: sid, t: Date.now() };
    api("/api/pr-board/bindings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: key, sid: sid, release: true })
    }).catch(function () {});
    return released;
  }
  function boundSession(key) {
    var b = loadBindings();
    var e = b[key];
    if (!e || !e.sid) {
      // Fall through to the host-shared map (another device's click), and
      // write a hit through to localStorage so this lookup stays instant.
      var h = hostBindings[key];
      if (h && h.sid) {
        b[key] = { sid: h.sid, t: h.t || Date.now() };
        saveBindings(b);
        e = b[key];
      }
    }
    if (!e || !e.sid) return null;
    // Validate against the live list; a deleted/archived session re-binds.
    var snap = null;
    try { snap = CTX && CTX.sessions && CTX.sessions.list.getSnapshot(); } catch (x) {}
    // Archived counts as gone: archived sessions stay in the list snapshot
    // (flagged via the workspaces snapshot), and without this check a click
    // would drop you into the archived conversation instead of re-binding.
    var archived = [];
    try {
      var wsSnap = CTX.workspaces && CTX.workspaces.list && CTX.workspaces.list.getSnapshot();
      archived = (wsSnap && wsSnap.archivedSessionIds) || [];
    } catch (x) {}
    if ((snap && snap.byId && !(e.sid in snap.byId)) || archived.indexOf(e.sid) >= 0) {
      delete b[key];
      saveBindings(b);
      delete hostBindings[key];
      // Clear the shared map too, or every browser re-hits the stale entry.
      api("/api/pr-board/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key, sid: "" })
      }).catch(function () {});
      return null;
    }
    return e.sid;
  }

  // Pull the shared map; also uploads any local-only binding exactly once
  // (migrating browsers that clicked before the map was host-shared).
  function pullBindings() {
    api("/api/pr-board/bindings").then(function (v) {
      if (!v || !v.ok || !v.bindings) return;
      hostBindings = v.bindings;
      var b = loadBindings();
      var dirty = false;
      for (var k in b) {
        if (!hostBindings[k] && b[k] && b[k].sid) {
          api("/api/pr-board/bindings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: k, sid: b[k].sid })
          }).catch(function () {});
          hostBindings[k] = b[k];
          dirty = true;
        }
      }
      if (dirty) saveBindings(b); // no-op write; keeps shape stable
    }).catch(function () {});
  }

  // Developer-side transitions on MY PRs: approved, changes requested, queued
  // or merged. Baseline lives apart from the maintainer one; first load just
  // records the current state (no toast storm).
  var MINE_LAST_KEY = "prboard.minelast";
  function detectMineTransitions(v) {
    var mine = v && v.mine;
    if (!mine || !mine.ok) return;
    var prev = null;
    try { prev = JSON.parse(localStorage.getItem(MINE_LAST_KEY) || "null"); } catch (e) {}
    var prevMap = prev && typeof prev === "object" ? prev : {};
    var next = {};
    var cols = mine.columns || {};
    (cols.waiting_me || []).concat(cols.waiting_others || []).forEach(function (c) {
      next[(c.repo || "") + "#" + c.number] = c.reason || "";
    });
    var mergedNow = {};
    (cols.merged || []).forEach(function (c) { mergedNow[(c.repo || "") + "#" + c.number] = 1; });

    for (var k in next) {
      var was = prevMap[k];
      if (was === undefined) continue; // first baseline
      var now = next[k];
      var m = /^([^#]+)#(\d+)$/.exec(k);
      var where = m ? shortName(m[1]) + " #" + m[2] : k;
      if (now === "changes-requested" && was !== "changes-requested") toast("Your PR " + where + ": changes requested");
      else if (now === "approved" && was !== "approved") toast("Your PR " + where + " got approved 🎉");
      else if (now === "merge-queue" && was !== "merge-queue") toast("Your PR " + where + " entered the merge queue");
    }
    for (var mk in mergedNow) {
      if (prevMap[mk] !== undefined && prevMap[mk] !== "merged") {
        var mm = /^([^#]+)#(\d+)$/.exec(mk);
        toast("Your PR " + (mm ? shortName(mm[1]) + " #" + mm[2] : mk) + " was merged 🎉");
      }
    }
    // merged entries leave the open map; record them so re-merges don't re-toast
    var store = Object.assign({}, next);
    for (var mk2 in mergedNow) store[mk2] = "merged";
    try { localStorage.setItem(MINE_LAST_KEY, JSON.stringify(store)); } catch (e) {}
  }


  function shortName(repo) { return repo.slice(repo.indexOf("/") + 1); }
  function displayName(repo) {
    var n = shortName(repo);
    var clash = cfg.repos.some(function (r) { return r !== repo && shortName(r) === n; });
    return clash ? repo : n;
  }
  function repoData(repo) {
    if (!data || !data.repos) return null;
    for (var i = 0; i < data.repos.length; i++) if (data.repos[i].repo === repo) return data.repos[i];
    return null;
  }
  function currentRepo() { return activeRepo && cfg.repos.indexOf(activeRepo) >= 0 ? activeRepo : (cfg.repos[0] || ""); }

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
    if (!cfg.repos.length) {
      data = { ok: false, error: "No repositories added yet" };
      renderWidget();
      renderBoard();
      return Promise.resolve();
    }
    if (busy) return Promise.resolve();
    busy = true;
    var q = "?repos=" + encodeURIComponent(cfg.repos.join(",")) + "&user=" + encodeURIComponent(cfg.user) +
      "&days=" + (isFinite(cfg.inactiveDays) ? cfg.inactiveDays : 30) + (fresh ? "&fresh=1" : "");
    return api("/api/pr-board/data" + q).then(function (v) {
      busy = false;
      // Transient failures (e.g. a search secondary rate-limit blip) must not
      // wipe the board to "error": keep the last good snapshot — whole-response
      // level and per-repo level. The error state then only appears when there
      // has never been a good load for that repo.
      if (!v.ok && data && data.ok) return;
      if (v.ok && data && data.ok && v.repos && data.repos) {
        var prevByRepo = {};
        data.repos.forEach(function (r) { if (r.ok) prevByRepo[r.repo] = r; });
        v.repos.forEach(function (r) { if (!r.ok && prevByRepo[r.repo]) Object.assign(r, prevByRepo[r.repo]); });
      }
      data = v;
      renderWidget();
      renderBoard();
      if (v.ok && !quiet) { detectTransitions(v); detectMineTransitions(v); }
    }).catch(function () { busy = false; });
  }

  function detectTransitions(v) {
    var prev = null;
    try { prev = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (e) {}
    var prevMap = prev && typeof prev === "object" && prev.repos ? prev.repos : {};
    var nextMap = {};
    var anyArrived = false;
    (v.repos || []).forEach(function (rd) {
      if (!rd.ok) return;
      var nowMe = (rd.columns.waiting_me || []).map(function (c) { return c.number; });
      nextMap[rd.repo] = nowMe;
      var old = prevMap[rd.repo];
      if (!old) return;
      var prevSet = {};
      (old || []).forEach(function (n) { prevSet[n] = 1; });
      var arrived = nowMe.filter(function (n) { return !prevSet[n]; });
      arrived.forEach(function (n) {
        var c = rd.columns.waiting_me.filter(function (x) { return x.number === n; })[0];
        anyArrived = true;
        toast("[" + displayName(rd.repo) + "] PR #" + n + (c ? " " + c.title.slice(0, 40) : "") + " is back to you" +
          (c && REASONS[c.reason] ? " (" + REASONS[c.reason] + ")" : ""), c && c.url);
      });
    });
    if (anyArrived) {
      var w = document.getElementById("pr-board-widget");
      if (w) { w.classList.remove("pbw-pulse"); void w.offsetWidth; w.classList.add("pbw-pulse"); }
    }
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ t: Date.now(), repos: nextMap })); } catch (e) {}
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

  // ---------- click-to-session: find / open / create the review conversation ----------
  // Full key for the binding table; short tag ("repo#N") doubles as the title
  // search needle — after the first message the LLM-generated title contains it.
  function sessionKey(card) { return (card.repo || currentRepo()) + "#" + card.number; }
  function sessionTag(card) { return shortName(card.repo || currentRepo()) + "#" + card.number; }

  // Wire errors carry {code, message?, details?} — message is often absent,
  // so fall through code/details before giving up with a generic string.
  function errText(e) {
    if (e && e.message) return String(e.message);
    if (e && e.code) return e.code + (e.details ? " " + JSON.stringify(e.details).slice(0, 100) : "");
    try { return JSON.stringify(e).slice(0, 140); } catch (x) { return "unknown error"; }
  }

  // Lookup order: binding table (exact, instant) → title search (works once
  // the first message has generated a title, also across browsers) → create.
  // The whole flow is guarded: a synchronous throw anywhere used to kill the
  // click listener and strand jumpBusy=true, which made every later card
  // click a silent no-op — so failures now surface as toasts and the busy
  // flag always clears (watchdog below).
  // Async GitHub fallback: window.open after an await is outside the user
  // gesture chain, so mobile Safari's popup blocker silently eats it. Toast
  // the guidance instead; the visible ↗ button remains the explicit path.
  function ghFallback(reason) {
    toast(reason + " — open GitHub with the ↗ button on the card.");
  }

  // Filesystem path of a workspace id (search-result sessions carry cwd, and
  // workspaces are identified by path there), or null when unknown.
  function workspacePathOf(id) {
    try {
      var snap = CTX.workspaces && CTX.workspaces.list && CTX.workspaces.list.getSnapshot();
      var items = (snap && snap.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].workspaceId === id) return items[i].path || items[i].cwd || null;
      }
    } catch (e) {}
    return null;
  }

  // ---------- workspace picker (click-to-choose, with create) ----------
  // Shown when a card is clicked for a repo with no configured workspace —
  // typical for "mine" PRs in repos outside the monitored list. Picking (or
  // creating) one assigns it, syncs it, and immediately retries the jump.
  function pickWorkspaceFor(card, repo) {
    var opts = workspaceOptions();
    var backdrop = document.createElement("div");
    backdrop.id = "pr-board-wspick";
    var rows = opts
      .map(function (o) { return '<div class="pbw-wsopt" data-wsid="' + esc(o.id) + '">' + esc(o.label) + "</div>"; })
      .join("");
    backdrop.innerHTML =
      '<div class="pbw-wsbox"><div class="pbw-wstitle">Review workspace for ' + esc(repo) + "</div>" +
      (rows || '<div class="pbw-wsnote">No workspaces yet — create one below.</div>') +
      (typeof CTX.workspaces.pickDirectory === "function" && typeof CTX.workspaces.create === "function"
        ? '<div class="pbw-wsopt pbw-wsnew" data-newws="1">＋ New workspace — choose a directory…</div>'
        : "") +
      '<div class="pbw-wsnote pbw-wscancel" data-wscancel="1">Cancel — open on GitHub instead</div></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", function (e) {
      var cancelEl = e.target.closest && e.target.closest("[data-wscancel]");
      if (cancelEl || e.target === backdrop) {
        backdrop.remove();
        if (cancelEl) window.open(card.url, "_blank");
        return;
      }
      var optEl = e.target.closest && e.target.closest("[data-wsid]");
      if (optEl) {
        backdrop.remove();
        assignWorkspace(repo, optEl.getAttribute("data-wsid"), card);
        return;
      }
      var newEl = e.target.closest && e.target.closest("[data-newws]");
      if (newEl) {
        newEl.textContent = "Opening directory picker…";
        CTX.workspaces.pickDirectory().then(function (path) {
          if (!path) return;
          return CTX.workspaces.create({ path: path }).then(function (ws) {
            var id = ws && (ws.workspaceId || ws.id);
            if (!id) throw new Error("create returned no workspace id");
            backdrop.remove();
            assignWorkspace(repo, id, card);
          });
        }).catch(function (err) {
          // pickDirectory throws on cancel too; only surface real failures
          var msg = errText(err);
          if (!/cancel|picker/i.test(msg)) toast("New workspace failed: " + msg);
          newEl.textContent = "＋ New workspace — choose a directory…";
        });
      }
    });
  }

  function assignWorkspace(repo, id, card) {
    cfg.workspaces[repo] = id;
    saveCfg(); // pushes to the host — every device gets it
    openReviewSession(card); // retry the jump with the workspace in place
  }


  function openReviewSession(card) {
    if (jumpBusy) return;
    if (!CTX || !CTX.sessions) { window.open(card.url, "_blank"); return; }
    jumpBusy = true;
    setTimeout(function () { if (jumpBusy) { jumpBusy = false; toast("PR board: jump timed out — click again"); } }, 15000);
    try {
      var key = sessionKey(card), tag = sessionTag(card);
      var bound = boundSession(key);
      if (bound) return finishJump(bound, card, false, tag);
      // No workspace for this repo → no session integration at all: an
      // unscoped global search would contradict the per-repo workspace model.
      var repo = card.repo || currentRepo();
      var wsId = workspaceFor(repo);
      if (!wsId) {
        jumpBusy = false;
        pickWorkspaceFor(card, repo);
        return;
      }
      if (typeof CTX.sessions.search !== "function") {
        jumpBusy = false;
        toast("PR board: ctx.sessions.search is unavailable on this host. Details in the browser console.");
        console.error("[pr-board] ctx.sessions keys:", CTX.sessions && Object.keys(CTX.sessions));
        return;
      }
      var wsPath = workspacePathOf(wsId);
      // Search by the bare number — FTS over "repo#N" needs every term in the
      // title, and manually-created conversations ("Review PR #8265 …") often
      // don't name the repo at all. Results are then scoped to this repo's
      // workspace (sessions carry cwd; items without cwd pass defensively),
      // and scored: "repo#N" (our convention) beats "#N" (human convention);
      // ties go to the most recently updated. Bare numbers without "#" never
      // match — too false-positive-prone.
      CTX.sessions.search(String(card.number)).then(function (res) {
        var items = (res && res.ok && res.value && res.value.items) || [];
        if (wsPath) {
          items = items.filter(function (it) { return typeof it.cwd !== "string" || it.cwd === wsPath; });
        }
        var best = null;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var title = it.title || "";
          var score = title.indexOf(tag) >= 0 ? 3 : (title.indexOf("#" + card.number) >= 0 ? 2 : 0);
          if (!score) continue;
          var at = Date.parse(it.updatedAt || "") || 0;
          if (!best || score > best.score || (score === best.score && at > best.at)) {
            best = { score: score, at: at, sid: it.sessionId || it.id };
          }
        }
        if (best) {
          bindSession(key, best.sid);
          return finishJump(best.sid, card, false, tag);
        }
        createReviewSession(card, key, tag);
      }, function (e) { jumpBusy = false; ghFallback("Session search failed: " + errText(e)); });
    } catch (e) {
      jumpBusy = false;
      console.error("[pr-board] openReviewSession failed:", e);
      toast("PR board: click failed — " + errText(e) + " (details in console)");
    }
  }

  // Where this repo's review sessions open: an explicit per-repo workspace,
  // or nowhere (cards open GitHub). There is deliberately no global default.
  function workspaceFor(repo) {
    var m = cfg.workspaces || {};
    if (m[repo]) return m[repo];
    // GitHub is case-insensitive but config keys are not: a repo entered as
    // "deepspeed" on one device and "DeepSpeed" on another must still resolve.
    var lower = String(repo).toLowerCase();
    for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k) && k.toLowerCase() === lower) return m[k];
    return "";
  }

  function createReviewSession(card, key, tag) {
    var repo = card.repo || currentRepo();
    var wsId = workspaceFor(repo);
    if (!wsId) {
      jumpBusy = false;
      ghFallback("No review workspace configured for " + repo + ". Set one in Settings");
      return;
    }
    if (!CTX.workspaces || !CTX.workspaces.startSession) {
      jumpBusy = false;
      ghFallback("Creating review session failed: workspaces service unavailable");
      return;
    }
    // The official path (same as the sidebar New button): connectWorkspace
    // reuses an existing blank session, coalesces concurrent creates and
    // handles attach failures; it opens the session itself. Direct
    // sessions.create is a lower-level primitive and fails on the
    // blank-session-already-exists cases that connectWorkspace absorbs.
    var before = null;
    try { before = (CTX.sessions.list.getSnapshot() || {}).current; } catch (e) {}
    try { CTX.workspaces.startSession(wsId); }
    catch (e) {
      jumpBusy = false;
      ghFallback("Creating review session failed: " + errText(e));
      return;
    }
    // startSession is fire-and-forget: watch the sessions list until `current`
    // moves to a NEW blank session, then bind it and hand the agent its PR.
    var done = false, tries = 0, unsub = null;
    var stop = function () { if (unsub) { try { unsub(); } catch (e) {} unsub = null; } };
    var check = function () {
      if (done) return;
      var snap = null;
      try { snap = CTX.sessions.list.getSnapshot(); } catch (e) { return; }
      var cur = snap && snap.current;
      if (!cur || cur === before) return;
      var summary = snap.byId && snap.byId[cur];
      if (!summary || !summary.blank) return;
      done = true;
      stop();
      bindSession(key, cur);
      finishJump(cur, card, true, tag);
      if (cfg.autoprompt !== false) {
        sendReviewPrompt(cur, card, tag, 8);
      } else {
        toast("Session is blank and untitled until you send something — next click reuses it via the binding table");
      }
    };
    try { unsub = CTX.sessions.list.subscribe(check); } catch (e) {}
    var timer = setInterval(function () {
      if (done || ++tries > 40) {
        clearInterval(timer);
        stop();
        if (!done) { jumpBusy = false; toast("Session opened but could not be identified for binding"); }
        return;
      }
      check();
    }, 250);
  }

  // Send the first review prompt into the fresh session. This is what makes
  // the whole flow work: the LLM title is generated from the first message
  // (blank sessions cannot hold titles), and the agent receives its PR context
  // without being told to go look for one. binding() may not be materialized
  // the instant `current` moves, and prompt() resolves with {ok:false,...}
  // rather than throwing — retry both, toast the wire cause on terminal failure.
  function sendReviewPrompt(sid, card, tag, attempts) {
    var b = null;
    try { b = CTX.sessions.binding && CTX.sessions.binding(sid); } catch (e) {}
    var sess = b && b.session;
    if (!sess || typeof sess.prompt !== "function") {
      if (attempts > 0) return setTimeout(function () { sendReviewPrompt(sid, card, tag, attempts - 1); }, 500);
      toast("Review prompt not sent: session object unavailable — paste the PR link yourself");
      return;
    }
    var repo = card.repo || currentRepo();
    // Context + memory restore, not a workflow: the first message tells the
    // agent WHICH item this session is about (PR or issue), hands it the
    // board's own snapshot as a starting point, and asks it to summarize what
    // has recently HAPPENED (events and standing, never a code walkthrough)
    // before asking what to do. It also seeds the LLM session title, keeping
    // title search by "repo#N" working.
    var isIssue = card.kind === "issue";
    var facts = [];
    var stateNames = isIssue
      ? { waiting_me: "waiting on me", waiting_reporter: "waiting on reporter" }
      : { waiting_me: "waiting on me", waiting_author: "waiting on author", ready_merge: "ready to merge", inbox: "untriaged" };
    var reasonMap = isIssue ? ISS_REASONS : REASONS;
    var fact = (stateNames[card.state] || card.state) + (reasonMap[card.reason] ? " — " + reasonMap[card.reason] : "");
    facts.push(fact);
    if (!isIssue) {
      if (card.ci === "FAILURE" || card.ci === "ERROR") facts.push("CI failing");
      else if (card.ci === "PENDING") facts.push("CI running");
      else if (card.ci === "SUCCESS") facts.push("CI green");
      if (card.mergeable === "CONFLICTING") facts.push("has conflicts");
      if (card.isDraft) facts.push("draft");
    }
    var kindWord = isIssue ? "issue" : "pull request";
    var text =
      "This session is for working on " + kindWord + " " + repo + "#" + card.number +
      (card.title ? ' — "' + String(card.title).slice(0, 80) + '"' : "") +
      (card.author ? " by @" + card.author : "") + ".\n" +
      "URL: " + card.url + "\n" +
      "My board currently says: " + facts.join("; ") + ".\n\n" +
      (isIssue
        ? "First, refresh that into an accurate picture: use gh (e.g. `gh issue view " + card.number + " --repo " + repo + "` " +
          "and the issue comments / timeline via `gh api`) to pull what has recently happened, " +
          "then give me a brief summary of the EVENTS and current standing — who commented what and when, labels, open/closed state. " +
          "Do NOT explain the code; this is context restoration.\n"
        : "First, refresh that into an accurate picture: use gh (e.g. `gh pr view " + card.number + " --repo " + repo + " --json state,reviewDecision,statusCheckRollup` " +
          "and the PR timeline / recent reviews and comments via `gh api`) to pull what has recently happened, " +
          "then give me a brief summary of the EVENTS and current standing — who reviewed/commented/pushed what and when, CI and merge status. " +
          "Do NOT explain or walk through the code; this is context restoration, not review.\n") +
      "After the summary, ask me what I'd like to do next and follow my direction. " +
      "Never post anything to GitHub without my explicit approval.";
    try {
      var r = sess.prompt([{ type: "text", text: text }], "queue");
      if (r && typeof r.then === "function") r.then(function (res) {
        if (res && res.ok) return; // silent on success — the session itself is the feedback
        if (attempts > 0) setTimeout(function () { sendReviewPrompt(sid, card, tag, attempts - 1); }, 500);
        else toast("Review prompt rejected: " + errText(res && res.error) + " — paste the PR link yourself");
      }, function (e) {
        if (attempts > 0) setTimeout(function () { sendReviewPrompt(sid, card, tag, attempts - 1); }, 500);
        else toast("Review prompt error: " + errText(e));
      });
    } catch (e) {
      if (attempts > 0) setTimeout(function () { sendReviewPrompt(sid, card, tag, attempts - 1); }, 500);
      else toast("Review prompt error: " + errText(e));
    }
  }

  function finishJump(sessionId, card, created, tag) {
    try { CTX.sessions.open(sessionId); } catch (e) {}
    jumpBusy = false;
    var ov = document.getElementById("pr-board-overlay");
    if (ov) ov.classList.remove("pb-show");
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
    return '<div class="pbw-head"><span>PR Board</span><button class="pbw-add" id="pbw-add" title="Add a repository">+</button></div>' +
      '<div class="pbw-list" id="pbw-row"><span class="pbw-chip" style="opacity:.6">Loading…</span></div>';
  }

  // Shared widget click handling: + adds a repo, the PR row opens the PR
  // board for that repo, the indented issue row opens its issue board.
  function widgetClick(e) {
    var addEl = e.target.closest && e.target.closest("#pbw-add");
    if (addEl) { e.stopPropagation(); addRepo(); return; }
    var issEl = e.target.closest && e.target.closest("[data-widget-issues]");
    if (issEl) { openBoard(issEl.getAttribute("data-widget-issues"), "issue"); return; }
    var mineEl = e.target.closest && e.target.closest("[data-widget-mine]");
    if (mineEl) { openBoard("", "mine"); return; }
    var repoEl = e.target.closest && e.target.closest("[data-widget-repo]");
    if (repoEl) { openBoard(repoEl.getAttribute("data-widget-repo"), "pr"); return; }
    openBoard();
  }

  // Mount the widget into the sidebar (move + clear pill inline styles if it exists)
  function mountInSidebar(sidebar) {
    var w = document.getElementById("pr-board-widget");
    if (!w) {
      w = document.createElement("div");
      w.id = "pr-board-widget";
      w.innerHTML = widgetHtml();
      w.addEventListener("click", widgetClick);
    } else {
      w.style.cssText = "";
    }
    sidebar.insertBefore(w, sidebar.lastChild);
    return w;
  }

  function renderWidget() {
    var row = document.getElementById("pbw-row");
    if (!row) return;
    if (!cfg.repos.length) {
      row.innerHTML = '<span class="pbw-chip" style="opacity:.6">No repositories · + to add one</span>';
      return;
    }
    if (!data || !data.ok) {
      row.innerHTML = '<span class="pbw-chip" style="opacity:.6">' + esc((data && data.error) || "Loading…") + "</span>";
      return;
    }
    var html = "";
    cfg.repos.forEach(function (repo) {
      var rd = repoData(repo);
      if (!rd || !rd.ok) {
        html += '<div class="pbw-repo" data-widget-repo="' + esc(repo) + '" title="' + esc(repo) + '"><span class="pbw-name">' +
          esc(displayName(repo)) + '</span><span class="pbw-chip" style="opacity:.6">error</span></div>';
        return;
      }
      var c = rd.counts;
      var ic = rd.issueCounts || { waiting_me: 0, waiting_reporter: 0 };
      // Two aligned rows in one grid: name | kind label (right-aligned against
      // the numbers) | four number columns. Issue numbers share the PR columns,
      // so me/reporter sit directly under their PR counterparts.
      html += '<div class="pbw-rblock" data-widget-repo="' + esc(repo) + '" title="' + esc(repo) + ' pull requests">' +
        '<span class="pbw-name">' + esc(displayName(repo)) + "</span>" +
        '<span class="pbw-kind" title="pull requests">pr</span>' +
        '<span class="pbw-cell me" title="PRs waiting on me">' + c.waiting_me + "</span>" +
        '<span class="pbw-cell author" title="PRs waiting on author">' + c.waiting_author + "</span>" +
        '<span class="pbw-cell ready" title="PRs ready to merge">' + c.ready_merge + "</span>" +
        '<span class="pbw-cell inbox" title="New PRs to triage">' + c.inbox + "</span>" +
        '<span class="pbw-kind pbw-kind-iss" data-widget-issues="' + esc(repo) + '" title="' + esc(repo) + ' issues">issue</span>' +
        '<span class="pbw-cell me pbw-ic1" data-widget-issues="' + esc(repo) + '" title="Issues waiting on me">' + ic.waiting_me + "</span>" +
        '<span class="pbw-cell author pbw-ic2" data-widget-issues="' + esc(repo) + '" title="Issues waiting on reporter">' + ic.waiting_reporter + "</span>" +
        "</div>";
    });
    // Global "mine" row: PRs I authored in every repo — my move / their move.
    var mn = data && data.mine && data.mine.ok ? data.mine.counts : { waiting_me: 0, waiting_others: 0 };
    html += '<div class="pbw-rblock pbw-mine-row" data-widget-mine="1" title="Pull requests you authored (all repos)">' +
      '<span class="pbw-name">mine</span><span class="pbw-kind">pr</span>' +
      '<span class="pbw-cell me" title="My PRs needing my move">' + mn.waiting_me + "</span>" +
      '<span class="pbw-cell author" title="My PRs waiting on others">' + mn.waiting_others + "</span>" +
      "</div>";
    row.innerHTML = html;
  }

  // ---------- board ----------
  function cardHtml(c, colKey) {
    var reasons = c.kind === "issue" ? ISS_REASONS : (boardMode === "mine" ? MINE_REASONS : REASONS);
    var meta = '<div class="pbo-meta">' +
      (boardMode === "mine" && c.repo ? "<span>" + esc(shortName(c.repo)) + "</span>" : "") +
      "<span>@" + esc(c.author) + "</span>" +
      (c.when ? "<span>" + esc(timeAgo(c.when)) + "</span>" : "");
    if (colKey !== "merged" && colKey !== "closed_recent" && c.reason && reasons[c.reason]) meta += '<span class="pbo-reason">' + esc(reasons[c.reason]) + '</span>';
    if (c.kind !== "issue") {
      if (c.ci === "FAILURE" || c.ci === "ERROR") meta += '<span class="pbo-badge-cifail">CI failing</span>';
      else if (c.ci === "PENDING") meta += '<span class="pbo-badge-cirun">CI running</span>';
      else if (c.ci === "EXPECTED") meta += '<span class="pbo-badge-ciqueue">CI queued</span>';
      else if (c.ci === "SUCCESS") meta += '<span class="pbo-badge-cipass">CI ✓</span>';
      if (c.mergeable === "CONFLICTING") meta += '<span class="pbo-badge-conflict">conflict</span>';
      if (c.isDraft) meta += '<span class="pbo-badge-draft">draft</span>';
    }
    meta += "</div>";
    var claim = colKey === "inbox"
      ? '<button class="pbo-claim" data-claim="' + c.number + '">I&#39;ll review</button>' : "";
    // Two click zones: the #number anchor goes to GitHub (middle-click and
    // copy-link work natively), the rest of the card jumps into the session.
    return '<div class="pbo-card" data-num="' + c.number + '" data-repo="' + esc(c.repo || "") + '" data-url="' + esc(c.url) + '">' +
      '<button class="pbo-gh" data-gh="' + esc(c.url) + '" title="Open on GitHub">↗</button>' +
      '<div class="pbo-title-line"><a class="pbo-num" data-gh="' + esc(c.url) + '" href="' + esc(c.url) + '" target="_blank" rel="noopener" title="Open #' + c.number + ' on GitHub">#' + c.number + "</a>" + esc(c.title) + "</div>" + meta + claim + "</div>";
  }

  function renderBoard() {
    var tabs = document.getElementById("pbo-tabs");
    var body = document.getElementById("pbo-body");
    if (!body) return;
    // repo tabs: click to switch, hover shows × to remove (deletion lives here, not in the widget)
    if (tabs) {
      var th = "";
      cfg.repos.forEach(function (repo) {
        var act = repo === currentRepo();
        th += '<span class="pbo-tab' + (act ? " pb-active" : "") + '" data-tab="' + esc(repo) + '" title="' + esc(repo) + '">' +
          esc(displayName(repo)) + '<i class="pbo-tab-x" data-remove="' + esc(repo) + '" title="Stop monitoring ' + esc(repo) + '">×</i></span>';
      });
      th += '<span class="pbo-tab pbo-tab-add" data-tab-add="1" title="Add a repository">+</span>';
      tabs.innerHTML = th;
    }
    currentCards = {};
    if (!data) { body.innerHTML = '<div class="pbo-loading">Loading…</div>'; return; }
    if (!cfg.repos.length) { body.innerHTML = '<div class="pbo-error">No repositories yet: add one with + (e.g. octocat/hello-world)</div>'; return; }
    if (!data.ok) { body.innerHTML = '<div class="pbo-error">' + esc(data.error || "load failed") + "</div>"; return; }
    var repo = currentRepo();
    var rd = repoData(repo);
    var mineMode = boardMode === "mine";
    var issueMode = boardMode === "issue";
    var colsDef = mineMode ? MINE_COLS : (issueMode ? ISS_COLS : COLS);
    var columnsSrc = mineMode ? (data.mine && data.mine.ok && data.mine.columns) : (issueMode ? (rd && rd.issueColumns) : (rd && rd.columns));
    var modeBtn = document.getElementById("pbo-mode");
    if (modeBtn) modeBtn.textContent = mineMode ? "→ Pull requests" : (issueMode ? "→ Mine" : "→ Issues");
    var sub = document.getElementById("pbo-sub");
    if (sub) sub.textContent = (mineMode ? "my pull requests" : repo + (issueMode ? " · issues" : " · pull requests")) + " · @" + data.user + " · updated " + timeAgo(data.generatedAt);
    if (mineMode) {
      if (!data.mine) { body.innerHTML = '<div class="pbo-loading">Loading…</div>'; return; }
      if (!data.mine.ok) { body.innerHTML = '<div class="pbo-error">mine: ' + esc(data.mine.error || "load failed") + "</div>"; return; }
    } else {
      if (!rd) { body.innerHTML = '<div class="pbo-loading">Loading…</div>'; return; }
      if (!rd.ok) { body.innerHTML = '<div class="pbo-error">' + esc(repo) + ": " + esc(rd.error || "load failed") + "</div>"; return; }
    }
    var html = "";
    colsDef.forEach(function (col) {
      var list = (columnsSrc && columnsSrc[col.key]) || [];
      list.forEach(function (c) {
        if (!mineMode) c.repo = repo;
        c.kind = mineMode || !issueMode ? "pr" : "issue";
        currentCards[(c.repo || "") + "#" + c.number] = c;
      });
      // First two columns support client-side sort toggling (new→old / old→new); others stay new→old
      var sortable = col.key === "waiting_me" || col.key === "waiting_author" || col.key === "waiting_reporter" || col.key === "waiting_others";
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

  // Add a repository to the watch list (widget + and board tab + both land here)
  function addRepo() {
    var repo = prompt("Repository to monitor (owner/name, e.g. octocat/hello-world)", "");
    if (repo === null) return;
    repo = repo.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) { toast("Repo must be owner/name; not added"); return; }
    if (cfg.repos.indexOf(repo) >= 0) { toast("Already monitoring " + repo); return; }
    cfg.repos.push(repo);
    activeRepo = repo;
    saveCfg();
    restartPolling();
    refresh(true, true);
  }

  // Remove happens only inside the board (tab ×), with a confirm, per design
  function removeRepo(repo) {
    if (!confirm("Stop monitoring " + repo + "?")) return;
    cfg.repos = cfg.repos.filter(function (r) { return r !== repo; });
    if (activeRepo === repo) activeRepo = cfg.repos[0] || "";
    try {
      var last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      if (last && last.repos) { delete last.repos[repo]; localStorage.setItem(LAST_KEY, JSON.stringify(last)); }
    } catch (e) {}
    saveCfg();
    refresh(false, true);
  }

  // Workspace list from the GUI's own snapshot; label = name/title/cwd/id,
  // whichever the current wire exposes.
  function workspaceOptions() {
    if (!CTX || !CTX.workspaces || !CTX.workspaces.list) return [];
    var snap;
    try { snap = CTX.workspaces.list.getSnapshot(); } catch (e) { return []; }
    return ((snap && snap.items) || []).map(function (w, i) {
      return { n: i + 1, id: w.workspaceId, label: w.name || w.title || w.label || w.cwd || w.workspaceId };
    });
  }

  // Settings dialog: username → review workspace (repos are managed via + / tab ×)
  function openSettings() {
    var user = prompt("GitHub username (blank = use the gh login account)", cfg.user || "");
    if (user === null) return;
    cfg.user = user.trim();
    saveCfg();
    // Per-repo review workspaces: pick a repo, then a workspace for it.
    // No global default on purpose — every repo carries an explicit choice.
    var opts = workspaceOptions();
    var labelOf = function (id) {
      if (!id) return "(not set — cards open GitHub)";
      for (var j = 0; j < opts.length; j++) if (opts[j].id === id) return opts[j].label;
      return id;
    };
    var repoLines = cfg.repos.map(function (r, idx) {
      return (idx + 1) + ") " + displayName(r) + " → " + labelOf(cfg.workspaces[r]);
    }).join("\n");
    var target = prompt(
      "Review workspaces — where each repo's review sessions open:\n" +
      (repoLines || "(no repos)") + "\n" +
      "Set which? (a repo number; blank = keep)",
      ""
    );
    if (target !== null && target.trim() !== "") {
      target = target.trim();
      var repoIdx = /^\d+$/.test(target) ? Number(target) - 1 : -1;
      if (repoIdx >= 0 && repoIdx < cfg.repos.length) {
        var targetName = displayName(cfg.repos[repoIdx]);
        var curId = cfg.workspaces[cfg.repos[repoIdx]] || "";
        var cur = "";
        for (var k = 0; k < opts.length; k++) if (opts[k].id === curId) cur = String(opts[k].n);
        var pick = prompt(
          "Workspace for " + targetName + ":\n" +
          (opts.length ? opts.map(function (o) { return o.n + ") " + o.label; }).join("\n") : "(no workspaces found)") + "\n" +
          "Enter a number (blank = none: card clicks open GitHub)" +
          (cur ? "\nCurrent: " + cur : ""),
          cur
        );
        if (pick !== null) {
          pick = pick.trim();
          var id = "";
          if (/^\d+$/.test(pick) && opts[Number(pick) - 1]) id = opts[Number(pick) - 1].id;
          else {
            var byId = opts.filter(function (o) { return o.id === pick || o.label === pick; })[0];
            id = byId ? byId.id : "";
            if (pick && !byId) toast("No workspace matched \"" + pick + "\" — cleared");
          }
          if (id) cfg.workspaces[cfg.repos[repoIdx]] = id;
          else delete cfg.workspaces[cfg.repos[repoIdx]];
          saveCfg();
        }
      }
    }
    var ap = prompt(
      "Auto-send PR context when a new review session is created?\n" +
      "y = the agent summarizes what recently happened on the PR (events, not code) and then asks what you want to do\n" +
      "n = blank session; you type your own instructions\n" +
      "(the LLM session title derives from the first message, so 'y' also makes sessions searchable by PR number)\n" +
      "Current: " + (cfg.autoprompt === false ? "n" : "y"),
      cfg.autoprompt === false ? "n" : "y"
    );
    if (ap !== null) {
      ap = ap.trim().toLowerCase();
      cfg.autoprompt = !(ap === "n" || ap === "no" || ap === "0" || ap === "false");
      saveCfg();
    }
    restartPolling();
    refresh(true, true);
  }

  function openBoard(repo, mode) {
    var ov = ensureBoard();
    ov.classList.add("pb-show");
    if (repo && cfg.repos.indexOf(repo) >= 0) activeRepo = repo;
    if (mode === "issue" || mode === "pr" || mode === "mine") boardMode = mode;
    if (!cfg.repos.length) { addRepo(); return; } // first run: guide straight into setup
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
      '<button class="pbo-btn" id="pbo-mode" title="Switch between the pull-request and issue boards">→ Issues</button>' +
      '<span class="pbo-dwrap" title="Hide PRs and issues with no activity (any touch) for more than this many days. 0 = show everything."><input id="pbo-days" type="number" min="0" max="365" step="5" value="' + (isFinite(cfg.inactiveDays) ? cfg.inactiveDays : 30) + '">d</span>' +
      '<select id="pbo-interval">' +
      [1, 2, 5, 10, 30].map(function (m) {
        return '<option value="' + m + '"' + (m === cfg.interval ? " selected" : "") + ">" + m + " min poll</option>";
      }).join("") + "</select>" +
      '<button class="pbo-btn" id="pbo-cfg">Settings</button>' +
      '<button class="pbo-btn" id="pbo-refresh">Refresh</button>' +
      '<button class="pbo-btn" id="pbo-close">Close</button></div>' +
      '<div class="pbo-tabs" id="pbo-tabs"></div>' +
      '<div class="pbo-body" id="pbo-body"><div class="pbo-loading">Loading…</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) {
      // Blank areas close the board. The overlay itself is fully covered by its
      // children, so "blank" = structural, non-interactive elements hit exactly:
      // the body grid, a column's empty stretch, an "empty" placeholder, or the
      // tab bar's leftover space. Exact target checks (not closest) so clicks on
      // cards/buttons inside those containers never match this branch.
      var t = e.target;
      if (t === ov || t.id === "pbo-body" || (t.classList && (t.classList.contains("pbo-col") || t.classList.contains("pbo-empty") || t.classList.contains("pbo-tabs")))) {
        ov.classList.remove("pb-show");
        return;
      }
      var ghEl = e.target.closest && e.target.closest("[data-gh]");
      if (ghEl) { e.stopPropagation(); e.preventDefault(); window.open(ghEl.getAttribute("data-gh"), "_blank"); return; }
      var rmEl = e.target.closest && e.target.closest("[data-remove]");
      if (rmEl) { e.stopPropagation(); removeRepo(rmEl.getAttribute("data-remove")); return; }
      var tabAddEl = e.target.closest && e.target.closest("[data-tab-add]");
      if (tabAddEl) { e.stopPropagation(); addRepo(); return; }
      var tabEl = e.target.closest && e.target.closest("[data-tab]");
      if (tabEl) { activeRepo = tabEl.getAttribute("data-tab"); boardMode = "pr"; renderBoard(); return; }
      var sortEl = e.target.closest && e.target.closest("[data-sort]");
      if (sortEl) {
        var sortKey = sortEl.getAttribute("data-sort");
        cfg.sort = cfg.sort || {};
        cfg.sort[sortKey] = cfg.sort[sortKey] === "old" ? "new" : "old";
        saveCfg();
        renderBoard();
        return;
      }
      var claimEl = e.target.closest && e.target.closest("[data-claim]");
      if (claimEl) {
        e.stopPropagation();
        var num = parseInt(claimEl.getAttribute("data-claim"), 10);
        claimEl.disabled = true;
        claimEl.textContent = "Requesting…";
        api("/api/pr-board/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: currentRepo(), user: cfg.user, number: num })
        }).then(function (v) {
          if (v.ok) { toast("PR #" + num + " added to your review queue"); refresh(true, true); }
          else { toast("Claim failed: " + (v.error || "unknown error")); claimEl.disabled = false; claimEl.textContent = "I'll review"; }
        }).catch(function () { claimEl.disabled = false; claimEl.textContent = "I'll review"; });
        return;
      }
      // Card click: jump into the review session for this PR (open or create).
      var cardEl = e.target.closest && e.target.closest(".pbo-card");
      if (cardEl) {
        var cn = parseInt(cardEl.getAttribute("data-num"), 10);
        var cardObj = currentCards[(cardEl.getAttribute("data-repo") || "") + "#" + cn];
        if (cardObj) openReviewSession(cardObj);
        else if (cardEl.dataset && cardEl.dataset.url) window.open(cardEl.dataset.url, "_blank");
      }
    });
    document.getElementById("pbo-close").onclick = function () { ov.classList.remove("pb-show"); };
    document.getElementById("pbo-refresh").onclick = function () { refresh(true, true); };
    document.getElementById("pbo-cfg").onclick = openSettings;
    document.getElementById("pbo-mode").onclick = function () {
      boardMode = boardMode === "pr" ? "issue" : (boardMode === "issue" ? "mine" : "pr");
      renderBoard();
    };
    document.getElementById("pbo-days").onchange = function () {
      var n = parseInt(this.value, 10);
      if (!isFinite(n) || n < 0) n = 30;
      if (n > 365) n = 365;
      this.value = n;
      cfg.inactiveDays = n;
      saveCfg();
      refresh(false, true); // new days value rides the request; host cache is keyed by it
    };

    // Horizontal pan for the narrow single-row layout: touch pans natively via
    // overflow-x, so this only handles mouse pointers — drag anywhere on the
    // body (except form controls) to scroll sideways. A drag that moved more
    // than a few px swallows the following click so releasing over a card
    // doesn't trigger a session jump.
    var panState = null, panMoved = false;
    var bodyEl = document.getElementById("pbo-body");
    var swallowClick = function (e) {
      bodyEl.removeEventListener("click", swallowClick, true);
      if (panMoved) { e.stopPropagation(); e.preventDefault(); }
    };
    bodyEl.addEventListener("pointerdown", function (e) {
      bodyEl.removeEventListener("click", swallowClick, true);
      panMoved = false;
      if (e.pointerType === "touch") return;
      if (e.target.closest && e.target.closest("button,a,select,input,textarea")) return;
      panState = { x: e.clientX, left: bodyEl.scrollLeft };
    });
    document.addEventListener("pointermove", function (e) {
      if (!panState) return;
      var dx = e.clientX - panState.x;
      if (!panMoved && Math.abs(dx) > 6) { panMoved = true; bodyEl.classList.add("pbw-panning"); }
      if (panMoved) bodyEl.scrollLeft = panState.left - dx;
    });
    document.addEventListener("pointerup", function () {
      if (panState && panMoved) bodyEl.addEventListener("click", swallowClick, true);
      panState = null;
      bodyEl.classList.remove("pbw-panning");
    });
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
    pollTimer = setInterval(function () {
      pullCfg(); // converge on config edited from another device
      pullBindings();
      refresh(false, false);
    }, (cfg.interval || 5) * 60000);
  }

  function floatPill() {
    if (document.getElementById("pr-board-widget")) return;
    var w = document.createElement("div");
    w.id = "pr-board-widget";
    w.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147482000;padding:7px 12px;border-radius:10px;background:#1f6feb;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.35)";
    w.innerHTML = widgetHtml();
    w.addEventListener("click", widgetClick);
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
        pullCfg();
        pullBindings();
        refresh(false, true);
        return;
      }
      setTimeout(init, 800);
      return;
    }
    mountInSidebar(sidebar);
    restartPolling();
    pullCfg();
    pullBindings();
    refresh(false, true);
  }

  // Alt+P always opens the board, even if the widget failed to render
  function bindHotkey() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        var shown = document.getElementById("pr-board-overlay");
        if (shown && shown.classList.contains("pb-show")) shown.classList.remove("pb-show");
        else openBoard();
      }
    });
  }

  function injectStyle() {
    if (document.getElementById("pr-board-style")) return;
    var st = document.createElement("style");
    st.id = "pr-board-style";
    st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  function apply(ctx) {
    CTX = ctx;
    injectStyle();
    bindHotkey();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  window.__ModuleLoader__.load({
    id: "dsh-pr-board",
    factory: function () {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      exports.name = name;
      exports.inject = inject;
      exports.apply = apply;
      return module.exports;
    }
  });
})();
