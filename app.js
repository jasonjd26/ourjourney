/* ============================================================
   OUR JOURNEY — Jason & Ciara  (Dublin → Calgary)
   Single-file app logic. Local-first, syncs to a Cloudflare
   worker that speaks {scalars:{k:{v,t}}, records:{id:{...,t,del}}}.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- config ---------- */
  var LS_STATE = 'ourjourney_state_v1';
  var LS_PREFS = 'ourjourney_prefs_v1';
  var ROOM_DEFAULT = 'jasonciara';
  var MOVE_DEFAULT = '2026-06-23T13:00';          // 1pm Dublin time, local-naive
  var CCY = '$';                                   // Canadian dollars
  var CATS = ['Rent/Deposit', 'Furniture', 'Groceries', 'Transport', 'Phone/Internet', 'Going out', 'Adventures', 'Other'];

  /* ---------- tiny helpers ---------- */
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var now = function () { return Date.now(); };
  var uid = function () { return now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  function money(n) { n = Number(n) || 0; return CCY + n.toLocaleString('en-CA', { maximumFractionDigits: (n % 1 ? 2 : 0) }); }

  /* ---------- state ---------- */
  var state, prefs, tab = 'home', syncStatus = 'local', pushTimer = null, pollTimer = null;

  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(LS_STATE)); if (s && s.scalars && s.records) return s; } catch (e) {}
    return { scalars: {}, records: {} };
  }
  function saveState() { try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) {} }
  function loadPrefs() {
    try { var p = JSON.parse(localStorage.getItem(LS_PREFS)); if (p) return Object.assign({ workerUrl: '', room: ROOM_DEFAULT, me: '' }, p); } catch (e) {}
    return { workerUrl: '', room: ROOM_DEFAULT, me: '' };
  }
  function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }

  /* scalars */
  function get(k, def) { var e = state.scalars[k]; return (e && e.v !== undefined) ? e.v : def; }
  function set(k, v) { state.scalars[k] = { v: v, t: now() }; saveState(); queuePush(); render(); }
  /* records */
  function recs(kind) {
    return Object.keys(state.records).map(function (id) { return state.records[id]; })
      .filter(function (r) { return r && !r.del && r.kind === kind; });
  }
  function put(rec) { if (!rec.id) rec.id = uid(); rec.t = now(); state.records[rec.id] = rec; saveState(); queuePush(); render(); }
  function patch(id, p) { var r = state.records[id]; if (!r) return; Object.assign(r, p); r.t = now(); saveState(); queuePush(); render(); }
  function del(id) { var r = state.records[id]; if (!r) return; r.del = true; r.t = now(); saveState(); queuePush(); render(); }

  /* ---------- merge (last-write-wins, mirrors the worker) ---------- */
  function merge(local, remote) {
    local = local && local.scalars ? local : { scalars: {}, records: {} };
    remote = remote && remote.scalars ? remote : { scalars: {}, records: {} };
    var k;
    for (k in remote.scalars) { var e = remote.scalars[k]; if (!e) continue; var p = local.scalars[k]; if (!p || (p.t || 0) < (e.t || 0)) local.scalars[k] = { v: e.v, t: e.t || 0 }; }
    for (k in remote.records) { var r = remote.records[k]; if (!r) continue; var q = local.records[k]; if (!q || (q.t || 0) < (r.t || 0)) local.records[k] = r; }
    return local;
  }

  /* ---------- sync ---------- */
  function endpoint() { return prefs.workerUrl.replace(/\/+$/, '') + '/state?id=' + encodeURIComponent(prefs.room || ROOM_DEFAULT); }
  function setStatus(s) { syncStatus = s; paintStatus(); }
  function paintStatus() {
    var d = $('#syncdot'), t = $('#synctxt'); if (!d) return;
    d.className = 'dot ' + syncStatus;
    t.textContent = !prefs.workerUrl ? 'On this phone'
      : syncStatus === 'ok' ? 'Synced'
      : syncStatus === 'sync' ? 'Syncing…'
      : syncStatus === 'err' ? 'Offline' : 'On this phone';
  }
  function queuePush() { if (!prefs.workerUrl) return; setStatus('sync'); clearTimeout(pushTimer); pushTimer = setTimeout(push, 700); }
  function push() {
    if (!prefs.workerUrl) return;
    fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: state }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.state) { state = merge(state, data.state); saveState(); softRender(); }
        setStatus(data && data.ok === false ? 'err' : 'ok');
      })
      .catch(function () { setStatus('err'); });
  }
  function poll() {
    if (!prefs.workerUrl) return;
    fetch(endpoint(), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.state) { var b = JSON.stringify(state); state = merge(state, data.state); if (JSON.stringify(state) !== b) { saveState(); softRender(); } }
        if (syncStatus !== 'sync') setStatus('ok');
      })
      .catch(function () { setStatus('err'); });
  }
  function startSync() {
    clearInterval(pollTimer);
    if (prefs.workerUrl) { setStatus('sync'); poll(); pollTimer = setInterval(poll, 4000); }
    else setStatus('local');
  }

  /* ---------- countdown ---------- */
  function cd() {
    var target = new Date(get('moveDate', MOVE_DEFAULT)).getTime();
    var diff = target - now();
    if (isNaN(target)) return { bad: true };
    if (diff > 0) {
      var s = Math.floor(diff / 1000);
      return { done: false, d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    }
    var day = Math.floor((now() - target) / 86400000) + 1;
    return { done: true, day: day };
  }
  function tickCountdown() {
    var c = cd(); if (c.bad) return;
    if (c.done) return; // count-up text is static-ish, set on render
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var map = { 'cd-d': c.d, 'cd-h': pad(c.h), 'cd-m': pad(c.m), 'cd-s': pad(c.s) };
    Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = map[id]; });
  }

  /* ============================================================
     RENDER
     ============================================================ */
  var NAV = [
    { id: 'home', label: 'Home', icon: 'M3 11l9-8 9 8M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10' },
    { id: 'plan', label: 'Checklist', icon: 'M9 11l3 3 8-8M3 7h6M3 12h4M3 17h8' },
    { id: 'money', label: 'Money', icon: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { id: 'trips', label: 'Calgary', icon: 'M3 20h18L14 7l-4 6-2-3-5 10z' }
  ];

  function renderNav() {
    $('#nav').innerHTML = NAV.map(function (n) {
      return '<button class="tab' + (tab === n.id ? ' active' : '') + '" data-tab="' + n.id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + n.icon + '"></path></svg>' +
        '<span class="lb">' + n.label + '</span></button>';
    }).join('');
  }

  function render() {
    renderNav(); paintStatus();
    var m = $('#main');
    if (tab === 'home') m.innerHTML = viewHome();
    else if (tab === 'plan') m.innerHTML = viewPlan();
    else if (tab === 'money') m.innerHTML = viewMoney();
    else if (tab === 'trips') m.innerHTML = viewTrips();
    tickCountdown();
  }
  /* re-render unless the user is mid-typing or a modal is open */
  function softRender() {
    if ($('.modal')) return;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    render();
  }

  /* ---------- sunset ridge art ---------- */
  function ridgeSVG() {
    return '<svg viewBox="0 0 512 132" preserveAspectRatio="xMidYMax slice">' +
      '<defs><radialGradient id="sn" cx=".5" cy=".95" r=".7"><stop offset="0" stop-color="#FFF4D6"/><stop offset=".5" stop-color="#FFDC8C"/><stop offset="1" stop-color="#FFC15A" stop-opacity="0"/></radialGradient></defs>' +
      '<circle cx="256" cy="118" r="78" fill="url(#sn)"/><circle cx="256" cy="118" r="42" fill="#FFE9A8" opacity=".95"/>' +
      '<path d="M0,86 L70,58 L120,74 L190,40 L250,70 L320,34 L380,72 L452,48 L512,72 L512,132 L0,132Z" fill="#7a3a22" opacity=".5"/>' +
      '<path d="M0,104 L64,72 L112,90 L168,54 L212,84 L268,44 L316,82 L372,56 L424,86 L470,64 L512,90 L512,132 L0,132Z" fill="#241612"/>' +
      '<path d="M50,18 l3,7 7,1 -5,5 1,7 -6,-3 -6,3 1,-7 -5,-5 7,-1z" fill="#FFF1CE" opacity=".9"/>' +
      '</svg>';
  }

  /* ---------- HOME ---------- */
  function viewHome() {
    var c = cd();
    var hero;
    if (c.done) {
      hero = '<div class="hero"><div class="hero-art">' + ridgeSVG() + '</div><div class="hero-body">' +
        '<div class="hero-cap">Home in the foothills 🤠</div>' +
        '<div class="cd-done" style="margin-top:10px">Day ' + c.day + ' in Calgary</div>' +
        '<div class="cd-sub">You made it. Welcome home, you two.</div></div></div>';
    } else {
      hero = '<div class="hero"><div class="hero-art">' + ridgeSVG() + '</div><div class="hero-body">' +
        '<div class="hero-cap">Dublin → Calgary</div>' +
        '<div class="cd-row">' +
        cell('cd-d', c.d, 'days') + cell('cd-h', ('0' + c.h).slice(-2), 'hrs') +
        cell('cd-m', ('0' + c.m).slice(-2), 'min') + cell('cd-s', ('0' + c.s).slice(-2), 'sec') +
        '</div><div class="cd-sub">Wheels up 1pm, 23 June 2026</div></div></div>';
    }

    var tasks = recs('task'), tdone = tasks.filter(function (t) { return t.done; }).length;
    var advs = recs('adventure'), adone = advs.filter(function (a) { return a.done; }).length;
    var spent = recs('expense').reduce(function (s, e) { return s + (Number(e.amt) || 0); }, 0);
    var goal = Number(get('goal', 0));

    var stats = '<div class="stats">' +
      stat(c.done ? c.day : c.d, c.done ? 'days here' : 'days to go') +
      stat(tdone + '/' + tasks.length, 'tasks done') +
      stat(advs.length ? adone + '/' + advs.length : '0', 'adventures') +
      '</div>';

    // next up
    var next = tasks.filter(function (t) { return !t.done; }).slice(0, 4);
    var nextCard = '<div class="card"><div class="card-h"><h3>Next up</h3><span class="right muted" style="font-size:12px">' + (tasks.length - tdone) + ' left</span></div>' +
      (next.length ? next.map(function (t) {
        return '<div class="item"><div class="box" data-act="toggle-task" data-id="' + t.id + '"></div>' +
          '<div class="it-body"><div class="it-t">' + esc(t.title) + '</div></div></div>';
      }).join('') : '<div class="empty">All caught up — nice work! 🎉</div>') +
      '</div>';

    var fund = '<div class="card"><div class="card-h"><h3>Moving fund</h3><span class="right muted" style="font-size:12px">' + money(spent) + ' spent</span></div>' +
      '<div class="kv"><span class="lbl">Saved toward goal</span><span class="num">' + money(Number(get('saved', 0))) + '</span></div>' +
      '<div class="bar" style="margin-top:10px"><i style="width:' + (goal > 0 ? Math.min(100, Math.round(Number(get('saved', 0)) / goal * 100)) : 0) + '%"></i></div>' +
      '<div class="kv" style="margin-top:8px"><span class="lbl">Goal</span><span class="lbl">' + (goal > 0 ? money(goal) : 'set in Money tab') + '</span></div></div>';

    return stats + hero + nextCard + fund;
  }
  function cell(id, v, l) { return '<div class="cd-cell"><div class="cd-n" id="' + id + '">' + v + '</div><div class="cd-l">' + l + '</div></div>'; }
  function stat(v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  /* ---------- PLAN / checklist ---------- */
  function viewPlan() {
    var tasks = recs('task');
    var done = tasks.filter(function (t) { return t.done; });
    var pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0;
    tasks.sort(function (a, b) { return (a.done - b.done) || (a.t - b.t); });

    var head = '<div class="sec-h"><span class="star"></span><h2>The Checklist</h2><span class="right">' + done.length + ' / ' + tasks.length + '</span></div>';
    var prog = '<div class="card"><div class="kv"><span class="lbl">Getting there…</span><span class="num" style="font-size:18px;color:var(--amber)">' + pct + '%</span></div><div class="bar teal" style="margin-top:10px"><i style="width:' + pct + '%"></i></div></div>';
    var list = '<div class="card">' + (tasks.length ? tasks.map(function (t) {
      return '<div class="item' + (t.done ? ' done' : '') + '">' +
        '<div class="box' + (t.done ? ' on' : '') + '" data-act="toggle-task" data-id="' + t.id + '">' + (t.done ? '✓' : '') + '</div>' +
        '<div class="it-body"><div class="it-t">' + esc(t.title) + '</div></div>' +
        '<button class="x" data-act="del-rec" data-id="' + t.id + '">×</button></div>';
    }).join('') : '<div class="empty">No tasks yet — add the first thing on your list.</div>') + '</div>';
    var add = '<button class="btn btn-go" data-act="add-task"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>Add a task</button>';
    return head + prog + list + add;
  }

  /* ---------- MONEY ---------- */
  var CAT_ICON = 'M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 7l2-4h14l2 4M9 11a3 3 0 0 0 6 0';
  function viewMoney() {
    var ex = recs('expense').sort(function (a, b) { return b.t - a.t; });
    var goal = Number(get('goal', 0)), saved = Number(get('saved', 0));
    var spent = ex.reduce(function (s, e) { return s + (Number(e.amt) || 0); }, 0);

    var head = '<div class="sec-h"><span class="star"></span><h2>Moving Fund</h2><span class="right">CAD</span></div>';

    // spend by category
    var tot = {}; ex.forEach(function (e) { var c = e.cat || 'Other'; tot[c] = (tot[c] || 0) + (Number(e.amt) || 0); });
    var cats = Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a]; });
    var grand = cats.reduce(function (s, c) { return s + tot[c]; }, 0);

    var goals = '<div class="card"><div class="card-h"><h3>Savings goal</h3></div>' +
      '<div class="kv"><span class="lbl">Saved</span><span class="num tap" data-act="edit-saved">' + money(saved) + '</span></div>' +
      '<div class="bar" style="margin:11px 0"><i style="width:' + (goal > 0 ? Math.min(100, Math.round(saved / goal * 100)) : 0) + '%"></i></div>' +
      '<div class="kv"><span class="lbl">Goal</span><span class="num tap" data-act="edit-goal" style="font-size:16px;color:var(--mut)">' + (goal > 0 ? money(goal) : 'tap to set') + '</span></div></div>';

    var breakdown = '<div class="card"><div class="card-h"><h3>By category</h3><span class="right muted" style="font-size:12px">' + money(grand) + ' total</span></div>' +
      (cats.length ? cats.map(function (c, i) {
        var pct = grand > 0 ? Math.round(tot[c] / grand * 100) : 0;
        return '<div style="padding:10px 0' + (i ? ';border-top:1px solid var(--line)' : '') + '">' +
          '<div class="kv" style="margin-bottom:7px"><span style="font-size:13.5px;font-weight:600">' + esc(c) + '</span><span class="rec-amt" style="font-size:14px">' + money(tot[c]) + ' <span class="muted" style="font-weight:600;font-size:11px">' + pct + '%</span></span></div>' +
          '<div class="bar" style="height:6px"><i style="width:' + pct + '%"></i></div></div>';
      }).join('') : '<div class="empty">Add expenses to see the breakdown.</div>') + '</div>';

    var list = '<div class="card"><div class="card-h"><h3>Expenses</h3><span class="right muted" style="font-size:12px">' + money(spent) + '</span></div>' +
      (ex.length ? ex.map(function (e) {
        return '<div class="rec"><div class="rec-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + CAT_ICON + '"></path></svg></div>' +
          '<div class="rec-main"><div class="rec-t">' + esc(e.label) + '</div><div class="rec-sub">' + esc(e.cat || 'Other') + ' · ' + (e.by || 'Joint') + '</div></div>' +
          '<div class="rec-amt">' + money(e.amt) + '</div>' +
          '<button class="x" data-act="del-rec" data-id="' + e.id + '">×</button></div>';
      }).join('') : '<div class="empty">No expenses logged yet.</div>') + '</div>';

    var add = '<button class="btn btn-go" data-act="add-expense"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>Add an expense</button>';
    return head + goals + breakdown + list + add;
  }

  /* ---------- TRIPS / adventures ---------- */
  var ADV_IDEAS = ['Banff National Park', 'Lake Louise', 'Moraine Lake', 'Calgary Stampede', 'Hike in the Rockies', 'Drive to Jasper', 'Calgary Tower', 'Try poutine', 'Peyto Lake', 'Banff Hot Springs'];
  function viewTrips() {
    var advs = recs('adventure');
    var have = {}; advs.forEach(function (a) { have[a.title] = true; });
    var done = advs.filter(function (a) { return a.done; });
    advs.sort(function (a, b) { return (a.done - b.done) || (a.t - b.t); });

    var head = '<div class="sec-h"><span class="star"></span><h2>Calgary Bucket List</h2><span class="right">' + done.length + ' / ' + advs.length + '</span></div>';
    var hero = '<div class="card adv-hero"><div class="adv-sun"></div><h3>Big skies, bigger mountains</h3><p>The Rockies are practically your back garden now. Tick these off together — or add your own.</p></div>';

    var list = '<div class="card">' + (advs.length ? advs.map(function (a) {
      return '<div class="item' + (a.done ? ' done' : '') + '">' +
        '<div class="box' + (a.done ? ' on' : '') + '" data-act="toggle-adv" data-id="' + a.id + '">' + (a.done ? '✓' : '') + '</div>' +
        '<div class="it-body"><div class="it-t">' + esc(a.title) + '</div></div>' +
        '<button class="x" data-act="del-rec" data-id="' + a.id + '">×</button></div>';
    }).join('') : '<div class="empty">Add somewhere you want to explore.</div>') + '</div>';

    var ideas = ADV_IDEAS.filter(function (t) { return !have[t]; });
    var suggest = ideas.length ? '<div class="card"><div class="card-h"><h3>Ideas — tap to add</h3></div><div class="chips">' +
      ideas.map(function (t) { return '<button class="chip" data-act="quick-adv" data-title="' + esc(t) + '"><span class="plus">+</span>' + esc(t) + '</button>'; }).join('') + '</div></div>' : '';

    var add = '<button class="btn btn-ghost" data-act="add-adv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>Add your own</button>';
    return head + hero + list + suggest + add;
  }

  /* ============================================================
     MODALS
     ============================================================ */
  function openModal(title, body) {
    $('#modal-root').innerHTML = '<div class="modal" data-act="backdrop"><div class="modal-card">' +
      '<div class="modal-h"><h3>' + title + '</h3><button class="close" data-act="close">×</button></div>' + body + '</div></div>';
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  function segHtml(name, opts, cur) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o + '" class="' + (o === cur ? 'on' : '') + '" onclick="(function(b){var p=b.parentNode;[].forEach.call(p.children,function(c){c.className=\'\'});b.className=\'on\';})(this)">' + o + '</button>';
    }).join('') + '</div>';
  }
  function segVal(name) { var on = document.querySelector('[data-seg="' + name + '"] .on'); return on ? on.getAttribute('data-v') : null; }

  function modalTask() {
    openModal('Add a task',
      '<div class="field"><label class="flab">What needs doing?</label><input id="m-title" placeholder="e.g. Set up a Canadian bank account" autocomplete="off"></div>' +
      '<button class="btn btn-go" data-act="save-task">Add task</button>');
    setTimeout(function () { var i = $('#m-title'); if (i) i.focus(); }, 60);
  }
  function modalExpense() {
    openModal('Add an expense',
      '<div class="row2"><div class="field"><label class="flab">What for?</label><input id="m-label" placeholder="e.g. Deposit" autocomplete="off"></div>' +
      '<div class="field" style="max-width:130px"><label class="flab">Amount (CAD)</label><input id="m-amt" type="number" inputmode="decimal" placeholder="0"></div></div>' +
      '<div class="field"><label class="flab">Category</label><select id="m-cat">' + CATS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="flab">Who paid?</label>' + segHtml('by', ['Jason', 'Ciara', 'Joint'], prefs.me || 'Joint') + '</div>' +
      '<button class="btn btn-go" data-act="save-expense">Add expense</button>');
    setTimeout(function () { var i = $('#m-label'); if (i) i.focus(); }, 60);
  }
  function modalAdv() {
    openModal('Add an adventure',
      '<div class="field"><label class="flab">Where to?</label><input id="m-adv" placeholder="e.g. Drive the Icefields Parkway" autocomplete="off"></div>' +
      '<button class="btn btn-go" data-act="save-adv">Add to bucket list</button>');
    setTimeout(function () { var i = $('#m-adv'); if (i) i.focus(); }, 60);
  }
  function modalNumber(title, label, key) {
    openModal(title,
      '<div class="field"><label class="flab">' + label + ' (CAD)</label><input id="m-num" type="number" inputmode="decimal" value="' + (Number(get(key, 0)) || '') + '" placeholder="0"></div>' +
      '<button class="btn btn-go" data-act="save-num" data-key="' + key + '">Save</button>');
    setTimeout(function () { var i = $('#m-num'); if (i) { i.focus(); i.select(); } }, 60);
  }

  function modalSettings() {
    var mv = get('moveDate', MOVE_DEFAULT);
    openModal('Settings',
      '<div class="field"><label class="flab">Who\'s using this phone?</label>' + segHtml('me', ['Jason', 'Ciara'], prefs.me || 'Jason') + '</div>' +
      '<div class="field"><label class="flab">Move date &amp; time</label><input id="s-move" type="datetime-local" value="' + esc(mv) + '"></div>' +
      '<div style="height:6px"></div>' +
      '<div class="sec-h" style="margin:6px 2px 10px"><span class="star"></span><h2>Sharing</h2></div>' +
      '<div class="note">Paste your Cloudflare worker address below on <b>both</b> phones, using the <b>same share code</b>, and your plan stays in sync. Until then it just saves on this phone.</div>' +
      '<div class="field"><label class="flab">Worker URL</label><input id="s-url" placeholder="https://ourjourney-data.NAME.workers.dev" value="' + esc(prefs.workerUrl) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="field"><label class="flab">Share code</label><input id="s-room" value="' + esc(prefs.room || ROOM_DEFAULT) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<button class="btn btn-ghost" data-act="test-conn">Test connection</button>' +
      '<div class="test-out muted" id="s-test"></div>' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-go" data-act="save-settings">Save settings</button>');
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-tab],[data-act]');
    if (!t) return;
    var tabId = t.getAttribute('data-tab');
    if (tabId) { tab = tabId; render(); window.scrollTo(0, 0); return; }
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');

    switch (act) {
      case 'settings': modalSettings(); break;
      case 'backdrop': if (ev.target === t) closeModal(); break;
      case 'close': closeModal(); break;

      case 'toggle-task': { var r = state.records[id]; if (r) patch(id, { done: !r.done }); break; }
      case 'toggle-adv': { var a = state.records[id]; if (a) patch(id, { done: !a.done }); break; }
      case 'del-rec': del(id); break;

      case 'add-task': modalTask(); break;
      case 'save-task': {
        var title = ($('#m-title').value || '').trim(); if (!title) { $('#m-title').focus(); return; }
        put({ kind: 'task', title: title, done: false });
        closeModal(); toast('Task added'); break;
      }
      case 'add-expense': modalExpense(); break;
      case 'save-expense': {
        var label = ($('#m-label').value || '').trim(); var amt = parseFloat($('#m-amt').value);
        if (!label) { $('#m-label').focus(); return; }
        if (isNaN(amt) || amt < 0) { $('#m-amt').focus(); return; }
        put({ kind: 'expense', label: label, amt: amt, cat: $('#m-cat').value, by: segVal('by') || 'Joint' });
        closeModal(); toast('Expense added'); break;
      }
      case 'add-adv': modalAdv(); break;
      case 'save-adv': {
        var av = ($('#m-adv').value || '').trim(); if (!av) { $('#m-adv').focus(); return; }
        put({ kind: 'adventure', title: av, done: false }); closeModal(); toast('Added to bucket list'); break;
      }
      case 'quick-adv': put({ kind: 'adventure', title: t.getAttribute('data-title'), done: false }); toast('Added'); break;

      case 'edit-saved': modalNumber('Money saved', 'How much saved so far', 'saved'); break;
      case 'edit-goal': modalNumber('Savings goal', 'Target amount', 'goal'); break;
      case 'save-num': { var v = parseFloat($('#m-num').value); set(t.getAttribute('data-key'), isNaN(v) ? 0 : v); closeModal(); break; }

      case 'test-conn': testConn(); break;
      case 'save-settings': saveSettings(); break;
    }
  });

  function saveSettings() {
    var me = segVal('me'); if (me) prefs.me = me;
    prefs.workerUrl = ($('#s-url').value || '').trim();
    prefs.room = ($('#s-room').value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '') || ROOM_DEFAULT;
    savePrefs();
    var mv = ($('#s-move').value || '').trim(); if (mv) set('moveDate', mv);
    closeModal(); startSync(); render(); toast(prefs.workerUrl ? 'Sharing on — syncing…' : 'Saved');
  }
  function testConn() {
    var url = ($('#s-url').value || '').trim(); var out = $('#s-test');
    if (!url) { out.textContent = 'Paste your worker URL first.'; out.style.color = 'var(--rose)'; return; }
    out.textContent = 'Checking…'; out.style.color = 'var(--mut)';
    fetch(url.replace(/\/+$/, '') + '/', { method: 'GET' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.store) { out.textContent = '✓ Connected and storage is ready.'; out.style.color = 'var(--teal)'; }
      else if (d && d.ok && !d.store) { out.textContent = '⚠ Worker is up, but KV isn\'t bound as DATA yet.'; out.style.color = 'var(--amber)'; }
      else { out.textContent = '⚠ Reached it, but unexpected reply.'; out.style.color = 'var(--amber)'; }
    }).catch(function () { out.textContent = '✗ Couldn\'t reach that URL. Check the address.'; out.style.color = 'var(--rose)'; });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) { var el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900); }

  /* ============================================================
     SEED + BOOT
     ============================================================ */
  function seed() {
    if (get('seeded')) return;
    var T = 1; // tiny timestamp so any real edit/delete always wins (idempotent across phones)
    function sTask(idk, title, who) { if (!state.records['st-' + idk]) state.records['st-' + idk] = { id: 'st-' + idk, kind: 'task', title: title, who: who, done: false, t: T }; }
    function sAdv(idk, title) { if (!state.records['sa-' + idk]) state.records['sa-' + idk] = { id: 'sa-' + idk, kind: 'adventure', title: title, done: false, t: T }; }
    sTask('visa', 'Confirm visas / work permits', 'Both');
    sTask('accom', 'Sort accommodation in Calgary', 'Jason');
    sTask('bank', 'Open a Canadian bank account', 'Ciara');
    sTask('phone', 'Sort Canadian phone plans', 'Jason');
    sTask('landlord', 'Give notice to Dublin landlord', 'Ciara');
    sTask('insurance', 'Get travel & health insurance', 'Both');
    sTask('pack', 'Pack & decide what ships vs sells', 'Both');
    sAdv('banff', 'Banff National Park');
    sAdv('louise', 'Lake Louise');
    sAdv('stampede', 'Calgary Stampede');
    sAdv('hike', 'First hike in the Rockies');
    if (state.scalars.goal === undefined) state.scalars.goal = { v: 15000, t: T };
    state.scalars.seeded = { v: true, t: now() };
    saveState();
  }

  function boot() {
    state = loadState();
    prefs = loadPrefs();
    seed();
    render();
    startSync();
    setInterval(tickCountdown, 1000);
    if (!prefs.me) setTimeout(askWho, 400);
  }

  function askWho() {
    var ov = document.createElement('div');
    ov.className = 'who';
    ov.innerHTML = '<div class="who-card"><div class="who-sun"></div>' +
      '<h2>Howdy! Who\'s this?</h2><p>So we know whose tasks and spending are whose. You can change it later in Settings.</p>' +
      '<div class="who-btns"><button class="btn btn-go" data-who="Jason">Jason</button><button class="btn btn-ghost" data-who="Ciara">Ciara</button></div></div>';
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-who]'); if (!b) return;
      prefs.me = b.getAttribute('data-who'); savePrefs(); ov.remove(); render();
    });
    document.body.appendChild(ov);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
