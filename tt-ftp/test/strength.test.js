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

test('頻度: P0・P1 は木・日の週2回、P2〜P5 は木曜の週1回、10/28 が最後', () => {
  const daysWithLift = [];
  for (let t = d('2026-11-09'); t <= d('2027-11-14'); t.setDate(t.getDate() + 1)) {
    if (S.planFor(t, menus)) daysWithLift.push(new Date(t));
  }
  const byPhase = (id) => daysWithLift.filter((x) => Calc.getPhaseAndWeek(x, menus).phase.id === id);
  const dows = (xs) => [...new Set(xs.map((x) => x.getDay()))].sort();
  assert.deepEqual(dows(byPhase('p0')), [0, 4]);
  assert.equal(byPhase('p0').length, 6);  // 3週 × 2
  assert.deepEqual(dows(byPhase('p1')), [0, 4]);
  assert.equal(byPhase('p1').length, 26); // 13週 × 2
  for (const [id, weeks] of [['p2', 8], ['p3', 10], ['p4', 8], ['p5', 8]]) {
    assert.deepEqual(dows(byPhase(id)), [4], id);
    assert.equal(byPhase(id).length, weeks, id);
  }
  assert.deepEqual(byPhase('p6').map((x) => `${x.getMonth() + 1}/${x.getDate()}`), ['10/28']); // レース2週前で終了
  assert.equal(S.planFor(d('2026-11-10'), menus), null); // 火曜はやらない
});

test('P1: 1RMテストは軽めの週の木曜だけ', () => {
  const tests = [];
  for (let t = d('2026-11-09'); t <= d('2027-11-14'); t.setDate(t.getDate() + 1)) {
    const p = S.planFor(t, menus);
    if (p && p.test) tests.push(`${t.getMonth() + 1}/${t.getDate()}`);
  }
  assert.deepEqual(tests, ['12/17', '1/7', '1/28', '2/18']);
});

test('重さ(1RM 122.5kg): P0 と P1 ブロック1〜2', () => {
  const w = (date) => kgOf(date).work.map((x) => [x.kg, x.reps, x.sets]);
  assert.deepEqual(w('2026-11-12'), [[97.5, 3, 3]]);  // P0 木 80%
  assert.deepEqual(w('2026-11-15'), [[105, 3, 3]]);   // P0 日 85%
  const sun1 = kgOf('2026-12-06'); // P1 負荷週1の日曜
  assert.deepEqual(sun1.work.map((x) => [x.kg, x.reps, x.sets]), [[105, 3, 5]]);
  assert.deepEqual(sun1.work[0].plates, [20, 20, 2.5]);
  assert.equal(sun1.timing, 'ライドの後');
  const thu1 = kgOf('2026-12-03');
  assert.deepEqual(thu1.work.map((x) => [x.kg, x.reps, x.sets]), [[97.5, 3, 4]]);
  assert.match(thu1.timing, /夜/);
  assert.deepEqual(w('2026-12-13'), [[107.5, 3, 4]]);
  assert.deepEqual(w('2026-12-10'), [[100, 3, 4]]);
  assert.deepEqual(w('2026-12-20'), [[97.5, 2, 2]]);
  // ウォームアップ: バー → 40% → 60% → 75% → 85%
  assert.deepEqual(sun1.warmup.map((x) => [x.kg, x.reps]), [[20, 8], [50, 5], [72.5, 3], [92.5, 2], [105, 1]]);
});

test('重さ(1RM 122.5kg): 1RMテストの日', () => {
  const t = kgOf('2026-12-17');
  assert.equal(t.test, true);
  assert.deepEqual(t.warmup.map((w) => w.kg), [20, 50, 72.5, 92.5, 105, 112.5]);
  assert.deepEqual(t.attempts.map((a) => a.kg), [122.5, 125]);
  assert.deepEqual(t.attempts[0].plates, [20, 20, 10, 1.25]);
});

test('重さ(1RM 122.5kg): P1 ブロック3〜5・P2・P3・P6', () => {
  const w = (date) => kgOf(date).work.map((x) => [x.label, x.kg, x.reps, x.sets]);
  assert.deepEqual(w('2027-01-17'), [['', 107.5, 2, 5]]);       // P1 B3 負荷週1 日
  assert.deepEqual(w('2027-01-14'), [['', 100, 2, 4]]);         // P1 B3 負荷週1 木
  assert.deepEqual(w('2027-01-24'), [['', 112.5, 2, 3]]);       // P1 B3 負荷週2 日
  assert.deepEqual(w('2027-02-28'), [['', 107.5, 2, 5]]);       // P1 13週目(B5 負荷週1) 日
  assert.deepEqual(w('2027-03-04'), [['', 112.5, 2, 2]]);       // P2 負荷週1 木
  assert.deepEqual(w('2027-03-11'), [['トップシングル', 120, 1, 1], ['', 112.5, 1, 2]]); // P2 負荷週2 木
  assert.deepEqual(w('2027-04-29'), [['', 112.5, 1, 3]]);       // P3 負荷週1 木
  assert.deepEqual(w('2027-05-06'), [['', 117.5, 1, 2]]);       // P3 負荷週2 木
  assert.deepEqual(w('2027-10-28'), [['', 110, 1, 2]]);         // P6 最後
});

test('1RMが変わると重さも変わる', () => {
  const plan = S.planFor(d('2026-11-29'), menus); // P0 3週目の日曜: 85%
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
