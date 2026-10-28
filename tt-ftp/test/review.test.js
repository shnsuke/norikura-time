const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const R = require('../review.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));
const d = (s) => Calc.parseDate(s);
const close = (a, e, t) => assert.ok(Math.abs(a - e) <= t, `expected ${e}±${t}, got ${a}`);

test('心拍の指標: WORK 区間の平均%・最後の本の最高%・上昇幅', () => {
  const ivs = [
    { type: 'RECOVERY', average_heartrate: 120, average_watts: 150, moving_time: 300, start_index: 0 },
    { type: 'WORK', average_heartrate: 160, max_heartrate: 166, average_watts: 280, moving_time: 900, start_index: 300 },
    { type: 'WORK', average_heartrate: 168, max_heartrate: 175, average_watts: 280, moving_time: 900, start_index: 1500 },
    { type: 'WORK', average_heartrate: 90, average_watts: 100, moving_time: 600, start_index: 2700 }, // 弱すぎる区間は除外
  ];
  const m = R.hrMetrics(ivs, 190, 200);
  assert.equal(m.count, 2);
  close(m.avg, (160 + 168) / 2 / 190 * 100, 1e-9);
  close(m.lastMax, 175 / 190 * 100, 1e-9);
  close(m.drift, (168 - 160) / 190 * 100, 1e-9);
  assert.equal(R.hrMetrics(ivs, null), null);
  assert.equal(R.hrMetrics([], 190), null);
});

test('判定: RPE と心拍の両方で決め、分かれたらきつい側', () => {
  // SST: 余裕 = RPE≤5 かつ 平均心拍<82%
  assert.equal(R.judgeSession('sst', { result: 'done', rpe: 5 }, { avg: 80, drift: 1 }).verdict, 'easy');
  assert.equal(R.judgeSession('sst', { result: 'done', rpe: 5 }, { avg: 85, drift: 1 }).verdict, 'ok');
  assert.equal(R.judgeSession('sst', { result: 'done', rpe: 6 }, { avg: 85, drift: 6 }).verdict, 'hard'); // 上昇 >5pt
  assert.equal(R.judgeSession('sst', { result: 'done', rpe: 8 }, null).verdict, 'hard');
  // VO2: 最後の本の最高心拍が低い = 余裕
  assert.equal(R.judgeSession('vo2', { result: 'done', rpe: 7 }, { lastMax: 86 }).verdict, 'easy');
  assert.equal(R.judgeSession('vo2', { result: 'done', rpe: 9 }, { lastMax: 93 }).verdict, 'ok');
  assert.equal(R.judgeSession('vo2', { result: 'done', rpe: 8 }, { lastMax: 98 }).verdict, 'hard');
  // 途中でやめた = 未完了、休んだ・未記録 = 判定しない
  assert.equal(R.judgeSession('vo2', { result: 'partial', rpe: 10 }, null).verdict, 'failed');
  assert.equal(R.judgeSession('vo2', { result: 'skipped' }, null).verdict, null);
  assert.equal(R.judgeSession('vo2', null, { lastMax: 90 }).verdict, null);
  assert.equal(R.judgeSession('z2', { result: 'done', rpe: 3 }, null).verdict, null);
});

test('調整案: 平均点から +2/+1/0/−2、未完了2回で −3、1回だけなら ±1 まで', () => {
  const s = (kind, ...vs) => vs.map((verdict) => ({ kind, verdict }));
  const p = R.proposeAdjustments([
    ...s('vo2', 'easy', 'easy'), ...s('threshold', 'easy', 'ok'), ...s('sst', 'ok', 'ok'),
    ...s('race', 'easy'),
  ]);
  assert.deepEqual([p.kinds.vo2.adj, p.kinds.threshold.adj, p.kinds.sst.adj, p.kinds.race.adj], [2, 1, 0, 1]);
  const q = R.proposeAdjustments([...s('vo2', 'hard', 'ok'), ...s('sst', 'failed', 'failed')]);
  assert.equal(q.kinds.vo2.adj, -2); // 平均 −0.5
  assert.equal(q.kinds.sst.adj, -3);
  assert.equal(q.z2Pct, -20); // きつい+未完了 = 3回 → 疲労のサイン1つ → Z2 −20%
});

test('調整案: 疲労のサインで Z2 を減らし、2つ重なれば強度を上げない', () => {
  const s = (kind, ...vs) => vs.map((verdict) => ({ kind, verdict }));
  const one = R.proposeAdjustments(s('vo2', 'easy', 'easy'), { z2: { efNow: 1.50, efPrev: 1.60 } });
  assert.equal(one.z2Pct, -20);
  assert.equal(one.kinds.vo2.adj, 2);
  close(one.efDrop, 6.25, 1e-9);
  const two = R.proposeAdjustments([...s('vo2', 'easy', 'easy'), ...s('sst', 'hard', 'hard', 'failed')], { z2: { efNow: 1.5, efPrev: 1.6 } });
  assert.equal(two.z2Pct, -30);
  assert.equal(two.kinds.vo2.adj, 0);
  const none = R.proposeAdjustments(s('vo2', 'ok'), { z2: { efNow: 1.58, efPrev: 1.60 } });
  assert.equal(none.z2Pct, 0);
});

test('調整案: FTP の上昇と合わせて W の上昇は +5% まで', () => {
  const s = (kind, ...vs) => vs.map((verdict) => ({ kind, verdict }));
  const p = R.proposeAdjustments(s('vo2', 'easy', 'easy'), { ftp: { before: 300, after: 312 } }); // +4%
  assert.equal(p.kinds.vo2.adj, 1);
  assert.equal(p.kinds.vo2.cappedByFtp, true);
  assert.equal(p.notes.length, 1);
  const q = R.proposeAdjustments(s('vo2', 'easy', 'easy'), { ftp: { before: 300, after: 318 } }); // +6%
  assert.equal(q.kinds.vo2.adj, 0);
  const r = R.proposeAdjustments(s('vo2', 'easy', 'easy'), { ftp: { before: 315, after: 320 } }); // +1.6% → 上限 +3 は効かない
  assert.equal(r.kinds.vo2.adj, 2);
  assert.deepEqual(r.notes, []);
});

test('ブロックの範囲と次のブロック', () => {
  const r = R.blockRange(menus, 0, 2);
  assert.deepEqual([r.start.getMonth() + 1, r.start.getDate(), r.end.getMonth() + 1, r.end.getDate()], [11, 23, 12, 13]);
  assert.deepEqual(R.nextBlock(menus, 0, 2), { phaseIndex: 0, phase: 'base', block: 3 });
  assert.deepEqual(R.nextBlock(menus, 0, 4), { phaseIndex: 1, phase: 'build', block: 1 });
  assert.deepEqual(R.nextBlock(menus, 2, 5), { phaseIndex: 3, phase: 'peak', block: null });
  assert.equal(R.nextBlock(menus, 3, null), null);
  const pk = R.blockRange(menus, 3, null);
  assert.equal(Calc.daysBetween(pk.start, pk.end), 27);
});

test('調整の適用: 同じ期では強度を累積、Z2 はそのブロックだけ', () => {
  const adjustments = {
    'base:2': { kinds: { vo2: 1, sst: 2 }, z2Pct: -20 },
    'base:3': { kinds: { vo2: 1 }, z2Pct: 0 },
    'build:1': { kinds: { vo2: -2 }, z2Pct: 0 },
  };
  assert.deepEqual(R.adjustmentFor(d('2026-11-10'), menus, adjustments), { kinds: {}, z2Pct: 0 }); // ブロック1
  assert.deepEqual(R.adjustmentFor(d('2026-11-24'), menus, adjustments), { kinds: { vo2: 1, sst: 2 }, z2Pct: -20 });
  assert.deepEqual(R.adjustmentFor(d('2026-12-15'), menus, adjustments), { kinds: { vo2: 2, sst: 2 }, z2Pct: 0 });
  assert.deepEqual(R.adjustmentFor(d('2027-01-26'), menus, adjustments), { kinds: { vo2: -2 }, z2Pct: 0 }); // 期が変わるとリセット
});

test('調整の適用: 本番区間の % だけを動かし、Z2 は時間を減らす', () => {
  const base = menus.phases[0].templates;
  const thu = R.applyAdjustment(base.load.thu, { kinds: { sst: 2 }, z2Pct: 0 });
  const sst = thu.segments.find((s) => s.label === 'SST');
  assert.deepEqual(sst.work.pct, [90, 96]);
  assert.deepEqual(sst.rest.pct, 55); // つなぎは変えない
  assert.deepEqual(thu.segments.find((s) => s.label === 'WU').pct, [55, 65]);
  assert.equal(thu.adjusted, '強度 +2%');
  assert.deepEqual(base.load.thu.segments.find((s) => s.label === 'SST').work.pct, [88, 94]); // 元は変更しない
  const sun = R.applyAdjustment(base.load.sun, { kinds: {}, z2Pct: -20 });
  assert.equal(sun.segments[0].min, 144); // 180分 × 0.8
  assert.equal(sun.adjusted, '量 -20%');
  // 一定区間でも 85% 以上なら本番扱い(閾値ロング・レースシミュレーション)
  const race = R.applyAdjustment(menus.phases[2].templates.load.sat, { kinds: { race: 1 }, z2Pct: 0 });
  assert.deepEqual(race.segments.map((s) => s.pct), [[60, 70], [96, 103], [60, 70]]);
  assert.equal(R.applyAdjustment(base.load.wed, { kinds: { vo2: 3 }, z2Pct: 0 }), base.load.wed);
});
