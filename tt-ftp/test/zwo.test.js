const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const Zwo = require('../zwo.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));

test('区間の変換: 定常・WU/CDのランプ・反復・つなぎ先行', () => {
  assert.deepEqual(Zwo.segmentToElements({ label: 'Z2', pct: [60, 70], min: 120 }),
    ['<SteadyState Duration="7200" Power="0.65"/>']);
  assert.deepEqual(Zwo.segmentToElements({ label: 'WU', pct: [55, 65], min: 15 }),
    ['<Warmup Duration="900" PowerLow="0.55" PowerHigh="0.65"/>']);
  assert.deepEqual(Zwo.segmentToElements({ label: 'CD', pct: [45, 55], min: 10 }),
    ['<Cooldown Duration="600" PowerLow="0.55" PowerHigh="0.45"/>']);
  // work×3 + rest×2 → IntervalsT×2 + 最後の1本
  assert.deepEqual(Zwo.segmentToElements({ label: 'SST', reps: 3, work: { pct: [88, 94], min: 15 }, rest: { pct: 55, min: 5 } }), [
    '<IntervalsT Repeat="2" OnDuration="900" OffDuration="300" OnPower="0.91" OffPower="0.55"/>',
    '<SteadyState Duration="900" Power="0.91"/>',
  ]);
  assert.deepEqual(Zwo.segmentToElements({ label: '30/15', reps: 3, restFirst: true, work: { pct: 117, sec: 30 }, rest: { pct: 40, sec: 15 } }),
    ['<IntervalsT Repeat="3" OnDuration="15" OffDuration="30" OnPower="0.4" OffPower="1.17"/>']);
  assert.deepEqual(Zwo.segmentToElements({ label: '峠TT', note: '全力', min: 30 }), ['<FreeRide Duration="1800"/>']);
  assert.deepEqual(Zwo.segmentToElements({ label: 'レース', note: '本番' }), []);
});

test('名前・メモはXMLエスケープされる', () => {
  const xml = Zwo.menuToZwo({ title: 'A&B <x>', segments: [], notes: ['"注意"'] }, {});
  assert.match(xml, /<name>A&amp;B &lt;x&gt;<\/name>/);
  assert.match(xml, /&quot;注意&quot;/);
});

test('menus.json の全メニュー: .zwo の合計時間がアプリ表示の時間と一致する', () => {
  let n = 0;
  for (const phase of menus.phases) {
    for (const days of Object.values(phase.templates)) {
      for (const menu of Object.values(days)) {
        const xml = Zwo.menuToZwo(menu, {});
        const expected = (menu.segments || []).reduce((a, s) => a + Calc.resolveSegment(s, 300, 60).totalSec, 0);
        assert.equal(Zwo.zwoDuration(xml), expected, `${phase.name} ${menu.title}`);
        n++;
      }
    }
  }
  assert.equal(n, 59);
});
