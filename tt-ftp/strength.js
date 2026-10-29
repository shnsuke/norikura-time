/*
 * デッドリフト: 1RM の換算、その日の重さ・回数・セット数、ウォームアップ、片側のプレート。
 * 予定は menus.json の strength に %1RM で書き、表示時に 1RM × % を丸めて kg にする。
 * ブラウザでは window.Strength、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Calc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strength = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  const MAX_REPS = 6;

  /** Brzycki: 1RM = 重さ × 36 / (37 − 回数)。回数は 1〜6 回 */
  function brzycki(weightKg, reps) {
    if (!(weightKg > 0)) throw new RangeError('重さを kg で入れてください');
    if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) throw new RangeError(`回数は 1〜${MAX_REPS} 回で入れてください`);
    return (weightKg * 36) / (37 - reps);
  }

  /** step 単位に丸める(2.5kg など) */
  const roundTo = (x, step) => Math.round(x / step) * step;

  /** 片側に付けるプレート(重い順)。組めない端数は rest に残す */
  function platesPerSide(totalKg, barKg, plates) {
    let side = (totalKg - barKg) / 2;
    if (side <= 0) return { plates: [], rest: 0 };
    const out = [];
    for (const p of [...plates].sort((a, b) => b - a)) {
      while (side + 1e-9 >= p) {
        out.push(p);
        side -= p;
      }
    }
    return { plates: out, rest: Math.round(side * 100) / 100 };
  }

  /**
   * 1RM の記録 [{ date: 'YYYY-MM-DD', kg }] から最新の値(無ければ初期値)。
   * asOf ('YYYY-MM-DD') を渡すとその日までの記録だけを見る。before = true ならその日の記録も含めない(テスト当日用)
   */
  function current1RM(log, initialKg, asOf, before = false) {
    const usable = (log || []).filter((x) => !asOf || (before ? x.date < asOf : x.date <= asOf));
    const sorted = [...usable].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.savedAt || 0) - (b.savedAt || 0)));
    const last = sorted[sorted.length - 1];
    return last ? { kg: last.kg, date: last.date } : { kg: initialKg, date: null };
  }

  /**
   * その日のデッドリフトの予定(%1RM のまま)。無ければ null。
   * strength.phases[期id].groups から、ブロック番号が合うグループの週(ブロック内の週、ピーク期は期の週)と曜日で探す。
   */
  function planFor(date, menus) {
    const st = menus.strength;
    if (!st) return null;
    const info = Calc.getPhaseAndWeek(date, menus);
    if (info.status !== 'in') return null;
    const ph = st.phases && st.phases[info.phase.id];
    if (!ph) return null;
    const blockPhase = info.phase.blocks !== false;
    const group = (ph.groups || []).find((g) => !blockPhase || !g.blocks || g.blocks.includes(info.block));
    if (!group) return null;
    const week = String(blockPhase ? info.weekInBlock : info.week);
    const day = group.weeks && group.weeks[week] && group.weeks[week][info.day];
    if (!day) return null;
    return { ...day, day: info.day, focus: group.focus, timing: (st.timing || {})[info.day] || '', phase: info.phase, info };
  }

  /** 予定を kg に変換する */
  function resolvePlan(plan, oneRmKg, st) {
    const step = st.roundKg || 2.5;
    const bar = st.barKg || 20;
    const kgOf = (pct) => Math.max(bar, roundTo((oneRmKg * pct) / 100, step));
    const withPlates = (kg) => ({ kg, ...platesPerSide(kg, bar, st.plates || [20, 10, 5, 2.5, 1.25]) });
    const warmupSrc = plan.test ? (st.test && st.test.warmup) || st.warmup : st.warmup;
    const warmup = (warmupSrc || []).map((w) => ({ ...withPlates(w.bar ? bar : kgOf(w.pct)), reps: w.reps, pct: w.bar ? null : w.pct, bar: !!w.bar }));
    if (plan.test) {
      const attempts = ((st.test && st.test.attempts) || []).map((a) => ({ ...withPlates(kgOf(a.pct)), label: a.label, pct: a.pct, note: a.note, reps: 1 }));
      return { test: true, timing: plan.timing, focus: plan.focus, oneRmKg, warmup, attempts, work: [] };
    }
    const work = (plan.sets || []).map((x) => ({ ...withPlates(kgOf(x.pct)), label: x.label || '', pct: x.pct, reps: x.reps, sets: x.sets }));
    return { test: false, timing: plan.timing, focus: plan.focus, oneRmKg, warmup, attempts: [], work };
  }

  /** 前回の更新からの日数(更新が無ければ null) */
  function daysSinceUpdate(log, today) {
    const c = current1RM(log, null);
    return c.date ? Calc.daysBetween(Calc.parseDate(c.date), today) : null;
  }

  return { MAX_REPS, brzycki, roundTo, platesPerSide, current1RM, planFor, resolvePlan, daysSinceUpdate };
});
