const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const S = require('../strength.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));
const st = menus.strength;
const d = (s) => Calc.parseDate(s);
const close = (a, e, t) => assert.ok(Math.abs(a - e) <= t, `expected ${e}±${t}, got ${a}`);
const kgOf = (date) => {
  const plan = S.planFor(d(date), menus);
  return plan ? S.resolvePlan(plan, 122.5, st) : null;
};

test('Brzycki の換算: 1回なら挙げた重さ、回数は1〜6回', () => {
  close(S.brzycki(120, 1), 120, 1e-9);
  close(S.brzycki(115, 2), 115 * 36 / 35, 1e-9); // 118.3
  close(S.brzycki(110, 3), 110 * 36 / 34, 1e-9); // 116.5
  close(S.brzycki(100, 6), 100 * 36 / 31, 1e-9);
  assert.throws(() => S.brzycki(100, 7), RangeError);
  assert.throws(() => S.brzycki(100, 0), RangeError);
  assert.throws(() => S.brzycki(100, 2.5), RangeError);
  assert.throws(() => S.brzycki(0, 3), RangeError);
});

test('丸めと片側のプレート', () => {
  assert.equal(S.roundTo(104.125, 2.5), 105);
  assert.equal(S.roundTo(113.3125, 2.5), 112.5);
  assert.deepEqual(S.platesPerSide(110, 20, st.plates), { plates: [20, 20, 5], rest: 0 });
  assert.deepEqual(S.platesPerSide(112.5, 20, st.plates), { plates: [20, 20, 5, 1.25], rest: 0 });
  assert.deepEqual(S.platesPerSide(120, 20, st.plates), { plates: [20, 20, 10], rest: 0 });
  assert.deepEqual(S.platesPerSide(20, 20, st.plates), { plates: [], rest: 0 });
  assert.deepEqual(S.platesPerSide(21, 20, st.plates), { plates: [], rest: 0.5 }); // 組めない端数
});

test('現在の1RM: 最新の記録、無ければ初期値 122.5kg', () => {
  assert.deepEqual(S.current1RM([], st.initial1RM), { kg: 122.5, date: null });
  assert.deepEqual(S.current1RM([{ date: '2026-11-19', kg: 125 }, { date: '2026-11-05', kg: 120 }], 122.5), { kg: 125, date: '2026-11-19' });
  assert.equal(S.daysSinceUpdate([{ date: '2026-11-19', kg: 125 }], d('2026-12-17')), 28);
  assert.equal(S.daysSinceUpdate([], d('2026-12-17')), null);
});

test('頻度: P0〜P2 と5月中は木・日の週2回、6月から日曜の週1回、8/19 が最後', () => {
  const daysWithLift = [];
  for (let t = d('2026-11-09'); t <= d('2027-08-29'); t.setDate(t.getDate() + 1)) {
    if (S.planFor(t, menus)) daysWithLift.push(new Date(t));
  }
  const byPhase = (id) => daysWithLift.filter((x) => Calc.getPhaseAndWeek(x, menus).phase.id === id);
  const dows = (xs) => [...new Set(xs.map((x) => x.getDay()))].sort();
  for (const [id, weeks] of [['p0', 2], ['p1', 12], ['p2', 12]]) {
    assert.deepEqual(dows(byPhase(id)), [0, 4], id);
    assert.equal(byPhase(id).length, weeks * 2, id);
  }
  const p3 = byPhase('p3');
  assert.deepEqual(dows(p3.filter((x) => x < d('2027-05-31'))), [0, 4]);
  assert.equal(p3.filter((x) => x < d('2027-05-31')).length, 6);       // 5/10〜5/30 は週2回
  assert.deepEqual(dows(p3.filter((x) => x >= d('2027-05-31'))), [0]); // 6月から日曜だけ
  assert.equal(p3.filter((x) => x >= d('2027-05-31')).length, 9);
  assert.deepEqual(byPhase('p4').map((x) => `${x.getMonth() + 1}/${x.getDate()}`), ['8/8', '8/19']); // レース10日前で終了
  assert.equal(S.planFor(d('2026-11-10'), menus), null); // 火曜はやらない
});

test('P1: 1RMテストはブロック2・4の回復週の木曜だけ', () => {
  const tests = [];
  for (let t = d('2026-11-09'); t <= d('2027-08-29'); t.setDate(t.getDate() + 1)) {
    const p = S.planFor(t, menus);
    if (p && p.test) tests.push(`${t.getMonth() + 1}/${t.getDate()}`);
  }
  assert.deepEqual(tests, ['12/31', '2/11']);
});

test('重さ(1RM 122.5kg): P0 と P1(4〜6回×4セット、80〜85%)', () => {
  const w = (date) => kgOf(date).work.map((x) => [x.kg, x.reps, x.sets]);
  assert.deepEqual(w('2026-11-12'), [[97.5, 3, 3]]);  // P0 木 80%
  assert.deepEqual(w('2026-11-15'), [[97.5, 3, 3]]);  // P0 日 80%
  const sun1 = kgOf('2026-11-29'); // P1 負荷週1の日曜 82.5%
  assert.deepEqual(sun1.work.map((x) => [x.kg, x.reps, x.sets]), [[100, 5, 4]]);
  assert.deepEqual(sun1.work[0].plates, [20, 20]);
  assert.equal(sun1.timing, 'ライドの後');
  const thu1 = kgOf('2026-11-26');
  assert.deepEqual(thu1.work.map((x) => [x.kg, x.reps, x.sets]), [[97.5, 5, 4]]);
  assert.match(thu1.timing, /夜/);
  assert.deepEqual(w('2026-12-03'), [[100, 4, 4]]);   // 負荷週2 木 82.5%
  assert.deepEqual(w('2026-12-06'), [[105, 4, 4]]);   // 負荷週2 日 85%
  assert.deepEqual(w('2026-12-10'), [[97.5, 4, 2]]);  // 回復週は軽く
  // P1 の負荷週はすべて 4〜6回×4セット・80〜85%
  for (const g of st.phases.p1.groups) {
    for (const wk of ['1', '2']) {
      for (const day of Object.values(g.weeks[wk])) {
        for (const x of day.sets) assert.ok(x.pct >= 80 && x.pct <= 85 && x.reps >= 4 && x.reps <= 6 && x.sets === 4);
      }
    }
  }
  // ウォームアップ: バー → 40% → 60% → 75% → 85%
  assert.deepEqual(sun1.warmup.map((x) => [x.kg, x.reps]), [[20, 8], [50, 5], [72.5, 3], [92.5, 2], [105, 1]]);
});

test('重さ(1RM 122.5kg): 1RMテストの日', () => {
  const t = kgOf('2026-12-31');
  assert.equal(t.test, true);
  assert.deepEqual(t.warmup.map((w) => w.kg), [20, 50, 72.5, 92.5, 105, 112.5]);
  assert.deepEqual(t.attempts.map((a) => a.kg), [122.5, 125]);
  assert.deepEqual(t.attempts[0].plates, [20, 20, 10, 1.25]);
});

test('重さ(1RM 122.5kg): P2(2〜3回×3セット、85〜90%)・P3 の維持・P4', () => {
  const w = (date) => kgOf(date).work.map((x) => [x.kg, x.reps, x.sets]);
  assert.deepEqual(w('2027-02-18'), [[105, 3, 3]]);     // P2 負荷週1 木 85%
  assert.deepEqual(w('2027-02-21'), [[107.5, 3, 3]]);   // P2 負荷週1 日 87.5%
  assert.deepEqual(w('2027-02-28'), [[110, 2, 3]]);     // P2 負荷週2 日 90%
  assert.deepEqual(w('2027-05-13'), [[105, 3, 3]]);     // P3 5月中はビルド期と同じ
  assert.equal(kgOf('2027-06-03'), null);               // 6月から木曜は無し
  assert.deepEqual(w('2027-06-06'), [[100, 3, 3]]);     // P3 維持 日 82.5%
  assert.deepEqual(w('2027-06-13'), [[105, 2, 3]]);     // 85%
  assert.deepEqual(w('2027-08-08'), [[97.5, 2, 3]]);    // P4 最終TTの日(ライドの後)
  assert.deepEqual(w('2027-08-19'), [[97.5, 2, 2]]);    // P4 最後
  assert.equal(kgOf('2027-08-22'), null);
});

test('1RMが変わると重さも変わる', () => {
  const plan = S.planFor(d('2026-12-06'), menus); // P1 負荷週2の日曜: 85%
  assert.equal(S.resolvePlan(plan, 125, st).work[0].kg, 107.5); // 106.25 → 107.5
  assert.equal(S.resolvePlan(plan, 130, st).work[0].kg, 110);   // 110.5 → 110
});

test('その日の時点の1RM: テスト当日はテスト前の値、それ以外はその日までの最新', () => {
  const log = [{ date: '2026-11-19', kg: 125 }, { date: '2026-12-10', kg: 127.5 }];
  assert.equal(S.current1RM(log, 122.5, '2026-11-19', true).kg, 122.5);
  assert.equal(S.current1RM(log, 122.5, '2026-11-19').kg, 125);
  assert.equal(S.current1RM(log, 122.5, '2026-12-06').kg, 125);
  assert.equal(S.current1RM(log, 122.5, '2027-01-10').kg, 127.5);
  assert.equal(S.current1RM(log, 122.5, '2026-11-08').kg, 122.5);
});
