// 红尖（红A）规则引擎：只处理牌局状态，不碰画面和数据库
// 一副牌 54 张：0–51 为 ♠♥♣♦ 各 13 张（2…A），52 小王，53 大王
const H = (() => {
  const SUITS = ['S', 'H', 'C', 'D'];
  const SUIT_CH = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };
  const HEART3 = 14; // ♥3：第一局拿到它的人先出
  const RED_A = [25, 51]; // ♥A、♦A
  const TRIB_SECS = 15;
  const TURN_SECS = 40;
  const TARGET = 11;
  const POS = ['头游', '二游', '三游', '末游'];
  const VN = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };

  const E = (code) => { const e = new Error(code); e.code = code; return e; };
  function card(id) {
    if (id === 52) return { id, r: 16, s: 'J' };
    if (id === 53) return { id, r: 17, s: 'J' };
    return { id, s: SUITS[Math.floor(id / 13)], r: (id % 13) + 2 };
  }
  // 大小：3 … K、A(14)、2(15)、小王(16)、大王(17)
  const val = (r) => (r === 2 ? 15 : r);
  const cv = (id) => val(card(id).r);
  const isA = (id) => id < 52 && id % 13 === 12;
  const isRedA = (id) => id === 25 || id === 51;
  const vname = (v) => (v <= 10 ? String(v) : VN[v]);
  const cardName = (id) => { const c = card(id); return c.s === 'J' ? VN[c.r] : SUIT_CH[c.s] + vname(val(c.r)); };

  function sortHand(ids) {
    return ids.slice().sort((a, b) => cv(b) - cv(a) || SUITS.indexOf(card(a).s) - SUITS.indexOf(card(b).s) || a - b);
  }

  // ---------- 牌型识别（斗地主） ----------
  // 返回这手牌所有可能的牌型，每种牌型保留最大的解释
  function analyze(ids) {
    const n = ids.length;
    if (!n || new Set(ids).size !== n) return [];
    const cnt = {};
    for (const id of ids) { const v = cv(id); cnt[v] = (cnt[v] || 0) + 1; }
    const vs = Object.keys(cnt).map(Number).sort((a, b) => a - b);
    const out = {};
    const add = (type, key, bomb) => { if (!out[type] || key > out[type].key) out[type] = { type, key, n, bomb: bomb || 0 }; };
    const rest = (take) => { const r = Object.assign({}, cnt); for (const [v, k] of take) { r[v] -= k; if (!r[v]) delete r[v]; } return r; };
    const hasRocket = (c) => !!c[16] && !!c[17];
    const allPairs = (c) => Object.keys(c).every((v) => +v < 16 && c[v] % 2 === 0);
    // 连续：每个点数都在 3…A 之间，并且一个挨一个
    const consecutive = (list) => list.length > 0 && list[0] >= 3 && list[list.length - 1] <= 14 && list.every((v, i) => i === 0 || v === list[i - 1] + 1);

    if (n === 2 && cnt[16] === 1 && cnt[17] === 1) add('rocket', 100, 2);
    if (vs.length === 1) {
      const v = vs[0];
      if (n === 1) add('single', v);
      else if (v < 16) {
        if (n === 2) add('pair', v);
        else if (n === 3) add('triple', v);
        else if (n === 4) add('bomb', v, 1);
      }
    }
    for (const v of vs) {
      if (v >= 16) continue;
      if (cnt[v] >= 3) {
        const r = rest([[v, 3]]);
        if (n === 4 && !r[v]) add('t1', v);
        if (n === 5 && !r[v] && Object.keys(r).length === 1 && allPairs(r)) add('t2', v);
      }
      if (cnt[v] === 4) {
        const r = rest([[v, 4]]);
        if (n === 6 && !hasRocket(r)) add('f2', v);
        if (n === 8 && allPairs(r)) add('f22', v);
      }
    }
    if (n >= 5 && vs.every((v) => cnt[v] === 1) && consecutive(vs)) add('straight', vs[vs.length - 1]);
    if (n >= 6 && vs.length >= 3 && vs.every((v) => cnt[v] === 2) && consecutive(vs)) add('pairs', vs[vs.length - 1]);
    if (n >= 6 && vs.length >= 2 && vs.every((v) => cnt[v] === 3) && consecutive(vs)) add('plane', vs[vs.length - 1]);
    // 飞机带翅膀：k 个连续三张，带 k 张单牌或 k 对
    for (const [per, type] of [[4, 'plane1'], [5, 'plane2']]) {
      if (n % per) continue;
      const k = n / per;
      if (k < 2) continue;
      for (let s = 3; s + k - 1 <= 14; s++) {
        let ok = true;
        for (let v = s; v < s + k; v++) if ((cnt[v] || 0) < 3) { ok = false; break; }
        if (!ok) continue;
        const take = [];
        for (let v = s; v < s + k; v++) take.push([v, 3]);
        const r = rest(take);
        if (type === 'plane1' && hasRocket(r)) continue;
        if (type === 'plane2' && !allPairs(r)) continue;
        add(type, s + k - 1);
      }
    }
    return Object.values(out);
  }

  // 王炸最大；炸弹管一切非炸弹，炸弹之间比点数；其他牌型必须同类型、同张数，比大小
  function beats(p, q) {
    if (!q) return true;
    if (p.type === 'rocket') return true;
    if (q.type === 'rocket') return false;
    if (p.bomb && !q.bomb) return true;
    if (!p.bomb && q.bomb) return false;
    return p.type === q.type && p.n === q.n && p.key > q.key;
  }

  // ---------- 房间状态 ----------
  function fresh() {
    return { v: 0, game: 'hongjian', phase: 'lobby', seats: [null, null, null, null], scores: [0, 0, 0, 0], round: 0, g: null, prev: null, votes: [], log: [], winner: null, ready: [] };
  }
  function log(st, k, p) { st.log.push(Object.assign({ k }, p || {})); if (st.log.length > 40) st.log.splice(0, st.log.length - 40); }
  const seatOf = (st, uid) => st.seats.indexOf(uid);
  function needSeat(st, uid) { const s = seatOf(st, uid); if (s < 0) throw E('notSeated'); return s; }
  const now = (st) => st._now || Date.now();
  const stamp = (st) => { if (st.g && st.phase === 'play' && st.g.turn >= 0) st.g.turnAt = now(st); };
  const notPaused = (st) => { if (st.paused) throw E('paused'); };
  const nextActive = (g, s) => { for (let k = 1; k <= 4; k++) { const t = (s + k) % 4; if (!g.done.includes(t)) return t; } return -1; };

  function sit(st, uid, i) {
    if (st.phase !== 'lobby') throw E('inGameNoSwap');
    if (st.seats[i] && st.seats[i] !== uid) throw E('seatTaken');
    if (st.seats[i] === uid) return st;
    const c = seatOf(st, uid);
    if (c >= 0) st.seats[c] = null;
    st.seats[i] = uid;
    st.ready = (st.ready || []).filter((x) => x !== uid);
    return st;
  }
  function leave(st, uid) {
    if (st.phase !== 'lobby') throw E('inGameNoLeave');
    const c = seatOf(st, uid);
    if (c >= 0) st.seats[c] = null;
    st.ready = (st.ready || []).filter((x) => x !== uid);
    return st;
  }
  function start(st, uid, rng) {
    if (st.phase !== 'lobby') throw E('started');
    if (st.seats.some((s) => !s)) throw E('needFour');
    needSeat(st, uid);
    Object.assign(st, { scores: [0, 0, 0, 0], round: 0, winner: null, votes: [], prev: null, log: [] });
    log(st, 'start');
    deal(st, rng);
    return st;
  }
  function shuffle(rng) {
    const a = [...Array(54).keys()];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // 发牌：从 s0 开始，s0 和他的下家各 14 张，另外两人各 13 张
  function deal(st, rng, preset) {
    st.round++;
    const first = st.round === 1;
    const s0 = first ? Math.floor(rng() * 4) : st.prev.order[0];
    const d = preset || shuffle(rng);
    const hands = [[], [], [], []];
    let p = 0;
    for (let k = 0; k < 4; k++) { const s = (s0 + k) % 4, size = k < 2 ? 14 : 13; hands[s] = d.slice(p, p + size); p += size; }
    const red = [...new Set(RED_A.map((id) => hands.findIndex((h) => h.includes(id))))].sort();
    const g = { hands, red, solo: red.length === 1 ? red[0] : -1, s0, turn: -1, last: null, passes: 0, trick: {}, done: [], trib: null, turnAt: 0 };
    st.g = g;
    st.votes = [];
    st.ready = [];
    if (first) {
      st.phase = 'play';
      g.turn = hands.findIndex((h) => h.includes(HEART3));
      stamp(st);
      log(st, 'first', { s: g.turn });
      return;
    }
    log(st, 'round', { r: st.round, s: s0 });
    startTribute(st);
  }

  // ---------- 进贡、挑牌、还贡 ----------
  // 输家每人贡 max(1, 赢家人数/输家人数) 张；赢家每人还 max(1, 输家人数/赢家人数) 张
  // 收牌的一方只有一个人时直接全收；有多人时，15 秒内各自挑一张，冲突按上一局走牌顺序
  function prio(st, s) { return st.prev.order.indexOf(s); }
  function startTribute(st) {
    const g = st.g, pv = st.prev;
    const W = pv.winners, L = pv.losers;
    g.trib = {
      step: 'give', at: now(st),
      gc: Math.max(1, W.length / L.length), rc: Math.max(1, L.length / W.length),
      givers: L.slice(), gives: {}, pool: [], pickers: [], want: {}, ok: {}, got: {}, rets: {}, retPool: [], retGot: {},
    };
    st.phase = 'tribute';
    g.turn = -1;
    // 最大的牌没有可挑的余地时，自动进贡
    for (const s of L) { const c = forcedTop(g.hands[s], g.trib.gc); if (c) doGive(st, s, c); }
    advance(st);
  }
  // 手里除 A 以外最大的 c 张：返回 { need: 必须交的牌, pick: 还需从 tie 里挑几张, tie: 一样大可任选的牌 }
  function topInfo(hand, c) {
    const cand = sortHand(hand.filter((id) => !isA(id)));
    const t = cv(cand[c - 1]);
    const need = cand.filter((id) => cv(id) > t);
    const tie = cand.filter((id) => cv(id) === t);
    return { need, tie, pick: c - need.length, t };
  }
  function forcedTop(hand, c) {
    const i = topInfo(hand, c);
    return i.tie.length === i.pick ? i.need.concat(i.tie) : null;
  }
  function validTop(hand, c, ids) {
    if (ids.length !== c || new Set(ids).size !== c || !ids.every((id) => hand.includes(id) && !isA(id))) return false;
    const i = topInfo(hand, c);
    return i.need.every((id) => ids.includes(id)) && ids.filter((id) => i.tie.includes(id)).length === i.pick;
  }
  function doGive(st, s, ids) {
    const g = st.g, h = g.hands[s];
    for (const id of ids) h.splice(h.indexOf(id), 1);
    g.trib.gives[s] = ids.slice();
    log(st, 'give', { s, cards: ids });
  }
  function doRet(st, s, ids) {
    const g = st.g, h = g.hands[s];
    for (const id of ids) h.splice(h.indexOf(id), 1);
    g.trib.rets[s] = ids.slice();
    log(st, 'ret', { s, cards: ids });
  }
  // 按挑牌意向分配：按优先顺序，想要的还在就给他；剩下没分到的人按顺序拿剩下的牌里最大的
  function resolvePick(st, pool, pickers, want) {
    const order = pickers.slice().sort((a, b) => prio(st, a) - prio(st, b));
    const avail = pool.slice(), got = {};
    for (const s of order) { const w = want[s]; if (w != null && avail.includes(w)) { got[s] = w; avail.splice(avail.indexOf(w), 1); } }
    for (const s of order) if (got[s] == null) { const id = sortHand(avail)[0]; got[s] = id; avail.splice(avail.indexOf(id), 1); }
    return got;
  }
  // 根据当前进度推进到下一步
  function advance(st) {
    const g = st.g, t = g.trib, pv = st.prev;
    const W = pv.winners, L = pv.losers;
    if (t.step === 'give' && L.every((s) => t.gives[s])) {
      t.pool = L.flatMap((s) => t.gives[s]);
      if (W.length === 1) {
        g.hands[W[0]].push(...t.pool);
        log(st, 'takeAll', { s: W[0], cards: t.pool });
        toRet(st);
      } else {
        Object.assign(t, { step: 'pick', at: now(st), pickers: W.slice(), want: {}, ok: {} });
      }
    }
    if (t.step === 'pick' && t.pickers.every((s) => t.ok[s])) finishPick(st);
    if (t.step === 'ret' && W.every((s) => t.rets[s])) {
      t.retPool = W.flatMap((s) => t.rets[s]);
      if (L.length === 1) {
        g.hands[L[0]].push(...t.retPool);
        log(st, 'takeAllRet', { s: L[0], cards: t.retPool });
        toPlay(st);
      } else {
        Object.assign(t, { step: 'pickRet', at: now(st), pickers: L.slice(), want: {}, ok: {} });
      }
    }
    if (t.step === 'pickRet' && t.pickers.every((s) => t.ok[s])) finishPick(st);
  }
  function finishPick(st) {
    const g = st.g, t = g.trib;
    const ret = t.step === 'pickRet';
    const got = resolvePick(st, ret ? t.retPool : t.pool, t.pickers, t.want);
    for (const s of t.pickers) { g.hands[s].push(got[s]); log(st, ret ? 'gotRet' : 'got', { s, card: got[s] }); }
    if (ret) { t.retGot = got; toPlay(st); } else { t.got = got; toRet(st); }
  }
  function toRet(st) {
    const t = st.g.trib;
    Object.assign(t, { step: 'ret', at: now(st), pickers: [], want: {}, ok: {} });
  }
  function toPlay(st) {
    const g = st.g;
    g.trib.step = 'done';
    st.phase = 'play';
    g.turn = st.prev.order[0];
    stamp(st);
    log(st, 'lead', { s: g.turn });
  }
  function giveTribute(st, uid, ids) {
    if (st.phase !== 'tribute' || st.g.trib.step !== 'give') throw E('notTribute');
    notPaused(st);
    const s = needSeat(st, uid), g = st.g, t = g.trib;
    if (!t.givers.includes(s) || t.gives[s]) throw E('noTributeNeeded');
    if (!validTop(g.hands[s], t.gc, ids)) throw E(t.gc > 1 ? 'mustBeTop3' : 'mustBeMax');
    doGive(st, s, ids);
    advance(st);
    return st;
  }
  function giveBack(st, uid, ids) {
    if (st.phase !== 'tribute' || st.g.trib.step !== 'ret') throw E('notReturn');
    notPaused(st);
    const s = needSeat(st, uid), g = st.g, t = g.trib;
    if (!st.prev.winners.includes(s) || t.rets[s]) throw E('noReturnYet');
    const h = g.hands[s];
    if (ids.length !== t.rc || new Set(ids).size !== ids.length || !ids.every((id) => h.includes(id))) throw E('retCount');
    if (ids.some(isA)) throw E('noAce');
    doRet(st, s, ids);
    advance(st);
    return st;
  }
  // 挑牌：选想要的牌（可以改），点确定；所有人确定或 15 秒到了就分配
  function wantCard(st, uid, id, confirm) {
    const t = st.g && st.g.trib;
    if (st.phase !== 'tribute' || !t || (t.step !== 'pick' && t.step !== 'pickRet')) throw E('notPicking');
    notPaused(st);
    const s = needSeat(st, uid);
    if (!t.pickers.includes(s)) throw E('notPicker');
    const pool = t.step === 'pick' ? t.pool : t.retPool;
    if (id != null) { if (!pool.includes(id)) throw E('notInPool'); t.want[s] = id; t.ok[s] = false; }
    if (confirm) { if (t.want[s] == null) throw E('pickFirst'); t.ok[s] = true; }
    advance(st);
    return st;
  }
  // 15 秒到时：没进贡的自动贡最大的；没还贡的自动还最小的；挑牌直接按规则分配
  function tribTimeout(st, at) {
    const g = st.g, t = g && g.trib;
    if (st.phase !== 'tribute' || st.paused || !t || t.at !== at) return null;
    if (t.step === 'give') {
      for (const s of t.givers) if (!t.gives[s]) { const i = topInfo(g.hands[s], t.gc); doGive(st, s, i.need.concat(i.tie.slice(0, i.pick))); log(st, 'autoGive', { s }); }
    } else if (t.step === 'ret') {
      for (const s of st.prev.winners) if (!t.rets[s]) { const c = sortHand(g.hands[s].filter((id) => !isA(id))).reverse().slice(0, t.rc); doRet(st, s, c); log(st, 'autoRet', { s }); }
    } else if (t.step === 'pick' || t.step === 'pickRet') {
      for (const s of t.pickers) t.ok[s] = true;
    }
    advance(st);
    return st;
  }

  // ---------- 出牌 ----------
  function options(st, ids) { return analyze(ids).filter((p) => beats(p, st.g.last)); }
  function play(st, uid, ids, type) {
    if (st.phase !== 'play') throw E('cantPlay');
    notPaused(st);
    const g = st.g, s = needSeat(st, uid);
    if (s !== g.turn) throw E('notYourTurn');
    const h = g.hands[s];
    if (!ids.length || new Set(ids).size !== ids.length || !ids.every((i) => h.includes(i))) throw E('playNotInHand');
    let opts = options(st, ids);
    if (type) opts = opts.filter((o) => o.type === type);
    if (!opts.length) throw E(g.last ? 'cantBeat' : 'invalidType');
    const p = opts[0];
    for (const i of ids) h.splice(h.indexOf(i), 1);
    if (!g.last) g.trick = {};
    const sorted = sortHand(ids);
    g.last = { seat: s, ids: sorted, type: p.type, key: p.key, n: p.n, bomb: p.bomb };
    g.passes = 0;
    g.trick[s] = { ids: sorted, type: p.type, key: p.key, n: p.n, at: now(st) };
    st.ev = { k: (st.ev ? st.ev.k : 0) + 1, seat: s, kind: 'play', ids: sorted, type: p.type, key: p.key, fin: h.length ? -1 : g.done.length };
    if (!h.length) {
      g.done.push(s);
      log(st, 'out', { s, pos: g.done.length - 1 });
      if (checkEnd(st)) return st;
    }
    g.turn = nextActive(g, s);
    stamp(st);
    return st;
  }
  function pass(st, uid) {
    if (st.phase !== 'play') throw E('cantAct');
    notPaused(st);
    const g = st.g, s = needSeat(st, uid);
    if (s !== g.turn) throw E('notYourTurn');
    if (!g.last) throw E('mustLead');
    g.passes++;
    g.trick[s] = { pass: true };
    st.ev = { k: (st.ev ? st.ev.k : 0) + 1, seat: s, kind: 'pass' };
    const resp = [0, 1, 2, 3].filter((x) => !g.done.includes(x) && x !== g.last.seat).length;
    if (g.passes >= resp) {
      const ls = g.last.seat;
      // 出牌的人还在：他接着出；他已经走完：由他的下家出
      const lead = g.done.includes(ls) ? nextActive(g, ls) : ls;
      if (g.done.includes(ls)) log(st, 'nextLead', { s: lead });
      g.last = null;
      g.passes = 0;
      g.turn = lead;
    } else g.turn = nextActive(g, s);
    stamp(st);
    return st;
  }
  // 出牌超时：跟牌自动“不出”；先出时自动出最小的一张单牌
  function timeout(st, at) {
    const g = st.g;
    if (st.phase !== 'play' || st.paused || !g || g.turnAt !== at || g.turn < 0) return null;
    const s = g.turn, u = st.seats[s];
    if (g.last) { log(st, 'autoPass', { s }); pass(st, u); }
    else {
      const h = sortHand(g.hands[s]), id = h[h.length - 1];
      log(st, 'autoPlay', { s, card: id });
      play(st, u, [id], 'single');
    }
    if (st.ev) st.ev.auto = true;
    return st;
  }
  function pause(st, uid) {
    const s = needSeat(st, uid);
    if (st.phase !== 'play' && st.phase !== 'tribute') throw E('cantPause');
    if (st.paused) return null;
    st.paused = { s, at: now(st) };
    log(st, 'paused', { s });
    return st;
  }
  function resume(st, uid) {
    const s = needSeat(st, uid);
    if (!st.paused) return null;
    const d = Math.max(0, now(st) - st.paused.at);
    if (st.g && st.g.turnAt) st.g.turnAt += d;
    if (st.g && st.g.trib && st.g.trib.at) st.g.trib.at += d;
    st.paused = null;
    log(st, 'resumed', { s });
    return st;
  }

  // ---------- 一局结束、计分 ----------
  function checkEnd(st) {
    const g = st.g, d = g.done;
    const R = g.red, N = [0, 1, 2, 3].filter((s) => !R.includes(s));
    let winners = null;
    if (R.every((s) => d.includes(s))) winners = R;
    else if (N.every((s) => d.includes(s))) winners = N;
    if (!winners) return false;
    const losers = [0, 1, 2, 3].filter((s) => !winners.includes(s));
    // 走牌顺序：已走完的按顺序；没走完的从头游开始按座位往下数
    const order = d.slice();
    for (let k = 1; k <= 4; k++) { const s = (d[0] + k) % 4; if (!order.includes(s)) order.push(s); }
    const pts = winners.length === 1 ? 2 : 1;
    for (const s of winners) st.scores[s] += pts;
    const res = { order, winners, losers, red: R.slice(), solo: g.solo, side: winners === R ? 'red' : 'black', pts, notes: [] };
    res.notes.push({ k: 'win', side: res.side, seats: winners, pts });
    const top = Math.max(...st.scores), tops = [0, 1, 2, 3].filter((s) => st.scores[s] === top);
    if (top >= TARGET && tops.length === 1) {
      st.phase = 'matchEnd';
      st.winner = tops[0];
      res.notes.push({ k: 'champ', s: tops[0], n: top });
    } else {
      if (top >= TARGET) res.notes.push({ k: 'tie', seats: tops, n: top });
      st.phase = 'roundEnd';
    }
    res.notes.forEach((m) => st.log.push(m));
    st.prev = res;
    g.turn = -1;
    return true;
  }
  function setReady(st, uid, on, rng) {
    needSeat(st, uid);
    if (st.phase !== 'lobby' && st.phase !== 'roundEnd') throw E('cantReady');
    st.ready = (st.ready || []).filter((x) => x !== uid && st.seats.includes(x));
    if (on) st.ready.push(uid);
    const all = st.seats.every((x) => x && st.ready.includes(x));
    if (all) { if (st.phase === 'lobby') start(st, uid, rng); else deal(st, rng); }
    return st;
  }
  function toLobby(st) {
    Object.assign(st, { phase: 'lobby', g: null, paused: null, ready: [], votes: [], scores: [0, 0, 0, 0], round: 0, winner: null, prev: null });
    log(st, 'reset');
    return st;
  }
  function vote(st, uid, on) {
    const s = needSeat(st, uid);
    if (st.phase === 'lobby') throw E('noResetNeeded');
    if (st.phase === 'matchEnd') return toLobby(st);
    st.votes = st.votes.filter((x) => x !== uid && st.seats.includes(x));
    if (on) { st.votes.push(uid); log(st, 'vote', { s, n: st.votes.length }); }
    else log(st, 'unvote', { s });
    if (st.seats.every((x) => st.votes.includes(x))) toLobby(st);
    return st;
  }

  return {
    card, val, cv, isA, isRedA, vname, cardName, sortHand, analyze, beats, options, fresh, sit, leave, start, deal, setReady, vote, toLobby,
    play, pass, timeout, pause, resume, giveTribute, giveBack, wantCard, tribTimeout, topInfo, validTop,
    HEART3, RED_A, TRIB_SECS, TURN_SECS, TARGET, POS, SUIT_CH,
  };
})();
if (typeof module !== 'undefined') module.exports = H;
