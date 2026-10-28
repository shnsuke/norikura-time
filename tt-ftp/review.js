/*
 * ブロック振り返り: キーセッションの判定 → 次のブロックの強度・量の調整案 → メニューへの適用。
 * ERG モード前提のため、パワーではなく「実施結果・RPE・心拍(maxHR比)」で判定する。
 * ブラウザでは window.Review、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Calc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Review = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  /**
   * 種類ごとの判定基準。数値は「余裕」と「適正」の上限。超えると「きつい」。
   *   rpe: [余裕の上限, 適正の上限]
   *   hr:  VO2 は最後の本の最高心拍%、それ以外は本番区間の平均心拍% [余裕の上限(未満), 適正の上限]
   *   drift: 最後の本 − 最初の本 の平均心拍%(ポイント) [余裕の上限, 適正の上限]
   */
  const CRITERIA = Object.freeze({
    vo2: { rpe: [7, 9], hr: [88, 97], hrMetric: 'lastMax', drift: null },
    threshold: { rpe: [6, 8], hr: [85, 92], hrMetric: 'avg', drift: [3, 6] },
    sst: { rpe: [5, 7], hr: [82, 90], hrMetric: 'avg', drift: [3, 5] },
    race: { rpe: [7, 9], hr: [87, 93], hrMetric: 'avg', drift: [3, 6] },
  });

  const VERDICTS = Object.freeze({
    easy: { label: '余裕', score: 1 },
    ok: { label: '適正', score: 0 },
    hard: { label: 'きつい', score: -1 },
    failed: { label: '未完了', score: -2 },
  });
  const ORDER = ['easy', 'ok', 'hard'];
  const worst = (vs) => vs.filter(Boolean).reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'easy');

  // [余裕の上限, 適正の上限] で 3段階に分ける。hr は「余裕 = 上限未満」
  const band = (x, [easyMax, okMax], strictEasy = false) => {
    if (x === null || x === undefined || Number.isNaN(x)) return null;
    if (strictEasy ? x < easyMax : x <= easyMax) return 'easy';
    return x <= okMax ? 'ok' : 'hard';
  };

  /**
   * intervals.icu の区間データから心拍の指標を出す。
   * intervals: icu_intervals の配列。WORK のうち平均パワーが minWatts 以上を本番とみなす。
   */
  function hrMetrics(intervals, maxHr, minWatts = 0) {
    if (!maxHr || !Array.isArray(intervals)) return null;
    const work = intervals
      .filter((iv) => iv.type === 'WORK' && iv.average_heartrate && (iv.average_watts || 0) >= minWatts)
      .sort((a, b) => (a.start_index ?? a.start_time ?? 0) - (b.start_index ?? b.start_time ?? 0));
    if (!work.length) return null;
    const pct = (hr) => (hr / maxHr) * 100;
    const secs = work.map((iv) => iv.moving_time || iv.elapsed_time || 1);
    const total = secs.reduce((a, b) => a + b, 0);
    const avg = work.reduce((a, iv, i) => a + pct(iv.average_heartrate) * secs[i], 0) / total;
    const last = work[work.length - 1];
    return {
      count: work.length,
      avg,
      lastMax: pct(last.max_heartrate || last.average_heartrate),
      drift: work.length >= 2 ? pct(last.average_heartrate) - pct(work[0].average_heartrate) : null,
    };
  }

  /**
   * 1回のキーセッションを判定する。
   * log: アプリの記録 { result: 'done'|'partial'|'skipped', rpe }
   * hr: hrMetrics の結果(無ければ RPE だけで判定)
   * 戻り値: { verdict, reasons } / 休んだ・未記録は verdict = null
   */
  function judgeSession(kind, log, hr) {
    const c = CRITERIA[kind];
    if (!c || !log || !log.result || log.result === 'skipped') return { verdict: null, reasons: [] };
    if (log.result === 'partial') return { verdict: 'failed', reasons: ['途中でやめた・ERGを下げた'] };
    const reasons = [];
    const vr = band(log.rpe, c.rpe);
    if (vr) reasons.push(`RPE ${log.rpe}`);
    let vh = null;
    let vd = null;
    if (hr) {
      const x = hr[c.hrMetric];
      vh = band(x, c.hr, true);
      if (vh) reasons.push(`${c.hrMetric === 'lastMax' ? '最後の本の最高心拍' : '平均心拍'} ${x.toFixed(0)}%`);
      if (c.drift && hr.drift !== null) {
        vd = band(hr.drift, c.drift);
        reasons.push(`心拍の上昇 ${hr.drift >= 0 ? '+' : ''}${hr.drift.toFixed(1)}pt`);
      }
    }
    if (!vr && !vh) return { verdict: null, reasons: ['RPE も心拍も無いため判定できません'] };
    // 指標どうしで判定が分かれたら、きつい側に寄せる
    return { verdict: worst([vr, vh, vd]), reasons };
  }

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /**
   * ブロックの判定から次のブロックの調整案を作る。
   * sessions: [{ kind, verdict }]、z2: { efNow, efPrev }、ftp: { before, after }
   * 戻り値: { kinds: { vo2: { adj, n, avg, counts } ... }, z2Pct, fatigue: [...], notes: [...] }
   */
  function proposeAdjustments(sessions, { z2 = {}, ftp = {} } = {}) {
    const kinds = {};
    const notes = [];
    for (const kind of Object.keys(CRITERIA)) {
      const judged = sessions.filter((s) => s.kind === kind && s.verdict);
      const counts = { easy: 0, ok: 0, hard: 0, failed: 0 };
      judged.forEach((s) => counts[s.verdict]++);
      if (!judged.length) { kinds[kind] = { adj: 0, n: 0, avg: null, counts }; continue; }
      const avg = judged.reduce((a, s) => a + VERDICTS[s.verdict].score, 0) / judged.length;
      let adj = avg >= 0.75 ? 2 : avg >= 0.25 ? 1 : avg > -0.25 ? 0 : -2;
      if (counts.failed >= 2) adj = -3;
      if (judged.length === 1) adj = clamp(adj, -1, 1);
      kinds[kind] = { adj: clamp(adj, -3, 3), n: judged.length, avg, counts };
    }

    // 疲労の判定 → Z2 の量
    const fatigue = [];
    const efDrop = z2.efNow && z2.efPrev ? (1 - z2.efNow / z2.efPrev) * 100 : null;
    if (efDrop !== null && efDrop >= 4) fatigue.push(`Z2 の心拍効率が前のブロックより ${efDrop.toFixed(1)}% 低い`);
    const bad = sessions.filter((s) => s.verdict === 'hard' || s.verdict === 'failed').length;
    if (bad >= 3) fatigue.push(`「きつい」「未完了」が ${bad} 回`);
    let z2Pct = 0;
    if (fatigue.length === 1) z2Pct = -20;
    if (fatigue.length >= 2) {
      z2Pct = -30;
      for (const k of Object.values(kinds)) k.adj = Math.min(k.adj, 0);
      notes.push('疲労のサインが重なっているため、強度は上げません。');
    }

    // FTP の更新と合わせて W の上昇は +5% まで
    if (ftp.before && ftp.after && ftp.after > ftp.before) {
      const rise = (ftp.after / ftp.before - 1) * 100;
      const room = Math.max(0, Math.floor(5 - rise + 1e-9)); // 1.04 − 1 などの浮動小数の誤差で切り捨てすぎない
      let capped = false;
      for (const k of Object.values(kinds)) {
        if (k.adj > room) {
          k.adj = room;
          k.cappedByFtp = true;
          capped = true;
        }
      }
      if (capped) notes.push(`FTP が ${rise.toFixed(1)}% 上がったため、% の上げ幅は +${room}% までにしています（W の上昇は合計 +5% まで）。`);
    }
    return { kinds, z2Pct, fatigue, efDrop, notes };
  }

  // ---------- 調整の保存形式と適用 ----------

  /** ブロック制の期は { phase, block }、ピーク期は { phase, block: null } */
  function blockOf(date, menus) {
    const info = Calc.getPhaseAndWeek(date, menus);
    if (info.status !== 'in') return null;
    return { phase: info.phase.id, phaseIndex: info.phaseIndex, block: info.phase.blocks === false ? null : info.block };
  }

  /** 期・ブロックの日付範囲 [start, end] */
  function blockRange(menus, phaseIndex, block) {
    const p = menus.phases[phaseIndex];
    const start = Calc.parseDate(p.start);
    const end = Calc.parseDate(p.end);
    if (block === null) return { start, end };
    const s = new Date(start);
    s.setDate(s.getDate() + (block - 1) * 7 * (menus.blockWeeks || 3));
    const e = new Date(s);
    e.setDate(e.getDate() + 7 * (menus.blockWeeks || 3) - 1);
    return { start: s, end: e > end ? end : e };
  }

  /** 振り返ったブロックの次のブロック(次の期の最初のブロック、ピーク期は期全体) */
  function nextBlock(menus, phaseIndex, block) {
    const p = menus.phases[phaseIndex];
    if (block !== null) {
      const total = Calc.getPhaseAndWeek(Calc.parseDate(p.end), menus).block;
      if (block < total) return { phaseIndex, phase: p.id, block: block + 1 };
    }
    const n = menus.phases[phaseIndex + 1];
    if (!n) return null;
    return { phaseIndex: phaseIndex + 1, phase: n.id, block: n.blocks === false ? null : 1 };
  }

  const keyOf = (phase, block) => `${phase}:${block === null ? 'all' : block}`;

  /**
   * その日に効く調整: 同じ期のそのブロックまでの強度調整を合計(±6%まで)、Z2 はそのブロックの値だけ。
   * adjustments: { "base:2": { kinds: { vo2: 1, ... }, z2Pct: -20 } ... }
   */
  function adjustmentFor(date, menus, adjustments) {
    const b = blockOf(date, menus);
    const out = { kinds: {}, z2Pct: 0 };
    if (!b || !adjustments) return out;
    for (const [key, a] of Object.entries(adjustments)) {
      const [phase, blk] = key.split(':');
      if (phase !== b.phase) continue;
      const appliesHere = blk === 'all' || b.block === null || Number(blk) <= b.block;
      if (!appliesHere) continue;
      for (const [k, v] of Object.entries(a.kinds || {})) out.kinds[k] = (out.kinds[k] || 0) + v;
      if (blk === 'all' || Number(blk) === b.block) out.z2Pct = a.z2Pct || 0;
    }
    for (const k of Object.keys(out.kinds)) out.kinds[k] = clamp(out.kinds[k], -6, 6);
    return out;
  }

  const shiftPct = (pct, d) => (Array.isArray(pct) ? pct.map((p) => p + d) : pct + d);
  const isMain = (pct) => (Array.isArray(pct) ? (pct[0] + pct[1]) / 2 : pct) >= 85;

  /**
   * メニューに調整を適用した新しいメニューを返す(元は変更しない)。
   *  - キーセッション: 本番区間(反復の work と、85%FTP 以上の一定区間)の % に adj ポイントを足す
   *  - Z2 の日: "Z2" で始まる区間の時間に z2Pct を掛ける
   */
  function applyAdjustment(menu, adj) {
    if (!menu || !adj) return menu;
    const d = adj.kinds[menu.kind] || 0;
    const z = menu.kind === 'z2' ? adj.z2Pct || 0 : 0;
    if (!d && !z) return menu;
    const segments = (menu.segments || []).map((s) => {
      if (d && s.work) return { ...s, work: { ...s.work, pct: shiftPct(s.work.pct, d) } };
      if (d && s.pct !== undefined && isMain(s.pct)) return { ...s, pct: shiftPct(s.pct, d) };
      if (z && s.pct !== undefined && /^Z2/.test(s.label || '')) {
        const sec = Math.round(((s.min || 0) * 60 + (s.sec || 0)) * (1 + z / 100) / 60) * 60;
        return { ...s, min: sec / 60, sec: undefined };
      }
      return s;
    });
    const tags = [];
    if (d) tags.push(`強度 ${d > 0 ? '+' : ''}${d}%`);
    if (z) tags.push(`量 ${z}%`);
    return { ...menu, segments, adjusted: tags.join('・') };
  }

  return {
    CRITERIA, VERDICTS, hrMetrics, judgeSession, proposeAdjustments,
    blockOf, blockRange, nextBlock, keyOf, adjustmentFor, applyAdjustment,
  };
});
