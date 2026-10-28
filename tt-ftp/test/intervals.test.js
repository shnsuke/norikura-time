const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const Intervals = require('../intervals.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));

test('時間の書式', () => {
  assert.equal(Intervals.dur(30), '30s');
  assert.equal(Intervals.dur(165), '2m45s');
  assert.equal(Intervals.dur(5400), '1h30m');
});

test('テキスト変換: 反復・つなぎ先行・ランプ・自由走行', () => {
  const text = Intervals.menuToText({
    segments: [
      { label: 'WU', pct: [55, 65], min: 15 },
      { label: 'SST', reps: 3, work: { pct: [88, 94], min: 15 }, rest: { pct: 55, min: 5 } },
      { label: '30/15', reps: 3, restFirst: true, work: { pct: 117, sec: 30 }, rest: { pct: 40, sec: 15 } },
      { label: 'TT', note: '全力', min: 30 },
      { label: 'CD', pct: [45, 55], min: 10 },
    ],
    notes: ['メモ'],
  });
  assert.equal(text, [
    'メモ', '',
    '- 15m ramp 55-65%', '',
    '2x', '- 15m 88-94%', '- 5m 55%', '',
    '- 15m 88-94%', '',
    '3x', '- 15s 40%', '- 30s 117%', '',
    '- 30m freeride', '- 10m ramp 55-45%',
  ].join('\n'));
});

test('menus.json の全メニュー: テキストの合計時間がアプリ表示の時間と一致する', () => {
  for (const phase of menus.phases) {
    for (const days of Object.values(phase.templates)) {
      for (const menu of Object.values(days)) {
        const expected = (menu.segments || []).reduce((a, s) => a + Calc.resolveSegment(s, 300, 60).totalSec, 0);
        assert.equal(Intervals.textDuration(Intervals.menuToText(menu)), expected, `${phase.name} ${menu.title}`);
      }
    }
  }
});

test('予定の作成: シーズン全体で休養日を除く日が登録され、日付で上書きできるIDを持つ', () => {
  const events = Intervals.buildEvents(menus, Calc.parseDate('2026-10-28'), Calc.parseDate('2027-09-10'));
  // 43週 × 5日(月・金は休養)
  assert.equal(events.length, 43 * 5);
  assert.equal(events[0].start_date_local, '2026-11-03T00:00:00');
  assert.equal(events[0].external_id, 'ttftp-2026-11-03');
  assert.equal(events[0].category, 'WORKOUT');
  assert.match(events[0].description, /^基礎期 B1負荷週\n/);
  const last = events[events.length - 1];
  assert.equal(last.start_date_local, '2027-08-29T00:00:00');
  assert.equal(last.name, 'レース本番');
  // 回復週の土曜はFTPテスト
  const sat = events.find((e) => e.start_date_local.startsWith('2026-11-21'));
  assert.equal(sat.name, 'FTPテスト（峠TT）');
  assert.match(sat.description, /B1回復週/);
});

test('登録: API キーで Basic 認証し、upsert で送る', async () => {
  let call;
  const fakeFetch = async (url, opts) => {
    call = { url, opts };
    return { ok: true, json: async () => [{ id: 1 }] };
  };
  const events = Intervals.buildEvents(menus, Calc.parseDate('2026-11-02'), Calc.parseDate('2026-11-08'));
  await Intervals.uploadEvents('abc', events, fakeFetch);
  assert.equal(call.url, 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true');
  assert.equal(call.opts.headers.Authorization, `Basic ${Buffer.from('API_KEY:abc').toString('base64')}`);
  assert.equal(JSON.parse(call.opts.body).length, 5);

  const failing = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  await assert.rejects(Intervals.uploadEvents('bad', events, failing), /401/);
});
