const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../calc.js');

const menus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menus.json'), 'utf8'));

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}±${tol}, got ${actual}`);

// ---------- FTP推定 ----------

test('完了条件の例: 体重63kg, P=330W, t=40分 → FTP≈323.4W (5.13W/kg)', () => {
  // 手計算: (40/60)^0.05 = exp(0.05 × ln(2/3)) = exp(−0.0202733) = 0.979931
  //         330 × 0.979931 = 323.377
  const ftp = Calc.ftpFromPower(330, 40);
  close(ftp, 323.377, 0.01);
  close(ftp / 63, 5.133, 0.001);
});

test('t=60分ならFTP=P、kを変えると結果が変わる', () => {
  assert.equal(Calc.ftpFromPower(300, 60), 300);
  close(Calc.ftpFromPower(330, 40, 0.07), 330 * Math.pow(40 / 60, 0.07), 1e-9);
  assert.ok(Calc.ftpFromPower(330, 40, 0.07) < Calc.ftpFromPower(330, 40, 0.05));
  // 20分: (1/3)^0.05 = 0.9466 → 20分×0.95 とほぼ同じになる
  close(Calc.ftpFromPower(300, 20) / 300, 0.9466, 0.0001);
});

test('20分×0.95 の参考値', () => {
  close(Calc.ftpFrom20min(330), 313.5, 1e-9);
});

test('所要時間 8〜60分の範囲外は警告', () => {
  assert.equal(Calc.durationWarning(8), null);
  assert.equal(Calc.durationWarning(60), null);
  assert.equal(Calc.durationWarning(40), null);
  assert.match(Calc.durationWarning(7.9), /8分未満/);
  assert.match(Calc.durationWarning(61), /60分を超え/);
});

test('不正な入力は例外', () => {
  assert.throws(() => Calc.ftpFromPower(0, 40), RangeError);
  assert.throws(() => Calc.ftpFromPower(330, -1), RangeError);
  assert.throws(() => Calc.ftpFromPower(NaN, 40), RangeError);
});

// ---------- モードB ----------

test('空気密度: 海面1.225、標高とともに低下', () => {
  assert.equal(Calc.airDensity(0), 1.225);
  assert.equal(Calc.airDensity(undefined), 1.225);
  assert.equal(Calc.airDensity(null), 1.225);
  close(Calc.airDensity(1000), 1.1117, 0.0005);
  close(Calc.airDensity(2000), 1.0066, 0.0005);
});

test('勾配: 道のりを斜辺として水平距離を求める', () => {
  const g = Calc.climbGeometry(10, 600);
  close(g.horizontalM, Math.sqrt(10000 ** 2 - 600 ** 2), 1e-9);
  close(g.theta, Math.asin(600 / 10000), 1e-12);
  close(g.gradePct, 6.0108, 0.0001);
  assert.throws(() => Calc.climbGeometry(1, 1000), RangeError);
  assert.throws(() => Calc.climbGeometry(10, -5), RangeError);
});

test('推定平均パワー: 式どおりに計算される', () => {
  const opts = { distanceKm: 10, gainM: 600, minutes: 40, riderKg: 63, avgAltM: 1000 };
  const r = Calc.estimatePower(opts);
  // 手計算
  const d = 10000, h = 600, t = 2400;
  const theta = Math.atan(h / Math.sqrt(d * d - h * h));
  const v = d / t;
  const rho = 1.225 * Math.pow(1 - 2.25577e-5 * 1000, 4.25588);
  const expected = (71 * 9.81 * v * (Math.sin(theta) + 0.004 * Math.cos(theta)) + 0.5 * rho * 0.32 * v ** 3) / 0.97;
  close(r.power, expected, 1e-9);
  close(r.power, 204.7, 0.1); // 重力+転がり 185.7W + 空気 12.9W = 198.6W → /0.97
  close(r.speedKmh, 15, 1e-9);
});

test('推定平均パワー: 詳細設定(自転車重量・CdA・Crr・駆動損失)が効く', () => {
  const base = { distanceKm: 10, gainM: 600, minutes: 40, riderKg: 63 };
  const p0 = Calc.estimatePower(base).power;
  assert.ok(Calc.estimatePower({ ...base, bikeKg: 9 }).power > p0);
  assert.ok(Calc.estimatePower({ ...base, cda: 0.25 }).power < p0);
  assert.ok(Calc.estimatePower({ ...base, crr: 0.006 }).power > p0);
  close(Calc.estimatePower({ ...base, drivetrainLoss: 0 }).power, p0 * 0.97, 1e-9);
});

test('タイム文字列のパース', () => {
  close(Calc.parseTime('40:30'), 40.5, 1e-9);
  close(Calc.parseTime('1:05:00'), 65, 1e-9);
  assert.equal(Calc.parseTime('45'), 45);
  assert.ok(Number.isNaN(Calc.parseTime('40:75')));
  assert.ok(Number.isNaN(Calc.parseTime('abc')));
  assert.ok(Number.isNaN(Calc.parseTime('')));
});

// ---------- 期・週の判定 ----------

const d = (s) => Calc.parseDate(s);

test('期の区切りと週数: 基礎12 / ビルド12 / 持久12 / 移行2 / 特異12 / ピーク4 = 54週、レースは 2027/11/14', () => {
  const weeks = menus.phases.map((p) => Calc.getPhaseAndWeek(d(p.end), menus).totalWeeks);
  assert.deepEqual(weeks, [12, 12, 12, 2, 12, 4]);
  assert.deepEqual(menus.phases.map((p) => p.id), ['base', 'build', 'endurance', 'transition', 'specific', 'peak']);
  assert.equal(menus.raceDate, '2027-11-14');
  assert.equal(menus.phases[menus.phases.length - 1].end, menus.raceDate);
  // 期と期の間に隙間がない
  for (let i = 1; i < menus.phases.length; i++) {
    assert.equal(Calc.daysBetween(d(menus.phases[i - 1].end), d(menus.phases[i].start)), 1, menus.phases[i].name);
  }
  // 期の開始日はすべて月曜
  for (const p of menus.phases) assert.equal(d(p.start).getDay(), 1, p.name);
});

test('シーズン前・後', () => {
  const before = Calc.getPhaseAndWeek(d('2026-10-28'), menus);
  assert.equal(before.status, 'before');
  assert.equal(before.daysUntilStart, 5);
  const after = Calc.getPhaseAndWeek(d('2027-11-15'), menus);
  assert.equal(after.status, 'after');
});

test('基礎期: 3週1ブロック、3週目が回復週', () => {
  const w1 = Calc.getPhaseAndWeek(d('2026-11-02'), menus);
  assert.equal(w1.phase.id, 'base');
  assert.deepEqual([w1.week, w1.block, w1.weekInBlock, w1.isRecovery, w1.day], [1, 1, 1, false, 'mon']);
  const w3 = Calc.getPhaseAndWeek(d('2026-11-22'), menus); // 3週目の日曜
  assert.deepEqual([w3.week, w3.weekInBlock, w3.isRecovery, w3.day], [3, 3, true, 'sun']);
  const w4 = Calc.getPhaseAndWeek(d('2026-11-23'), menus);
  assert.deepEqual([w4.week, w4.block, w4.weekInBlock, w4.isRecovery], [4, 2, 1, false]);
  const last = Calc.getPhaseAndWeek(d('2027-01-24'), menus);
  assert.deepEqual([last.phase.id, last.week, last.block, last.isRecovery], ['base', 12, 4, true]);
});

test('期の境界: ビルド期・持久期・移行期・特異期・ピーク期', () => {
  const b = Calc.getPhaseAndWeek(d('2027-01-25'), menus);
  assert.deepEqual([b.phase.id, b.week, b.block], ['build', 1, 1]);
  const e = Calc.getPhaseAndWeek(d('2027-07-11'), menus);
  assert.deepEqual([e.phase.id, e.week, e.block, e.isRecovery], ['endurance', 12, 4, true]);
  const t = Calc.getPhaseAndWeek(d('2027-07-12'), menus);
  assert.deepEqual([t.phase.id, t.week, t.weekType, t.isRecovery], ['transition', 1, 'week1', false]);
  const s = Calc.getPhaseAndWeek(d('2027-10-17'), menus);
  assert.deepEqual([s.phase.id, s.week, s.block, s.isRecovery], ['specific', 12, 4, true]);
  const p = Calc.getPhaseAndWeek(d('2027-10-18'), menus);
  assert.deepEqual([p.phase.id, p.week, p.weekType, p.isRecovery], ['peak', 1, 'week1', false]);
  const race = Calc.getPhaseAndWeek(d('2027-11-14'), menus);
  assert.deepEqual([race.phase.id, race.week, race.weekType, race.day], ['peak', 4, 'week4', 'sun']);
  assert.equal(Calc.findDayMenu(race.phase, race, 'sun').menu.kind, 'event');
});

test('メニュー検索: block{B} → load{W} → load、回復週は recovery', () => {
  const base = menus.phases[0];
  // 基礎期ブロック1の木曜 → load (3×15)
  let info = Calc.getPhaseAndWeek(d('2026-11-05'), menus);
  assert.equal(Calc.findDayMenu(base, info, 'thu').key, 'load');
  // 基礎期ブロック4の木曜 → block4 (2×30)
  info = Calc.getPhaseAndWeek(d('2027-01-07'), menus);
  assert.equal(info.block, 4);
  assert.equal(Calc.findDayMenu(base, info, 'thu').menu.title, 'SST 2×30分');
  assert.equal(Calc.findDayMenu(base, info, 'sat').key, 'load');
  // 回復週の土曜 → FTPテスト
  info = Calc.getPhaseAndWeek(d('2026-11-21'), menus);
  assert.equal(Calc.findDayMenu(base, info, 'sat').menu.title, 'FTPテスト（峠TT）');
  // 月曜は定義なし → null (休養)
  assert.equal(Calc.findDayMenu(base, info, 'mon'), null);

  // 持久期: 火曜は週ごとに 40/20 と 5分×4 を交互、木曜はブロック3から10本
  const end = menus.phases[2];
  const i1 = Calc.getPhaseAndWeek(d('2027-04-20'), menus);
  const i2 = Calc.getPhaseAndWeek(d('2027-04-27'), menus);
  assert.equal(Calc.findDayMenu(end, i1, 'tue').menu.title, '繰り返し 40/20');
  assert.equal(Calc.findDayMenu(end, i2, 'tue').menu.title, '5分×4（学校坂の強度）');
  assert.match(Calc.findDayMenu(end, Calc.getPhaseAndWeek(d('2027-04-22'), menus), 'thu').menu.title, /×8$/);
  assert.match(Calc.findDayMenu(end, Calc.getPhaseAndWeek(d('2027-06-03'), menus), 'thu').menu.title, /×10$/);
});

test('menus.json: 全期の負荷週・回復週で火木土のキーセッションが定義されている', () => {
  for (const phase of menus.phases) {
    const start = d(phase.start);
    const end = d(phase.end);
    for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
      const info = Calc.getPhaseAndWeek(t, menus);
      if (!['tue', 'thu', 'sat'].includes(info.day)) continue;
      const found = Calc.findDayMenu(phase, info, info.day);
      assert.ok(found, `${phase.name} ${info.week}週目 ${info.day} のメニューがありません`);
      // すべての区間が解決できる
      const r = Calc.resolveMenu(found.menu, 300, 60);
      assert.ok(r.totalSec > 0);
    }
  }
});

// ---------- %FTP → W ----------

test('5W単位の丸め', () => {
  assert.equal(Calc.roundTo5(287.4), 285);
  assert.equal(Calc.roundTo5(287.5), 290);
  assert.equal(Calc.roundTo5(292.6), 295);
});

test('強度の解決: 単一値と範囲', () => {
  const single = Calc.resolveIntensity(105, 323.4, 63);
  assert.deepEqual(single.w, [340, 340]); // 339.57 → 340
  close(single.wkg[0], 340 / 63, 1e-9);
  assert.equal(single.isRange, false);
  const range = Calc.resolveIntensity([88, 94], 323.4, 63);
  assert.deepEqual(range.w, [285, 305]); // 284.6 → 285, 304.0 → 305
  assert.equal(range.isRange, true);
});

test('区間の解決: 反復とセットの合計時間', () => {
  const sst = Calc.resolveSegment(
    { label: 'SST', reps: 3, work: { pct: [88, 94], min: 15 }, rest: { pct: 55, min: 5 } }, 300, 60);
  assert.equal(sst.totalSec, (45 + 10) * 60);
  assert.deepEqual(sst.work.w, [265, 280]);
  const thirtyFifteen = Calc.resolveSegment({
    label: '30/15', sets: 3, reps: 13,
    work: { pct: 120, sec: 30 }, rest: { pct: 50, sec: 15 }, setRest: { pct: 50, min: 5 },
  }, 300, 60);
  assert.equal(thirtyFifteen.totalSec, 3 * (13 * 30 + 12 * 15) + 2 * 300);
  const note = Calc.resolveSegment({ label: 'TT', note: '全力', min: 30 }, 300, 60);
  assert.equal(note.type, 'note');
  assert.equal(note.totalSec, 1800);
});

test('時間の表示', () => {
  assert.equal(Calc.formatDuration(30), '30秒');
  assert.equal(Calc.formatDuration(900), '15分');
  assert.equal(Calc.formatDuration(5400), '1時間30分');
  assert.equal(Calc.formatDuration(570), '9分30秒');
});

test('restFirst: (つなぎ→本番)×reps で合計時間を数える', () => {
  const s = Calc.resolveSegment(
    { label: '30/15', reps: 3, restFirst: true, work: { pct: 120, sec: 30 }, rest: { pct: 40, sec: 15 } }, 300, 60);
  assert.equal(s.restFirst, true);
  assert.equal(s.totalSec, 3 * 45);
  assert.deepEqual(s.work.w, [360, 360]);
  assert.deepEqual(s.rest.w, [120, 120]);
});

test('Rattlesnake: 2セットのワークアウト本体が44分45秒、%どおりにFTPから換算される', () => {
  const tue = menus.phases[0].templates.load.tue;
  const body = tue.segments.filter((s) => !['Z2', 'CD'].includes(s.label));
  const r = Calc.resolveMenu({ ...tue, segments: body }, 250, 60);
  assert.equal(r.totalSec, 44 * 60 + 45);
  const pcts = r.segments.filter((s) => s.type === 'interval').map((s) => s.work.pct[0]);
  assert.deepEqual(pcts, [120, 117, 114, 112, 110, 120, 117, 114, 112, 110]);
  // FTP 250W の 140% = 350W
  assert.deepEqual(r.segments.find((s) => s.label === 'セット1：入り').w, [350, 350]);
  // ビルド期は3セット
  const build = menus.phases[1].templates.load2.tue.segments;
  assert.equal(build.filter((s) => /：入り$/.test(s.label)).length, 3);
});

// ---------- 体重 ----------

test('週の月曜', () => {
  assert.equal(Calc.mondayOf(d('2026-10-28')).getDate(), 26); // 水曜 → 10/26(月)
  assert.equal(Calc.mondayOf(d('2026-11-02')).getDate(), 2); // 月曜はそのまま
  assert.equal(Calc.mondayOf(d('2026-11-08')).getDate(), 2); // 日曜 → その週の月曜
});

test('減量計画: 4月(4/18)に60kg、以降はレースまで60kgを維持', () => {
  const plan = Calc.weightPlan(menus, 63);
  assert.deepEqual(plan.map((p) => [p.date.getMonth() + 1, p.date.getDate(), p.kg]),
    [[11, 2, 63], [4, 18, 60], [7, 11, 60], [7, 25, 60], [10, 17, 60], [11, 14, 60]]);
  assert.equal(Calc.targetWeightAt(plan, d('2026-10-26')), 63);
  assert.equal(Calc.targetWeightAt(plan, d('2027-04-18')), 60);
  // 11/2〜4/18 は167日で3kg → 1/24(83日目)は 63 − 3×83/167
  close(Calc.targetWeightAt(plan, d('2027-01-24')), 63 - 3 * 83 / 167, 1e-9);
  assert.equal(Calc.targetWeightAt(plan, d('2027-06-01')), 60);
  assert.equal(Calc.targetWeightAt(plan, d('2027-11-14')), 60);
});

test('体重の集計: 目標との差・必要なペース・直近のペース', () => {
  const plan = Calc.weightPlan(menus, 63);
  const log = [
    { date: d('2026-11-02'), kg: 63.0 },
    { date: d('2026-11-09'), kg: 62.8 },
    { date: d('2026-11-16'), kg: 62.7 },
    { date: d('2026-11-23'), kg: 62.5 },
    { date: d('2026-11-30'), kg: 62.4 },
  ];
  const s = Calc.weightStats(log, plan, menus);
  assert.equal(s.latest.kg, 62.4);
  close(s.target, 63 - 3 * 28 / 167, 1e-9);
  close(s.diff, 62.4 - s.target, 1e-9);
  assert.equal(s.next.kg, 60);
  close(s.next.weeks, 139 / 7, 1e-9); // 11/30 → 4/18
  close(s.next.pacePerWeek, (60 - 62.4) / (139 / 7), 1e-9);
  close(s.recentPace, (62.4 - 63.0) / 4, 1e-9); // ちょうど4週前の 11/2 と比較
  close(s.lastChange, -0.1, 1e-9);
  assert.deepEqual(s.warnings, []);
  assert.equal(Calc.weightStats([], plan, menus), null);
});

test('体重の注意: 急な減量・維持の時期の減らしすぎ・計画より重い', () => {
  const plan = Calc.weightPlan(menus, 63);
  const fast = Calc.weightStats([{ date: d('2026-11-02'), kg: 63 }, { date: d('2026-11-09'), kg: 62.2 }], plan, menus);
  assert.deepEqual(fast.warnings.map((w) => w.code), ['fast-loss']);
  // 4/18 以降は維持の時期: 2週で 0.9kg 減 → 注意
  const keep = Calc.weightStats([{ date: d('2027-05-03'), kg: 60.4 }, { date: d('2027-05-17'), kg: 59.5 }], plan, menus);
  assert.deepEqual(keep.warnings.map((w) => w.code), ['maintain-deficit']);
  // 減量中の時期なら同じペースでも維持の注意は出ない
  const losing = Calc.weightStats([{ date: d('2026-12-07'), kg: 62.8 }, { date: d('2026-12-21'), kg: 62.1 }], plan, menus);
  assert.ok(!losing.warnings.some((w) => w.code === 'maintain-deficit'));
  // 3/1 の目標は 63 − 3×119/167 ≈ 60.86kg → 62.0kg は 1kg 以上重い
  const behind = Calc.weightStats([{ date: d('2027-03-01'), kg: 62.0 }], plan, menus);
  assert.deepEqual(behind.warnings.map((w) => w.code), ['behind']);
});

// ---------- セッションの種類 ----------

test('menus.json: すべてのメニューに kind があり、負荷週の火・木・土はキーセッション', () => {
  for (const phase of menus.phases) {
    for (const [key, days] of Object.entries(phase.templates)) {
      for (const [day, menu] of Object.entries(days)) {
        assert.ok(menu.kind in Calc.SESSION_KINDS, `${phase.name} ${key} ${day} の kind が不正: ${menu.kind}`);
      }
    }
  }
  for (const phase of menus.phases.filter((p) => p.blocks !== false)) {
    for (let t = d(phase.start); t <= d(phase.end); t.setDate(t.getDate() + 1)) {
      const info = Calc.getPhaseAndWeek(t, menus);
      if (info.isRecovery || !['tue', 'thu', 'sat'].includes(info.day)) continue;
      assert.ok(Calc.isKeySession(Calc.findDayMenu(phase, info, info.day).menu), `${phase.name} ${info.week}週目 ${info.day}`);
    }
  }
  // 回復週はキーセッションが木曜の1本だけ
  const rec = menus.phases[0].templates.recovery;
  assert.deepEqual(Object.keys(rec).filter((day) => Calc.isKeySession(rec[day])), ['thu']);
});

test('menus.json: 火曜・木曜のメニューはすべて 1時間15分以内', () => {
  for (const phase of menus.phases) {
    for (const [key, days] of Object.entries(phase.templates)) {
      for (const day of ['tue', 'thu']) {
        if (!days[day]) continue;
        const r = Calc.resolveMenu(days[day], 300, 60);
        assert.ok(r.totalSec <= 75 * 60, `${phase.name} ${key} ${day} ${days[day].title}: ${Calc.formatDuration(r.totalSec)}`);
      }
    }
  }
});

test('menus.json: 基礎期の負荷週の日曜は Z2 3時間45分(ほかの期は変えない)', () => {
  const min = (phaseIdx, key) => Calc.resolveMenu(menus.phases[phaseIdx].templates[key].sun, 300, 60).totalSec / 60;
  assert.equal(min(0, 'load'), 225);
  assert.equal(min(0, 'recovery'), 150);
  assert.equal(min(1, 'load'), 180);
});

test('menus.json: 特異期のレースシミュレーションはレースの順番どおり(普久川×2 → 学校坂 → 高江 → 羽地 → スプリント)', () => {
  const sat = menus.phases.find((p) => p.id === 'specific').templates.load.sat;
  const labels = sat.segments.map((s) => s.label);
  const order = ['普久川ダム1回目', '普久川ダム2回目', '学校坂', '高江のアップダウン', '羽地の登り', 'ゴールスプリント'];
  const idx = order.map((l) => labels.indexOf(l));
  assert.ok(idx.every((i) => i >= 0), JSON.stringify(labels));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
  // 学校坂は約5分、レース後半(3時間以上走ったあと)
  const gakko = sat.segments[labels.indexOf('学校坂')];
  assert.equal(gakko.min, 5);
  const before = sat.segments.slice(0, labels.indexOf('学校坂')).reduce((a, s) => a + (s.min || 0) + (s.sec || 0) / 60, 0);
  assert.ok(before >= 180, `${before}分`);
  assert.ok(Calc.resolveMenu(sat, 300, 60).totalSec >= 5 * 3600 - 60);
});

test('反復の「つなぎ」の名前は restLabel で変えられる(既定は「つなぎ」)', () => {
  const plain = Calc.resolveSegment({ label: 'SST', reps: 2, work: { pct: 90, min: 10 }, rest: { pct: 55, min: 5 } }, 300, 60);
  assert.equal(plain.restLabel, 'つなぎ');
  const attack = Calc.resolveSegment({ label: 'x', reps: 1, restFirst: true, restLabel: 'アタック', work: { pct: 115, min: 5 }, rest: { pct: 150, sec: 30 } }, 300, 60);
  assert.equal(attack.restLabel, 'アタック');
  assert.equal(attack.totalSec, 330);
});
