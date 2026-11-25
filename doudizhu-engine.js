// 斗地主规则引擎：只处理牌局状态，不碰画面和数据库
// 一副牌 54 张：0–51 为 ♠♥♣♦ 各 13 张（2…A），52 小王，53 大王
// 3 人：每人 17 张，底牌 3 张；叫地主 / 抢地主（和《欢乐斗地主》一样），之后每人可以选择加倍
const DDZ = (() => {
  const SUITS = ['S', 'H', 'C', 'D'];
  const SUIT_CH = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };
  const N = 3;
  const BASE = 2;          // 底分
  const TURN_SECS = 30;    // 出牌
  const BID_SECS = 15;     // 叫地主 / 抢地主
  const DBL_SECS = 10;     // 加倍
  const REVEAL_MS = 2500;  // 发牌前亮出决定先叫的那张牌
  const KICK_WAIT = 30;    // 一局结束后多少秒还没准备，才能请他离座
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
  const vname = (v) => (v <= 10 ? String(v) : VN[v]);
  const cardName = (id) => { const c = card(id); return c.s === 'J' ? VN[c.r] : SUIT_CH[c.s] + vname(val(c.r)); };

  function sortHand(ids) {
    return ids.slice().sort((a, b) => cv(b) - cv(a) || SUITS.indexOf(card(a).s) - SUITS.indexOf(card(b).s) || a - b);
  }

  // ---------- 牌型识别（和红尖完全一样的斗地主规则） ----------
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
    return { v: 0, game: 'doudizhu', phase: 'lobby', seats: [null, null, null], scores: [0, 0, 0], round: 0, g: null, prev: null, votes: [], log: [], ready: [] };
  }
  // 记录里同时记下当时坐在那个座位上的人的名字（换人以后，旧记录不会变成新人的名字）
  function log(st, k, p) {
    const e = Object.assign({ k }, p || {});
    for (const key of ['s', 't']) {
      const u = e[key] != null && e[key] >= 0 ? st.seats[e[key]] : null;
      if (u && st.names && st.names[u]) e['_' + key] = st.names[u];
    }
    st.log.push(e);
    if (st.log.length > 40) st.log.splice(0, st.log.length - 40);
  }
  const seatOf = (st, uid) => st.seats.indexOf(uid);
  function needSeat(st, uid) { const s = seatOf(st, uid); if (s < 0) throw E('notSeated'); return s; }
  const now = (st) => st._now || Date.now();
  const notPaused = (st) => { if (st.paused) throw E('paused'); };
  const nx = (s) => (s + 1) % N;
  const evPush = (st, o) => { st.ev = Object.assign({ k: (st.ev ? st.ev.k : 0) + 1 }, o); };

  // ---------- 入座 / 离座 / 换人 ----------
  // 选座大厅里随便坐、随便换；开局以后，只有在一局结束（结算）的时候才能离座或坐进空座位。
  // 分数跟着人走：离开的人分数存进“已离开”名单，之后用同一个昵称回来坐下，分数接着算；新来的人从 0 分开始。
  const canSwap = (st) => st.phase === 'lobby' || st.phase === 'roundEnd';
  function sit(st, uid, i, name) {
    if (!canSwap(st)) throw E('inGameNoSwap');
    if (st.seats[i] && st.seats[i] !== uid) throw E('seatTaken');
    if (st.seats[i] === uid) return st;
    const nm = String(name || '').trim();
    if (nm) { st.names = st.names || {}; st.names[uid] = nm; }
    const c = seatOf(st, uid);
    if (st.phase === 'lobby') {
      if (c >= 0) st.seats[c] = null;
      st.seats[i] = uid;
    } else {
      if (c >= 0) throw E('haveSeat');
      st.seats[i] = uid;
      const gone = st.gone || [];
      const k = nm ? gone.findIndex((x) => x.name === nm) : -1;
      st.scores[i] = k >= 0 ? gone[k].pts : 0;
      if (k >= 0) gone.splice(k, 1);
      st.gone = gone;
      st.kicks = {};
      log(st, k >= 0 ? 'back' : 'join', { s: i, n: st.scores[i] });
    }
    st.ready = (st.ready || []).filter((x) => x !== uid);
    return st;
  }
  // 让一个座位空出来：分数存进“已离开”名单
  function vacate(st, s, why) {
    const u = st.seats[s];
    if (!u) return;
    const name = (st.names && st.names[u]) || '';
    log(st, why, { s, n: st.scores[s] });
    st.gone = (st.gone || []).filter((x) => !name || x.name !== name);
    st.gone.push({ name, pts: st.scores[s] });
    if (st.gone.length > 30) st.gone.splice(0, st.gone.length - 30);
    st.seats[s] = null;
    st.scores[s] = 0;
    const drop = (list) => (list || []).filter((x) => x !== u);
    st.ready = drop(st.ready); st.votes = drop(st.votes); st.leaving = drop(st.leaving);
    st.kicks = {};
  }
  function leave(st, uid) {
    if (!canSwap(st)) throw E('inGameNoLeave');
    const c = seatOf(st, uid);
    if (c < 0) return st;
    if (st.phase === 'roundEnd') vacate(st, c, 'left');
    else { st.seats[c] = null; st.ready = (st.ready || []).filter((x) => x !== uid); }
    return st;
  }
  // 对局中点“打完这局就走”：这局照常打，结算时自动离座。一局结束时点就直接离座。
  function leaveLater(st, uid, on) {
    const s = needSeat(st, uid);
    if (canSwap(st)) return on ? leave(st, uid) : st;
    st.leaving = (st.leaving || []).filter((x) => x !== uid);
    if (on) st.leaving.push(uid);
    log(st, on ? 'leaveLater' : 'stayOn', { s });
    return st;
  }
  // 一局结束后，有人没点准备（比如直接关了网页）：其余在座的人都同意，就可以请他离座
  function kick(st, uid, target, on) {
    const s = needSeat(st, uid);
    if (st.phase !== 'roundEnd') throw E('kickOnlyEnd');
    const u = st.seats[target];
    if (!u || target === s) throw E('cantKick');
    if ((st.ready || []).includes(u)) throw E('kickReady');
    // 留 2 秒余量：各人电脑的时钟可能差一点
    if (on && st.prev && st.prev.at && now(st) - st.prev.at < KICK_WAIT * 1000 - 2000) throw E('kickWait');
    st.kicks = st.kicks || {};
    const list = (st.kicks[target] || []).filter((x) => x !== uid && x !== u && st.seats.includes(x));
    if (on) list.push(uid);
    st.kicks[target] = list;
    const others = st.seats.filter((x, i) => x && i !== target);
    if (on) log(st, 'kickVote', { s, t: target, n: list.length, m: others.length });
    if (others.length && others.every((x) => list.includes(x))) vacate(st, target, 'kicked');
    return st;
  }
  function start(st, uid, rng) {
    if (st.phase !== 'lobby') throw E('started');
    if (st.seats.some((s) => !s)) throw E('needThree');
    needSeat(st, uid);
    Object.assign(st, { scores: [0, 0, 0], round: 0, votes: [], prev: null, log: [], gone: [], leaving: [], kicks: {} });
    log(st, 'start');
    deal(st, rng);
    return st;
  }
  function shuffle(rng) {
    const a = [...Array(54).keys()];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // 发牌：每人 17 张，最后 3 张是底牌。
  // 发牌前从要发出去的 51 张里随机抽一张亮给大家看，拿到这张牌的人先叫地主。
  // redo = true：三个人都不叫，重新洗牌发牌，还算同一局
  function deal(st, rng, preset, redo) {
    if (!redo) st.round++;
    const d = preset ? preset.slice() : shuffle(rng);
    const hands = [d.slice(0, 17), d.slice(17, 34), d.slice(34, 51)];
    const bottom = d.slice(51);
    const mi = Math.floor(rng() * 51);
    const mark = d[mi], first = Math.floor(mi / 17);
    const t = now(st);
    st.g = {
      hands, bottom, mark, first, redo: redo ? ((st.g && st.g.redo) || 0) + 1 : 0,
      dealtAt: t, turn: first, turnAt: t + REVEAL_MS,
      bids: [], caller: -1, grabber: -1, grabs: 0, lord: -1,
      dbl: [null, null, null], dblAt: 0,
      last: null, passes: 0, trick: {}, bombs: 0, cnt: [0, 0, 0],
      did: Math.floor(rng() * 1e9).toString(36) + Date.now().toString(36),
    };
    st.phase = 'bid';
    st.votes = [];
    st.ready = [];
    st.kicks = {};
    log(st, redo ? 'redeal' : 'round', { r: st.round, card: mark, s: first });
    return st;
  }

  // ---------- 叫地主 / 抢地主 ----------
  // 从先叫的人开始每人一次：还没人叫时选“叫地主 / 不叫”，有人叫了以后选“抢地主 / 不抢”（不叫过的人不能再抢）。
  // 一圈后如果有人抢过，叫地主的人还有一次抢回来或放弃的机会。最后一个抢的人当地主。每抢一次倍数 ×2。
  function bidOptions(g) {
    if (g.caller < 0) return 'call';
    return 'grab';
  }
  function bid(st, uid, yes) {
    if (st.phase !== 'bid') throw E('notBidding');
    notPaused(st);
    const g = st.g, s = needSeat(st, uid);
    if (s !== g.turn) throw E('notYourTurn');
    return doBid(st, s, !!yes);
  }
  function doBid(st, s, yes, auto) {
    const g = st.g;
    let a;
    if (g.caller < 0) {
      a = yes ? 'call' : 'nocall';
      if (yes) { g.caller = s; g.grabber = s; }
    } else {
      a = yes ? 'grab' : 'nograb';
      if (yes) { g.grabs++; g.grabber = s; }
    }
    g.bids.push({ s, a });
    evPush(st, { seat: s, kind: 'bid', a, auto: !!auto });
    log(st, auto ? 'autoBid' : 'bid', { s, a });
    const n = g.bids.length;
    if (n < N) { g.turn = nx(s); g.turnAt = now(st); return st; }
    if (n === N) {
      if (g.caller < 0) { log(st, 'nobody'); return deal(st, st._rng || Math.random, null, true); }
      const grabbedAfter = g.bids.some((b) => b.a === 'grab');
      if (grabbedAfter) { g.turn = g.caller; g.turnAt = now(st); return st; }
    }
    return finishBid(st);
  }
  function finishBid(st) {
    const g = st.g;
    g.lord = g.grabber;
    g.hands[g.lord].push(...g.bottom);
    g.turn = -1;
    g.turnAt = 0;
    g.dblAt = now(st);
    st.phase = 'double';
    evPush(st, { seat: g.lord, kind: 'lord' });
    log(st, 'lord', { s: g.lord, cards: g.bottom });
    return st;
  }

  // ---------- 加倍（3 人同时选，10 秒） ----------
  function double(st, uid, yes) {
    if (st.phase !== 'double') throw E('notDoubling');
    notPaused(st);
    const g = st.g, s = needSeat(st, uid);
    if (g.dbl[s] != null) throw E('alreadyChose');
    g.dbl[s] = !!yes;
    evPush(st, { seat: s, kind: 'dbl', yes: !!yes });
    if (yes) log(st, 'dbl', { s });
    if (g.dbl.every((x) => x != null)) toPlay(st);
    return st;
  }
  function toPlay(st) {
    const g = st.g;
    st.phase = 'play';
    g.turn = g.lord;
    g.turnAt = now(st);
    log(st, 'lead', { s: g.lord });
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
    g.cnt[s]++;
    if (p.bomb) { g.bombs++; log(st, p.type === 'rocket' ? 'rocket' : 'bomb', { s }); }
    g.trick[s] = { ids: sorted, type: p.type, key: p.key, n: p.n, at: now(st) };
    evPush(st, { seat: s, kind: 'play', ids: sorted, type: p.type, key: p.key, left: h.length });
    if (!h.length) return endRound(st, s);
    g.turn = nx(s);
    g.turnAt = now(st);
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
    evPush(st, { seat: s, kind: 'pass' });
    if (g.passes >= N - 1) { g.turn = g.last.seat; g.last = null; g.passes = 0; }
    else g.turn = nx(s);
    g.turnAt = now(st);
    return st;
  }

  // ---------- 超时 ----------
  // 叫/抢地主：自动“不叫 / 不抢”；出牌：跟牌自动“不出”，先出时自动出最小的一张
  function timeout(st, at) {
    const g = st.g;
    if (st.paused || !g || g.turnAt !== at || g.turn < 0) return null;
    if (st.phase === 'bid') { doBid(st, g.turn, false, true); return st; }
    if (st.phase !== 'play') return null;
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
  // 加倍 10 秒到：没选的人算“不加倍”
  function dblTimeout(st, at) {
    const g = st.g;
    if (st.phase !== 'double' || st.paused || !g || g.dblAt !== at) return null;
    for (let s = 0; s < N; s++) if (g.dbl[s] == null) g.dbl[s] = false;
    toPlay(st);
    return st;
  }
  function pause(st, uid) {
    const s = needSeat(st, uid);
    if (!['bid', 'double', 'play'].includes(st.phase)) throw E('cantPause');
    if (st.paused) return null;
    st.paused = { s, at: now(st) };
    log(st, 'paused', { s });
    return st;
  }
  function resume(st, uid) {
    const s = needSeat(st, uid);
    if (!st.paused) return null;
    const d = Math.max(0, now(st) - st.paused.at);
    const g = st.g;
    if (g) { if (g.turnAt) g.turnAt += d; if (g.dblAt) g.dblAt += d; if (g.dealtAt) g.dealtAt += d; }
    st.paused = null;
    log(st, 'resumed', { s });
    return st;
  }

  // ---------- 倍数与计分 ----------
  // 公共倍数：每抢一次 ×2，每个炸弹 / 王炸 ×2，春天或反春 ×2（底分另算）
  function mult(g, spring) { return Math.pow(2, g.grabs + g.bombs + (spring ? 1 : 0)); }
  // 每个农民和地主之间单独结算：底分 × 公共倍数 × 地主加倍 × 这个农民加倍
  function settle(g, lordWin, spring) {
    const m = BASE * mult(g, spring), ld = g.dbl[g.lord] ? 2 : 1;
    const delta = [0, 0, 0], pair = [0, 0, 0];
    for (let f = 0; f < N; f++) {
      if (f === g.lord) continue;
      const p = m * ld * (g.dbl[f] ? 2 : 1);
      pair[f] = p;
      delta[f] = lordWin ? -p : p;
      delta[g.lord] += lordWin ? p : -p;
    }
    return { delta, pair, m };
  }
  function endRound(st, s) {
    const g = st.g, L = g.lord;
    const lordWin = s === L;
    const farmers = [0, 1, 2].filter((x) => x !== L);
    const spring = lordWin && farmers.every((f) => g.cnt[f] === 0);
    const anti = !lordWin && g.cnt[L] === 1;
    const r = settle(g, lordWin, spring || anti);
    for (let x = 0; x < N; x++) st.scores[x] += r.delta[x];
    st.prev = {
      lord: L, lordWin, last: s, spring, anti, grabs: g.grabs, bombs: g.bombs, base: BASE, m: r.m,
      dbl: g.dbl.slice(), delta: r.delta, pair: r.pair, left: g.hands.map((h) => sortHand(h)),
      // 记下这局是谁打的：之后有人换座，结算和复盘仍然显示当时的名字
      at: now(st), uids: st.seats.slice(), names: st.seats.map((u) => (u && st.names && st.names[u]) || ''),
    };
    const note = { k: lordWin ? 'lordWin' : 'farmWin', s: L, n: Math.abs(r.delta[L]) };
    log(st, note.k, note);
    if (spring) log(st, 'spring');
    if (anti) log(st, 'anti');
    st.phase = 'roundEnd';
    g.turn = -1;
    // 点了“打完这局就走”的人，现在自动离座
    for (const u of st.leaving || []) { const x = seatOf(st, u); if (x >= 0) vacate(st, x, 'leftAfter'); }
    st.leaving = [];
    return st;
  }
  function setReady(st, uid, on, rng) {
    needSeat(st, uid);
    if (st.phase !== 'lobby' && st.phase !== 'roundEnd') throw E('cantReady');
    st.ready = (st.ready || []).filter((x) => x !== uid && st.seats.includes(x));
    if (on) { st.ready.push(uid); if (st.kicks) delete st.kicks[seatOf(st, uid)]; }
    const all = st.seats.every((x) => x && st.ready.includes(x));
    if (all) { if (st.phase === 'lobby') start(st, uid, rng); else deal(st, rng); }
    return st;
  }
  function toLobby(st) {
    Object.assign(st, { phase: 'lobby', g: null, paused: null, ready: [], votes: [], scores: [0, 0, 0], round: 0, prev: null, gone: [], leaving: [], kicks: {} });
    log(st, 'reset');
    return st;
  }
  function vote(st, uid, on) {
    const s = needSeat(st, uid);
    if (st.phase === 'lobby') throw E('noResetNeeded');
    st.votes = st.votes.filter((x) => x !== uid && st.seats.includes(x));
    if (on) { st.votes.push(uid); log(st, 'vote', { s, n: st.votes.length }); }
    else log(st, 'unvote', { s });
    // 在座的人都同意（有空座时只算在座的人）
    if (st.seats.filter(Boolean).every((x) => st.votes.includes(x))) toLobby(st);
    return st;
  }

  return {
    card, val, cv, vname, cardName, sortHand, analyze, beats, options, fresh, sit, leave, leaveLater, kick, start, deal, setReady, vote, toLobby,
    bid, bidOptions, double, play, pass, timeout, dblTimeout, pause, resume, mult, settle,
    N, BASE, KICK_WAIT, TURN_SECS, BID_SECS, DBL_SECS, REVEAL_MS, SUIT_CH,
  };
})();
if (typeof module !== 'undefined') module.exports = DDZ;
