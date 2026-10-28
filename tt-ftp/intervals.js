/*
 * menus.json のメニューを intervals.icu の予定ワークアウトに変換する。
 * intervals.icu はワークアウトを説明文のテキスト("- 10m 60%" / "3x" の反復)から組み立て、
 * Zwift 連携を有効にしていれば直近7日分を Zwift に送る。
 * ブラウザでは window.Intervals、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Calc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Intervals = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  const API_BASE = 'https://intervals.icu/api/v1';

  const secOf = (d) => Math.round((d.min || 0) * 60 + (d.sec || 0));

  /** 秒 → "1h30m" / "2m45s" / "30s" */
  function dur(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h ? `${h}h` : ''}${m ? `${m}m` : ''}${s ? `${s}s` : ''}` || '0s';
  }

  function pct(p) {
    return Array.isArray(p) ? (p[0] === p[1] ? `${p[0]}%` : `${p[0]}-${p[1]}%`) : `${p}%`;
  }

  const step = (sec, p) => `- ${dur(sec)} ${pct(p)}`;
  const isWarmup = (label) => /^(WU|Warm-?Up)/i.test(label || '');
  const isCooldown = (label) => /^(CD|Cool-?Down)/i.test(label || '');

  /** 区間1つ → テキストのブロック配列(反復ブロックは前後を空行で区切る必要がある) */
  function segmentToBlocks(seg) {
    if (seg.work) {
      const blocks = [];
      const reps = seg.reps || 1;
      const sets = seg.sets || 1;
      const w = secOf(seg.work);
      for (let s = 0; s < sets; s++) {
        if (seg.rest && seg.restFirst) {
          blocks.push([`${reps}x`, step(secOf(seg.rest), seg.rest.pct), step(w, seg.work.pct)]);
        } else if (seg.rest && reps > 1) {
          // 最後の本番の後にはつなぎを入れない
          blocks.push([`${reps - 1}x`, step(w, seg.work.pct), step(secOf(seg.rest), seg.rest.pct)]);
          blocks.push([step(w, seg.work.pct)]);
        } else {
          for (let r = 0; r < reps; r++) blocks.push([step(w, seg.work.pct)]);
        }
        if (seg.setRest && s < sets - 1) blocks.push([step(secOf(seg.setRest), seg.setRest.pct)]);
      }
      return blocks;
    }
    const sec = secOf(seg);
    if (seg.pct === undefined) return sec > 0 ? [[`- ${dur(sec)} freeride`]] : [];
    const r = Array.isArray(seg.pct) ? seg.pct : [seg.pct, seg.pct];
    if (r[0] !== r[1] && isWarmup(seg.label)) return [[`- ${dur(sec)} ramp ${r[0]}-${r[1]}%`]];
    if (r[0] !== r[1] && isCooldown(seg.label)) return [[`- ${dur(sec)} ramp ${r[1]}-${r[0]}%`]];
    return [[step(sec, seg.pct)]];
  }

  /** 1日分のメニュー → intervals.icu の説明文 */
  function menuToText(menu) {
    const blocks = (menu.segments || []).flatMap(segmentToBlocks);
    // 連続する単発ステップはまとめ、反復ブロックの前後だけ空行を入れる
    const parts = [];
    for (const b of blocks) {
      const isRepeat = /^\d+x$/.test(b[0]);
      const last = parts[parts.length - 1];
      if (!isRepeat && last && !last.repeat) last.lines.push(...b);
      else parts.push({ repeat: isRepeat, lines: [...b] });
    }
    const notes = (menu.notes || []).join('\n');
    const body = parts.map((p) => p.lines.join('\n')).join('\n\n');
    return notes ? `${notes}\n\n${body}` : body;
  }

  /** menuToText の出力から合計秒数を数える(検算用) */
  function textDuration(text) {
    const toSec = (t) => {
      const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
    };
    let total = 0;
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const rep = lines[0].match(/^(\d+)x$/);
      const steps = lines.filter((l) => l.startsWith('- ')).map((l) => toSec(l.slice(2).split(' ')[0]));
      total += (rep ? Number(rep[1]) : 1) * steps.reduce((a, b) => a + b, 0);
    }
    return total;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** from〜to(両端含む)の各日について、メニューがある日を intervals.icu のイベントにする */
  function buildEvents(menus, from, to) {
    const events = [];
    for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); Calc.daysBetween(d, to) >= 0; d.setDate(d.getDate() + 1)) {
      const info = Calc.getPhaseAndWeek(d, menus);
      if (info.status !== 'in') continue;
      const found = Calc.findDayMenu(info.phase, info, info.day);
      if (!found) continue;
      const week = info.phase.blocks === false
        ? `${info.week}週目`
        : `B${info.block}${info.isRecovery ? '回復週' : '負荷週'}`;
      events.push({
        category: 'WORKOUT',
        start_date_local: `${iso(d)}T00:00:00`,
        type: 'VirtualRide',
        name: `${found.menu.title}`,
        description: `${info.phase.name} ${week}\n${menuToText(found.menu)}`,
        external_id: `ttftp-${iso(d)}`,
      });
    }
    return events;
  }

  /** 予定表に登録(同じ日付は上書き)。fetchImpl はテスト用 */
  async function uploadEvents(apiKey, events, fetchImpl = fetch) {
    const res = await fetchImpl(`${API_BASE}/athlete/0/events/bulk?upsert=true`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`API_KEY:${apiKey}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(events),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`intervals.icu が ${res.status} を返しました${text ? `：${text.slice(0, 200)}` : ''}`);
    }
    return res.json();
  }

  return { menuToText, textDuration, buildEvents, uploadEvents, dur, API_BASE };
});
