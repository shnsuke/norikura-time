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

test('期の区切りと週数: 12 / 12 / 15 / 4 週 = 43週', () => {
  const weeks = menus.phases.map((p) => Calc.getPhaseAndWeek(d(p.end), menus).totalWeeks);
  assert.deepEqual(weeks, [12, 12, 15, 4]);
  // 期の開始日はすべて月曜
  for (const p of menus.phases) assert.equal(d(p.start).getDay(), 1, p.name);
});

test('シーズン前・後', () => {
  const before = Calc.getPhaseAndWeek(d('2026-10-28'), menus);
  assert.equal(before.status, 'before');
  assert.equal(before.daysUntilStart, 5);
  const after = Calc.getPhaseAndWeek(d('2027-08-30'), menus);
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

test('期の境界: ビルド期・特異期・ピーク期', () => {
  const b = Calc.getPhaseAndWeek(d('2027-01-25'), menus);
  assert.deepEqual([b.phase.id, b.week, b.block], ['build', 1, 1]);
  const s = Calc.getPhaseAndWeek(d('2027-08-01'), menus);
  assert.deepEqual([s.phase.id, s.week, s.block, s.isRecovery], ['specific', 15, 5, true]);
  const p = Calc.getPhaseAndWeek(d('2027-08-02'), menus);
  assert.deepEqual([p.phase.id, p.week, p.weekType, p.isRecovery], ['peak', 1, 'week1', false]);
  const race = Calc.getPhaseAndWeek(d('2027-08-29'), menus);
  assert.deepEqual([race.phase.id, race.week, race.weekType, race.day], ['peak', 4, 'week4', 'sun']);
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

  // 特異期: 火曜は週ごとに 30/15 と 4〜6分走を交互
  const spec = menus.phases[2];
  const i1 = Calc.getPhaseAndWeek(d('2027-04-20'), menus);
  const i2 = Calc.getPhaseAndWeek(d('2027-04-27'), menus);
  assert.equal(Calc.findDayMenu(spec, i1, 'tue').menu.title, 'VO2 30/15');
  assert.equal(Calc.findDayMenu(spec, i2, 'tue').menu.title, 'VO2 4〜6分走');
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

// ---------- 乗鞍の予想タイム ----------

test('乗鞍コース: 20.5km・標高差1260m', () => {
  const segs = Calc.NORIKURA_COURSE.segments;
  close(segs.reduce((a, s) => a + s.distanceKm, 0), 20.5, 1e-9);
  assert.equal(segs.reduce((a, s) => a + (s.endElevM - s.startElevM), 0), 1260);
});

test('speedForPower は estimatePower の逆関数になっている', () => {
  const seg = { distanceKm: 8.3, gainM: 480, avgAltM: 2110, riderKg: 63 };
  const v = Calc.speedForPower({ ...seg, powerW: 300 });
  const minutes = (8300 / v) / 60;
  close(Calc.estimatePower({ ...seg, minutes }).power, 300, 1e-6);
});

test('予想タイム(高地補正なし): パワーとタイムが FTP 推定の式と釣り合う', () => {
  const r = Calc.predictClimb({ ftp: 323.4, riderKg: 63, altitude: false });
  // 予想した平均パワーと所要時間を FTP 推定に戻すと元の FTP になる
  close(Calc.ftpFromPower(r.powerW, r.totalSec / 60), 323.4, 0.01);
  close(r.totalSec, 56 * 60 + 42, 3); // 56:42
  close(r.wkg, 5.15, 0.01);
  close(r.altitudeLossPct, 0, 1e-9);
  // 区間タイムの合計 = 全体
  close(r.segments.reduce((a, s) => a + s.sec, 0), r.totalSec, 1e-6);
});

test('高地のパワー低下: Bassett et al. (1999) の式', () => {
  close(Calc.altitudePowerFactor(0), 1, 1e-12);
  close(Calc.altitudePowerFactor(2000), 0.87564, 1e-9); // 0.178·8 − 1.43·4 − 4.07·2 + 100
  close(Calc.altitudePowerFactor(2000, true), 0.916348, 1e-9); // 99.921 − 1.122·4 − 1.8991·2
  assert.ok(Calc.altitudePowerFactor(2720) < Calc.altitudePowerFactor(1460));
  assert.ok(Calc.altitudePowerFactor(2500, true) > Calc.altitudePowerFactor(2500, false));
});

test('予想タイム(高地補正あり): 標高が上がるほど区間のパワーが下がり、補正なしより遅い', () => {
  const opts = { ftp: 315, riderKg: 63 };
  const flat = Calc.predictClimb({ ...opts, altitude: false });
  const alt = Calc.predictClimb(opts);
  const accl = Calc.predictClimb({ ...opts, acclimatized: true });
  const fromHill = Calc.predictClimb({ ...opts, ftpAltM: 500 });
  assert.ok(alt.totalSec > accl.totalSec && accl.totalSec > flat.totalSec);
  assert.ok(fromHill.totalSec < alt.totalSec); // FTPを標高500mで測っていれば低下は小さい
  const p = alt.segments.map((s) => s.powerW);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
  // 1区間目(1460〜1870m)の平均パワーは基準パワー × その標高帯の係数の範囲に入る
  assert.ok(p[0] < alt.basePowerW * Calc.altitudePowerFactor(1460) && p[0] > alt.basePowerW * Calc.altitudePowerFactor(1870));
  close(alt.altitudeLossPct, (1 - alt.powerW / alt.basePowerW) * 100, 1e-9);
  close(alt.totalSec, 65 * 60 + 34, 3); // 1:05:34
});

test('予想タイム: 体重が軽い・FTPが高いほど速い', () => {
  const base = Calc.predictClimb({ ftp: 300, riderKg: 63 }).totalSec;
  assert.ok(Calc.predictClimb({ ftp: 300, riderKg: 58 }).totalSec < base);
  assert.ok(Calc.predictClimb({ ftp: 320, riderKg: 63 }).totalSec < base);
  assert.ok(Calc.predictClimb({ ftp: 300, riderKg: 63, bikeKg: 7 }).totalSec < base);
});

test('時刻表示', () => {
  assert.equal(Calc.formatClock(56 * 60 + 42), '56:42');
  assert.equal(Calc.formatClock(3600 + 5 * 60 + 3), '1:05:03');
});

// ---------- 体重 ----------

test('週の月曜', () => {
  assert.equal(Calc.mondayOf(d('2026-10-28')).getDate(), 26); // 水曜 → 10/26(月)
  assert.equal(Calc.mondayOf(d('2026-11-02')).getDate(), 2); // 月曜はそのまま
  assert.equal(Calc.mondayOf(d('2026-11-08')).getDate(), 2); // 日曜 → その週の月曜
});

test('減量計画: 下限値で 1/24 に60kg、4/18 に58kg、以降は58kgを維持', () => {
  const plan = Calc.weightPlan(menus, 63);
  assert.deepEqual(plan.map((p) => [p.date.getMonth() + 1, p.date.getDate(), p.kg]),
    [[11, 2, 63], [1, 24, 60], [4, 18, 58], [8, 1, 58], [8, 29, 58]]);
  assert.equal(Calc.targetWeightAt(plan, d('2026-10-26')), 63);
  assert.equal(Calc.targetWeightAt(plan, d('2027-01-24')), 60);
  // 11/2〜1/24 は83日で3kg → 中間の日は 63 − 3×(41/83)
  close(Calc.targetWeightAt(plan, d('2026-12-13')), 63 - 3 * 41 / 83, 1e-9);
  assert.equal(Calc.targetWeightAt(plan, d('2027-06-01')), 58);
  assert.equal(Calc.targetWeightAt(plan, d('2027-09-30')), 58);
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
  close(s.target, 63 - 3 * 28 / 83, 1e-9);
  close(s.diff, 62.4 - s.target, 1e-9);
  assert.equal(s.next.kg, 60);
  close(s.next.weeks, 55 / 7, 1e-9); // 11/30 → 1/24
  close(s.next.pacePerWeek, (60 - 62.4) / (55 / 7), 1e-9);
  close(s.recentPace, (62.4 - 63.0) / 4, 1e-9); // ちょうど4週前の 11/2 と比較
  close(s.lastChange, -0.1, 1e-9);
  assert.deepEqual(s.warnings, []);
  assert.equal(Calc.weightStats([], plan, menus), null);
});

test('体重の注意: 急な減量・特異期の減らしすぎ・計画より重い', () => {
  const plan = Calc.weightPlan(menus, 63);
  const fast = Calc.weightStats([{ date: d('2026-11-02'), kg: 63 }, { date: d('2026-11-09'), kg: 62.2 }], plan, menus);
  assert.deepEqual(fast.warnings.map((w) => w.code), ['fast-loss']);
  const spec = Calc.weightStats([{ date: d('2027-05-03'), kg: 59.5 }, { date: d('2027-05-17'), kg: 58.6 }], plan, menus);
  assert.deepEqual(spec.warnings.map((w) => w.code), ['specific-deficit']);
  const behind = Calc.weightStats([{ date: d('2027-01-18'), kg: 61.5 }], plan, menus);
  assert.deepEqual(behind.warnings.map((w) => w.code), ['behind']);
});
