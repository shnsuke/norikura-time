const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');
const S = require('../strength.js');
const Races = require('../races.js');
const Intervals = require('../intervals.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));
const d = (s) => Calc.parseDate(s);
const baseMenu = (date) => {
  const info = Calc.getPhaseAndWeek(d(date), menus);
  const f = Calc.findDayMenu(info.phase, info, info.day);
  return f ? f.menu : null;
};
const menuOn = (date, races) => Races.applyRaces(baseMenu(date), d(date), races, menus);

test('優先度 C: レースの日だけ切り替え、前の日は変えない(テーパーなし)', () => {
  const races = [{ date: '2027-05-16', name: '練習レース', priority: 'C' }]; // 日曜
  const race = menuOn('2027-05-16', races);
  assert.deepEqual([race.kind, race.racePriority, race.title], ['event', 'C', 'レース：練習レース']);
  for (const date of ['2027-05-13', '2027-05-14', '2027-05-15']) {
    assert.deepEqual(menuOn(date, races), baseMenu(date), date);
  }
});

test('優先度 B: 3日前からテーパー。休養日は休養のまま', () => {
  const races = [{ date: '2027-06-13', name: '西日本ロード', priority: 'B' }]; // 日曜
  const thu = menuOn('2027-06-10', races); // 3日前
  assert.equal(thu.kind, 'opener');
  assert.equal(thu.title, 'テーパー：短い VO2 刺激（西日本ロードの3日前）');
  assert.deepEqual(thu.taper, { race: '西日本ロード', daysBefore: 3 });
  assert.equal(menuOn('2027-06-11', races), null); // 2日前は金曜 = 休養のまま
  assert.equal(menuOn('2027-06-12', races).title, 'テーパー：前日の刺激入れ（西日本ロードの前日）');
  assert.deepEqual(menuOn('2027-06-09', races), baseMenu('2027-06-09')); // 4日前は変えない
  assert.equal(menuOn('2027-06-13', races).racePriority, 'B');
  // 土曜のレースなら 水=3日前、木=2日前、金=前日(休養のまま)
  const sat = [{ date: '2027-05-22', name: 'クリテ', priority: 'B' }];
  assert.match(menuOn('2027-05-19', sat).title, /^テーパー：短い VO2 刺激/);
  assert.match(menuOn('2027-05-20', sat).title, /^テーパー：Z2 45分/);
  assert.equal(menuOn('2027-05-21', sat), null);
});

test('休養日(月曜)にもレースを入れられる。近いレースのテーパーが優先', () => {
  const races = [{ date: '2027-05-03', name: '祝日レース', priority: 'C' }];
  assert.equal(baseMenu('2027-05-03'), null);
  assert.equal(menuOn('2027-05-03', races).kind, 'event');
  const two = [{ date: '2027-06-13', name: '遠い', priority: 'B' }, { date: '2027-06-12', name: '近い', priority: 'B' }];
  assert.match(menuOn('2027-06-10', two).title, /近いの2日前/);
});

test('テーパーのメニューもローラーのルール(スプリントなし)を守り、強度判定の対象外', () => {
  for (const [n, m] of Object.entries(menus.races.taper)) {
    assert.equal(m.kind, 'opener', n);
    for (const seg of m.segments) {
      const pcts = [seg.pct, seg.work && seg.work.pct].filter((x) => x !== undefined).flat();
      assert.ok(pcts.every((x) => x < 180), n);
    }
    assert.ok(!Calc.isKeySession(m));
  }
});

test('デッドリフト: レースの日は無し、B のテーパー中は重量70%で1RMテストもしない', () => {
  const st = menus.strength;
  // P1 の 12/20(日) にレース → その日のデッドリフトは無し
  const plan = S.planFor(d('2026-12-20'), menus);
  assert.ok(plan);
  assert.equal(Races.adjustStrength(plan, d('2026-12-20'), [{ date: '2026-12-20', name: 'x', priority: 'C' }], menus), null);
  // C のレースの前は変えない
  assert.equal(Races.adjustStrength(S.planFor(d('2026-12-17'), menus), d('2026-12-17'), [{ date: '2026-12-19', name: 'x', priority: 'C' }], menus).test, true);
  // B のレース(12/19 土)の2日前 = 12/17(木)の1RMテスト → テストせず軽く
  const t = Races.adjustStrength(S.planFor(d('2026-12-17'), menus), d('2026-12-17'), [{ date: '2026-12-19', name: 'ロード', priority: 'B' }], menus);
  assert.equal(t.test, false);
  assert.match(t.taperNote, /重量70%/);
  // 通常の日は各セットの % を 70% に: P3 5/13(木) 92.5%×1×3 → 64.75% → 1RM 122.5 で 80kg
  const thu = Races.adjustStrength(S.planFor(d('2027-04-29'), menus), d('2027-04-29'), [{ date: '2027-05-02', name: 'ロード', priority: 'B' }], menus);
  assert.deepEqual(S.resolvePlan(thu, 122.5, st).work.map((w) => [w.kg, w.reps, w.sets]), [[80, 1, 3]]);
});

test('予定の作成: レースは RACE_B/C、テーパーの日も登録。レースを外す日付はテーパーの範囲ごと', () => {
  const races = [{ date: '2027-06-13', name: '西日本ロード', priority: 'B' }, { date: '2027-05-03', name: '祝日レース', priority: 'C' }];
  const ev = Intervals.buildEvents(menus, d('2027-05-03'), d('2027-06-13'), (m, date) => Races.applyRaces(m, date, races, menus));
  const on = (date) => ev.find((e) => e.start_date_local.startsWith(date));
  assert.deepEqual([on('2027-05-03').category, on('2027-05-03').type, on('2027-05-03').name], ['RACE_C', 'Ride', 'レース：祝日レース']);
  assert.equal(on('2027-06-13').category, 'RACE_B');
  assert.match(on('2027-06-10').name, /テーパー/);
  assert.equal(on('2027-06-11'), undefined); // 金曜は休養のまま
  assert.deepEqual(Races.affectedDates(races[0], menus).map((x) => x.getDate()), [10, 11, 12, 13]);
});
