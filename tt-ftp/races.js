/*
 * 出場レース: その日のメニューをレースに切り替え、優先度に応じて前の日をテーパーにする。
 *   優先度 C: テーパーなし(レースの日だけ切り替える)
 *   優先度 B: 3日前からテーパー(menus.json の races.taper の 3日前・2日前・前日 のメニュー)
 * もともと休養の日(メニュー無し)はテーパーでも休養のまま。
 * デッドリフト: レースの日は無し。B のテーパー中は重量を races.strengthTaperPct(70%)に下げ、1RMテストはしない。
 * ブラウザでは window.Races、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Calc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Races = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** その日のレース(無ければ null)。races: [{ date: 'YYYY-MM-DD', name, priority: 'B'|'C' }] */
  function raceOn(date, races) {
    const key = iso(date);
    return (races || []).find((r) => r.date === key) || null;
  }

  /** その日がテーパー中なら { race, daysBefore }(一番近いレース)。テーパーしない優先度は対象外 */
  function taperFor(date, races, menus) {
    const pr = (menus.races && menus.races.priorities) || {};
    let best = null;
    for (const r of races || []) {
      const days = (pr[r.priority] && pr[r.priority].taperDays) || 0;
      const n = Calc.daysBetween(date, Calc.parseDate(r.date));
      if (n >= 1 && n <= days && (!best || n < best.daysBefore)) best = { race: r, daysBefore: n };
    }
    return best;
  }

  function raceMenu(race, menus) {
    const pr = (menus.races && menus.races.priorities && menus.races.priorities[race.priority]) || {};
    return {
      title: `レース：${race.name}`,
      kind: 'event',
      racePriority: race.priority,
      segments: [{ label: race.name, note: `優先度 ${pr.label || race.priority}` }],
      notes: race.priority === 'C' ? ['テーパーなしで出るレース。練習の一部として使う'] : [],
      race: true,
    };
  }

  /**
   * その日のメニューにレースを反映する。menu はもともとのメニュー(休養なら null)。
   * 戻り値: 反映後のメニュー(休養なら null)
   */
  function applyRaces(menu, date, races, menus) {
    const race = raceOn(date, races);
    if (race) return raceMenu(race, menus);
    if (!menu) return null;
    const t = taperFor(date, races, menus);
    const tpl = t && menus.races && menus.races.taper && menus.races.taper[String(t.daysBefore)];
    if (!tpl) return menu;
    const label = t.daysBefore === 1 ? '前日' : `${t.daysBefore}日前`;
    return {
      ...JSON.parse(JSON.stringify(tpl)),
      title: `${tpl.title}（${t.race.name}の${label}）`,
      taper: { race: t.race.name, daysBefore: t.daysBefore },
    };
  }

  /** デッドリフトの予定(strength.planFor の結果)にレースを反映する。無しなら null */
  function adjustStrength(plan, date, races, menus) {
    if (!plan) return null;
    if (raceOn(date, races)) return null;
    const t = taperFor(date, races, menus);
    if (!t) return plan;
    const ratio = ((menus.races && menus.races.strengthTaperPct) || 70) / 100;
    const sets = plan.test
      ? [{ pct: 80 * ratio, reps: 2, sets: 2 }] // テストはしない。軽く動かすだけ
      : (plan.sets || []).map((s) => ({ ...s, pct: s.pct * ratio, label: s.label === 'トップシングル' ? '' : s.label }));
    return { ...plan, test: false, sets, taperNote: `${t.race.name}の${t.daysBefore === 1 ? '前日' : `${t.daysBefore}日前`}なので重量${Math.round(ratio * 100)}%` };
  }

  /** レースを入れた/外したときに予定を直す日付(テーパーの範囲を含む) */
  function affectedDates(race, menus) {
    const pr = (menus.races && menus.races.priorities) || {};
    const days = Math.max(...Object.values(pr).map((p) => p.taperDays || 0), 0);
    const end = Calc.parseDate(race.date);
    const out = [];
    for (let i = days; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      out.push(d);
    }
    return out;
  }

  return { raceOn, taperFor, raceMenu, applyRaces, adjustStrength, affectedDates };
});
