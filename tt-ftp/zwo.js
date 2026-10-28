/*
 * menus.json の1日分のメニューを Zwift のワークアウトファイル(.zwo)に変換する。
 * .zwo の強度は FTP 比(1.0 = 100%)なので、Zwift側に設定した FTP で W が決まる。
 * ブラウザでは window.Zwo、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zwo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const sec = (d) => Math.round((d.min || 0) * 60 + (d.sec || 0));
  const range = (pct) => (Array.isArray(pct) ? pct : [pct, pct]);
  // 範囲指定は中央値を目標にする (Zwift は1つの目標値しか持てない)
  const ratio = (pct) => {
    const [lo, hi] = range(pct);
    return +(((lo + hi) / 2) / 100).toFixed(3);
  };

  const steady = (duration, pct) => `<SteadyState Duration="${duration}" Power="${ratio(pct)}"/>`;

  function isWarmup(label) {
    return /^(WU|Warm-?Up)/i.test(label || '');
  }
  function isCooldown(label) {
    return /^(CD|Cool-?Down)/i.test(label || '');
  }

  /** 区間1つ → .zwo の要素の配列 */
  function segmentToElements(seg) {
    const out = [];
    if (seg.work) {
      const reps = seg.reps || 1;
      const sets = seg.sets || 1;
      const w = sec(seg.work);
      for (let s = 0; s < sets; s++) {
        if (seg.rest && seg.restFirst) {
          // (つなぎ→本番)×reps は IntervalsT の On/Off そのもの
          out.push(`<IntervalsT Repeat="${reps}" OnDuration="${sec(seg.rest)}" OffDuration="${w}" OnPower="${ratio(seg.rest.pct)}" OffPower="${ratio(seg.work.pct)}"/>`);
        } else if (seg.rest && reps > 1) {
          // IntervalsT は最後にも Off が付くため、最後の1本は単独の SteadyState にする
          out.push(`<IntervalsT Repeat="${reps - 1}" OnDuration="${w}" OffDuration="${sec(seg.rest)}" OnPower="${ratio(seg.work.pct)}" OffPower="${ratio(seg.rest.pct)}"/>`);
          out.push(steady(w, seg.work.pct));
        } else {
          for (let r = 0; r < reps; r++) out.push(steady(w, seg.work.pct));
        }
        if (seg.setRest && s < sets - 1) out.push(steady(sec(seg.setRest), seg.setRest.pct));
      }
      return out;
    }
    const duration = sec(seg);
    if (seg.pct === undefined) {
      // パワー指定の無い区間(峠TT・レースなど)は自由走行
      if (duration > 0) out.push(`<FreeRide Duration="${duration}"/>`);
      return out;
    }
    const [lo, hi] = range(seg.pct);
    if (lo !== hi && isWarmup(seg.label)) {
      out.push(`<Warmup Duration="${duration}" PowerLow="${lo / 100}" PowerHigh="${hi / 100}"/>`);
    } else if (lo !== hi && isCooldown(seg.label)) {
      out.push(`<Cooldown Duration="${duration}" PowerLow="${hi / 100}" PowerHigh="${lo / 100}"/>`);
    } else {
      out.push(steady(duration, seg.pct));
    }
    return out;
  }

  /**
   * menu: menus.json の1日分 { title, segments, notes }
   * opts: { name, description, author }
   */
  function menuToZwo(menu, opts = {}) {
    const body = (menu.segments || []).flatMap(segmentToElements).map((e) => `    ${e}`).join('\n');
    const desc = [opts.description, ...(menu.notes || [])].filter(Boolean).join('\n');
    return `<workout_file>
  <author>${xmlEsc(opts.author || '峠TT FTPプランナー')}</author>
  <name>${xmlEsc(opts.name || menu.title)}</name>
  <description>${xmlEsc(desc)}</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
${body}
  </workout>
</workout_file>
`;
  }

  /** .zwo の要素から合計秒数を数える(検算用) */
  function zwoDuration(xml) {
    let total = 0;
    for (const m of xml.matchAll(/<(\w+)([^>]*)\/>/g)) {
      const attr = (k) => Number((m[2].match(new RegExp(`${k}="([\\d.]+)"`)) || [])[1] || 0);
      if (m[1] === 'IntervalsT') total += attr('Repeat') * (attr('OnDuration') + attr('OffDuration'));
      else total += attr('Duration');
    }
    return total;
  }

  return { menuToZwo, segmentToElements, zwoDuration };
});
