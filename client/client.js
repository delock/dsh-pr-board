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
#pr-board-overlay .pbo-btn:hover{background:rgba(255,255,255,.18)}
#pr-board-overlay .pbo-body{flex:1;overflow:auto;display:grid;gap:10px;padding:12px 14px;grid-template-columns:repeat(5,minmax(230px,1fr));align-content:start;align-items:start}
@media (max-width:1100px){#pr-board-overlay .pbo-body{grid-template-columns:repeat(2,minmax(230px,1fr))}}
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
#pr-board-overlay .pbo-badge-draft{padding:0 6px;border-radius:6px;font-size:11px;background:rgba(148,163,184,.25);color:#cbd5e1}
#pr-board-overlay .pbo-claim{margin-top:6px;width:100%;padding:3px 0;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(125,211,252,.15);color:#bae6fd;font-size:11px;font-weight:600;cursor:pointer}
#pr-board-overlay .pbo-claim:hover{background:rgba(125,211,252,.3)}
#pr-board-overlay .pbo-gh{position:absolute;top:4px;right:4px;width:18px;height:18px;line-height:16px;text-align:center;padding:0;border:none;border-radius:5px;background:transparent;color:rgba(255,255,255,.4);font-size:12px;cursor:pointer;opacity:0}
#pr-board-overlay .pbo-card:hover .pbo-gh{opacity:1}
#pr-board-overlay .pbo-gh:hover{background:rgba(255,255,255,.15);color:#fff}
#pr-board-overlay .pbo-empty{padding:10px;border-radius:8px;border:1px dashed rgba(255,255,255,.15);color:rgba(255,255,255,.4);font-size:11px;text-align:center}
#pr-board-overlay .pbo-error{margin:20px auto;padding:10px 16px;border-radius:8px;background:rgba(239,68,68,.15);color:#fca5a5;font-size:13px;max-width:520px}
#pr-board-overlay .pbo-loading{color:rgba(255,255,255,.5);font-size:12px;padding:6px 4px}
#pr-board-toast{position:fixed;right:16px;bottom:16px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;max-width:340px}
#pr-board-toast .pbt{padding:9px 13px;border-radius:8px;background:#1f6feb;color:#fff;font-size:12.5px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;opacity:.97}
#pr-board-toast .pbt b{font-weight:700}
`;

  var name = "pr-board";
  var inject = ["sessions", "workspaces"];

  // ---------------------------------------------------------------- frontend

  var CTX = null;

  var CFG_KEY = "prboard.cfg", LAST_KEY = "prboard.last", BIND_KEY = "prboard.sessions";
  var DEFAULTS = { repos: [], user: "", workspace: "", autoprompt: true, interval: 5, sort: { waiting_me: "new", waiting_author: "new" } };
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
    "auto-merge": "Auto-merge armed",
    "auto-merge-blocked": "Auto-merge blocked (failing checks / branch)"
  };
  var cfg = loadCfg(), pollTimer = null, data = null, busy = false, activeRepo = "";
  var currentCards = {}; // PR number -> card object (for the click-to-session flow)
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
    if (typeof c.workspace !== "string") c.workspace = "";
    if (typeof c.autoprompt !== "boolean") c.autoprompt = true;
    return c;
  }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  // ---------- PR ↔ session bindings ----------
  // Exact, immediate association ("owner/repo#N" -> sessionId). Session titles
  // only materialize after the first message (LLM-generated), so titles alone
  // can never match a freshly created review session — the binding table is
  // the primary lookup, title search the cross-browser fallback.
  function loadBindings() {
    try { var b = JSON.parse(localStorage.getItem(BIND_KEY) || "{}"); return b && typeof b === "object" ? b : {}; }
    catch (e) { return {}; }
  }
  function saveBindings(b) { try { localStorage.setItem(BIND_KEY, JSON.stringify(b)); } catch (e) {} }
  function bindSession(key, sid) {
    var b = loadBindings();
    // One session belongs to at most one PR: if this session was previously
    // bound to another PR (blank-session reuse), release the old claim.
    for (var k in b) if (b[k] && b[k].sid === sid && k !== key) delete b[k];
    b[key] = { sid: sid, t: Date.now() };
    saveBindings(b);
  }
  function boundSession(key) {
    var b = loadBindings();
    var e = b[key];
    if (!e || !e.sid) return null;
    // Validate against the live list; a deleted/archived session re-binds.
    var snap = null;
    try { snap = CTX && CTX.sessions && CTX.sessions.list.getSnapshot(); } catch (x) {}
    if (snap && snap.byId && !(e.sid in snap.byId)) { delete b[key]; saveBindings(b); return null; }
    return e.sid;
  }

  // "owner/name" -> "name" for display; falls back to the full id when two
  // monitored repos share a short name.
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
    var q = "?repos=" + encodeURIComponent(cfg.repos.join(",")) + "&user=" + encodeURIComponent(cfg.user) + (fresh ? "&fresh=1" : "");
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
  function openReviewSession(card) {
    if (jumpBusy) return;
    if (!CTX || !CTX.sessions) { window.open(card.url, "_blank"); return; }
    jumpBusy = true;
    var key = sessionKey(card), tag = sessionTag(card);
    var bound = boundSession(key);
    if (bound) return finishJump(bound, card, false, tag);
    CTX.sessions.search(tag).then(function (res) {
      var items = (res && res.ok && res.value && res.value.items) || [];
      var hit = null;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var title = it.title || "";
        if (title.indexOf(tag) >= 0) { hit = it; break; }
      }
      if (hit) {
        var sid = hit.sessionId || hit.id;
        bindSession(key, sid);
        return finishJump(sid, card, false, tag);
      }
      createReviewSession(card, key, tag);
    }, function (e) { jumpBusy = false; toast("Session search failed: " + errText(e)); window.open(card.url, "_blank"); });
  }

  function createReviewSession(card, key, tag) {
    if (!cfg.workspace) {
      jumpBusy = false;
      toast("No review workspace configured — opened GitHub instead. Set one in Settings.");
      window.open(card.url, "_blank");
      return;
    }
    if (!CTX.workspaces || !CTX.workspaces.startSession) {
      jumpBusy = false;
      toast("Creating review session failed: workspaces service unavailable");
      window.open(card.url, "_blank");
      return;
    }
    // The official path (same as the sidebar New button): connectWorkspace
    // reuses an existing blank session, coalesces concurrent creates and
    // handles attach failures; it opens the session itself. Direct
    // sessions.create is a lower-level primitive and fails on the
    // blank-session-already-exists cases that connectWorkspace absorbs.
    var before = null;
    try { before = (CTX.sessions.list.getSnapshot() || {}).current; } catch (e) {}
    try { CTX.workspaces.startSession(cfg.workspace); }
    catch (e) {
      jumpBusy = false;
      toast("Creating review session failed: " + errText(e));
      window.open(card.url, "_blank");
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
    // Context, not a workflow: the first message tells the agent WHICH PR this
    // session is about and has it ask what to do — the user may want any of
    // review / CI / file history / drafting a reply / merge. It also seeds the
    // LLM session title (which derives from this message), keeping title
    // search by "repo#N" working.
    var text =
      "This session is for working on pull request " + repo + "#" + card.number +
      (card.title ? ' — "' + String(card.title).slice(0, 80) + '"' : "") + ".\n" +
      "URL: " + card.url + "\n" +
      "Don't start anything yet. First ask me what I'd like to do with this PR " +
      "(e.g. review the diff, check CI status, inspect specific files, draft a comment, prepare the merge), " +
      "then follow my direction. Never post anything to GitHub without my explicit approval.";
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

  // Shared widget click handling: + adds a repo, a repo row opens its board
  function widgetClick(e) {
    var addEl = e.target.closest && e.target.closest("#pbw-add");
    if (addEl) { e.stopPropagation(); addRepo(); return; }
    var repoEl = e.target.closest && e.target.closest("[data-widget-repo]");
    if (repoEl) { openBoard(repoEl.getAttribute("data-widget-repo")); return; }
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
      html += '<div class="pbw-repo" data-widget-repo="' + esc(repo) + '" title="' + esc(repo) + '"><span class="pbw-name">' +
        esc(displayName(repo)) + '</span><span class="pbw-chip me" title="Waiting on me">' + c.waiting_me +
        '</span><span class="pbw-chip author" title="Waiting on author">' + c.waiting_author +
        '</span><span class="pbw-chip ready" title="Ready to merge">' + c.ready_merge +
        '</span><span class="pbw-chip inbox" title="Inbox: new PRs to triage">' + c.inbox + "</span></div>";
    });
    row.innerHTML = html;
  }

  // ---------- board ----------
  function cardHtml(c, colKey) {
    var meta = '<div class="pbo-meta"><span>@' + esc(c.author) + "</span>" +
      (c.when ? "<span>" + esc(timeAgo(c.when)) + "</span>" : "");
    if (colKey !== "merged" && c.reason && REASONS[c.reason]) meta += '<span class="pbo-reason">' + esc(REASONS[c.reason]) + '</span>';
    if (c.mergeable === "CONFLICTING") meta += '<span class="pbo-badge-conflict">conflict</span>';
    if (c.isDraft) meta += '<span class="pbo-badge-draft">draft</span>';
    meta += "</div>";
    var claim = colKey === "inbox"
      ? '<button class="pbo-claim" data-claim="' + c.number + '">I&#39;ll review</button>' : "";
    // Two click zones: the #number anchor goes to GitHub (middle-click and
    // copy-link work natively), the rest of the card jumps into the session.
    return '<div class="pbo-card" data-num="' + c.number + '" data-url="' + esc(c.url) + '">' +
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
    var sub = document.getElementById("pbo-sub");
    if (sub) sub.textContent = repo + " · @" + data.user + " · updated " + timeAgo(data.generatedAt);
    if (!rd) { body.innerHTML = '<div class="pbo-loading">Loading…</div>'; return; }
    if (!rd.ok) { body.innerHTML = '<div class="pbo-error">' + esc(repo) + ": " + esc(rd.error || "load failed") + "</div>"; return; }
    var html = "";
    COLS.forEach(function (col) {
      var list = (rd.columns && rd.columns[col.key]) || [];
      list.forEach(function (c) { c.repo = repo; currentCards[c.number] = c; });
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
    var opts = workspaceOptions();
    var lines = opts.map(function (o) { return o.n + ") " + o.label; }).join("\n");
    var cur = "";
    for (var i = 0; i < opts.length; i++) if (opts[i].id === cfg.workspace) cur = String(opts[i].n);
    var ws = prompt(
      "Review workspace — where new PR review sessions open.\n" +
      (opts.length ? lines : "(no workspaces found)") + "\n" +
      "Enter a number (blank = disabled: card clicks open GitHub)" +
      (cur ? "\nCurrent: " + cur : ""),
      cur
    );
    if (ws === null) return;
    ws = ws.trim();
    if (!ws) { cfg.workspace = ""; }
    else if (/^\d+$/.test(ws) && opts[Number(ws) - 1]) { cfg.workspace = opts[Number(ws) - 1].id; }
    else {
      var byId = opts.filter(function (o) { return o.id === ws || o.label === ws; })[0];
      cfg.workspace = byId ? byId.id : "";
      if (!byId) toast("No workspace matched \"" + ws + "\" — review workspace cleared");
    }
    saveCfg();
    var ap = prompt(
      "Auto-send PR context when a new review session is created?\n" +
      "y = the agent is told which PR this session is for (number/title/URL) and asks what you want to do\n" +
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

  function openBoard(repo) {
    var ov = ensureBoard();
    ov.classList.add("pb-show");
    if (repo && cfg.repos.indexOf(repo) >= 0) activeRepo = repo;
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
      if (tabEl) { activeRepo = tabEl.getAttribute("data-tab"); renderBoard(); return; }
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
        var cardObj = currentCards[cn];
        if (cardObj) openReviewSession(cardObj);
        else if (cardEl.dataset && cardEl.dataset.url) window.open(cardEl.dataset.url, "_blank");
      }
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
