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

test('頻度: 基礎期・ビルド期は木・日、特異期は日のみ、8/8 が最後', () => {
  const daysWithLift = [];
  for (let t = d('2026-11-02'); t <= d('2027-08-29'); t.setDate(t.getDate() + 1)) {
    if (S.planFor(t, menus)) daysWithLift.push(new Date(t));
  }
  const byPhase = (id) => daysWithLift.filter((x) => Calc.getPhaseAndWeek(x, menus).phase.id === id);
  const dows = (xs) => [...new Set(xs.map((x) => x.getDay()))].sort();
  assert.deepEqual(dows(byPhase('base')), [0, 4]);
  assert.equal(byPhase('base').length, 24); // 12週 × 2
  assert.deepEqual(dows(byPhase('build')), [0, 4]);
  assert.equal(byPhase('build').length, 24);
  assert.deepEqual(dows(byPhase('specific')), [0]);
  assert.equal(byPhase('specific').length, 15);
  assert.deepEqual(byPhase('peak').map((x) => `${x.getMonth() + 1}/${x.getDate()}`), ['8/8']);
  assert.equal(S.planFor(d('2027-08-15'), menus), null);
  assert.equal(S.planFor(d('2026-11-03'), menus), null); // 火曜はやらない
});

test('基礎期: 1RMテストは回復週の木曜だけ', () => {
  const tests = [];
  for (let t = d('2026-11-02'); t <= d('2027-08-29'); t.setDate(t.getDate() + 1)) {
    const p = S.planFor(t, menus);
    if (p && p.test) tests.push(`${t.getMonth() + 1}/${t.getDate()}`);
  }
  assert.deepEqual(tests, ['11/19', '12/10', '12/31', '1/21']);
});

test('重さ(1RM 122.5kg): 基礎期ブロック1〜2', () => {
  const sun1 = kgOf('2026-11-08'); // 負荷週1の日曜
  assert.deepEqual(sun1.work.map((w) => [w.kg, w.reps, w.sets]), [[105, 3, 5]]);
  assert.deepEqual(sun1.work[0].plates, [20, 20, 2.5]);
  assert.equal(sun1.timing, 'Z2の後');
  const thu1 = kgOf('2026-11-05');
  assert.deepEqual(thu1.work.map((w) => [w.kg, w.reps, w.sets]), [[97.5, 3, 4]]);
  assert.match(thu1.timing, /夜/);
  assert.deepEqual(kgOf('2026-11-15').work.map((w) => [w.kg, w.reps, w.sets]), [[107.5, 3, 4]]);
  assert.deepEqual(kgOf('2026-11-12').work.map((w) => [w.kg, w.reps, w.sets]), [[100, 3, 4]]);
  assert.deepEqual(kgOf('2026-11-22').work.map((w) => [w.kg, w.reps, w.sets]), [[97.5, 2, 2]]);
  // ウォームアップ: バー → 40% → 60% → 75% → 85%
  assert.deepEqual(sun1.warmup.map((w) => [w.kg, w.reps]), [[20, 8], [50, 5], [72.5, 3], [92.5, 2], [105, 1]]);
});

test('重さ(1RM 122.5kg): 1RMテストの日', () => {
  const t = kgOf('2026-11-19');
  assert.equal(t.test, true);
  assert.deepEqual(t.warmup.map((w) => w.kg), [20, 50, 72.5, 92.5, 105, 112.5]);
  assert.deepEqual(t.attempts.map((a) => a.kg), [122.5, 125]);
  assert.deepEqual(t.attempts[0].plates, [20, 20, 10, 1.25]);
});

test('重さ(1RM 122.5kg): 基礎期ブロック3〜4・ビルド期・特異期・ピーク期', () => {
  const w = (date) => kgOf(date).work.map((x) => [x.label, x.kg, x.reps, x.sets]);
  assert.deepEqual(w('2026-12-20'), [['', 107.5, 2, 5]]);       // 基礎B3 負荷週1 日
  assert.deepEqual(w('2026-12-17'), [['', 100, 2, 4]]);         // 基礎B3 負荷週1 木
  assert.deepEqual(w('2026-12-27'), [['', 112.5, 2, 3]]);       // 基礎B3 負荷週2 日
  assert.deepEqual(w('2027-01-31'), [['', 112.5, 2, 2]]);       // ビルド 負荷週1 日
  assert.deepEqual(w('2027-02-07'), [['トップシングル', 120, 1, 1], ['', 112.5, 1, 2]]); // ビルド 負荷週2 日
  assert.deepEqual(w('2027-02-04'), [['', 110, 1, 3]]);         // ビルド 負荷週2 木
  assert.deepEqual(w('2027-04-25'), [['', 112.5, 1, 3]]);       // 特異 負荷週1 日
  assert.deepEqual(w('2027-05-02'), [['', 117.5, 1, 2]]);       // 特異 負荷週2 日
  assert.deepEqual(w('2027-08-08'), [['', 110, 1, 2]]);         // ピーク 最後
});

test('1RMが変わると重さも変わる', () => {
  const plan = S.planFor(d('2026-11-29'), menus); // 基礎B2 負荷週1 日: 85%
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
