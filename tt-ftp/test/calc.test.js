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

test('期の区切りと週数: P0 2 / P1 12 / P2 12 / P3 12 / P4 4 = 42週、レースは 2027/8/29', () => {
  const weeks = menus.phases.map((p) => Calc.getPhaseAndWeek(d(p.end), menus).totalWeeks);
  assert.deepEqual(weeks, [2, 12, 12, 12, 4]);
  assert.deepEqual(menus.phases.map((p) => p.id), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(menus.phases[0].start, '2026-11-09');
  assert.equal(menus.raceDate, '2027-08-29');
  assert.equal(menus.raceName, '乗鞍ヒルクライム');
  assert.equal(menus.phases[menus.phases.length - 1].end, menus.raceDate);
  // 期と期の間に隙間がなく、どの期も月曜に始まる
  for (let i = 1; i < menus.phases.length; i++) {
    assert.equal(Calc.daysBetween(d(menus.phases[i - 1].end), d(menus.phases[i].start)), 1, menus.phases[i].name);
  }
  for (const p of menus.phases) assert.equal(d(p.start).getDay(), 1, p.name);
});

test('シーズン前・後', () => {
  const before = Calc.getPhaseAndWeek(d('2026-11-02'), menus);
  assert.equal(before.status, 'before');
  assert.equal(before.daysUntilStart, 7);
  const after = Calc.getPhaseAndWeek(d('2027-08-30'), menus);
  assert.equal(after.status, 'after');
});

test('P1 基礎: 3週1ブロック、3週目が回復週。回復週は計画の W5・W8・W11・W14', () => {
  const w1 = Calc.getPhaseAndWeek(d('2026-11-23'), menus);
  assert.equal(w1.phase.id, 'p1');
  assert.deepEqual([w1.week, w1.block, w1.weekInBlock, w1.isRecovery, w1.day], [1, 1, 1, false, 'mon']);
  const w3 = Calc.getPhaseAndWeek(d('2026-12-13'), menus); // 3週目の日曜
  assert.deepEqual([w3.week, w3.weekInBlock, w3.isRecovery, w3.day], [3, 3, true, 'sun']);
  const w4 = Calc.getPhaseAndWeek(d('2026-12-14'), menus);
  assert.deepEqual([w4.week, w4.block, w4.weekInBlock, w4.isRecovery], [4, 2, 1, false]);
  const last = Calc.getPhaseAndWeek(d('2027-02-14'), menus);
  assert.deepEqual([last.phase.id, last.week, last.block, last.weekInBlock, last.isRecovery], ['p1', 12, 4, 3, true]);
  // 全期間の回復週の月曜(計画の一覧どおり)
  const recovery = [];
  for (let t = d('2026-11-09'); t <= d('2027-08-29'); t.setDate(t.getDate() + 7)) {
    if (Calc.getPhaseAndWeek(t, menus).isRecovery) recovery.push(`${t.getMonth() + 1}/${t.getDate()}`);
  }
  assert.deepEqual(recovery, ['12/7', '12/28', '1/18', '2/8', '3/1', '3/22', '4/12', '5/3', '5/24', '6/14', '7/5', '7/26']);
});

test('期の境界: P0・P2・P3・P4', () => {
  const p0 = Calc.getPhaseAndWeek(d('2026-11-09'), menus);
  assert.deepEqual([p0.phase.id, p0.week, p0.weekType, p0.isRecovery], ['p0', 1, 'week1', false]);
  const p2 = Calc.getPhaseAndWeek(d('2027-02-15'), menus);
  assert.deepEqual([p2.phase.id, p2.week, p2.block], ['p2', 1, 1]);
  const p3 = Calc.getPhaseAndWeek(d('2027-08-01'), menus);
  assert.deepEqual([p3.phase.id, p3.week, p3.block, p3.weekInBlock], ['p3', 12, 4, 3]);
  const race = Calc.getPhaseAndWeek(d('2027-08-29'), menus);
  assert.deepEqual([race.phase.id, race.week, race.weekType, race.day], ['p4', 4, 'week4', 'sun']);
  const ev = Calc.findDayMenu(race.phase, race, 'sun').menu;
  assert.deepEqual([ev.kind, ev.racePriority], ['event', 'A']);
});

test('メニュー検索: week{N} → block{B} → load{W} → load、回復週は recovery', () => {
  const titleOn = (date) => {
    const info = Calc.getPhaseAndWeek(d(date), menus);
    const f = Calc.findDayMenu(info.phase, info, info.day);
    return f && [f.key, f.menu.title];
  };
  // P1: 火は Rattlesnake×2、木の SST は 3×15 → 3×20 → 2×30
  assert.deepEqual(titleOn('2026-11-24'), ['load', 'VO2維持（Rattlesnake×2）']);
  assert.deepEqual(titleOn('2026-11-26'), ['load', 'SST 3×15分']);
  assert.deepEqual(titleOn('2026-12-17'), ['block2', 'SST 3×20分']);
  assert.deepEqual(titleOn('2027-01-07'), ['block3', 'SST 2×30分']);
  assert.match(titleOn('2026-11-25')[1], /低ケイデンス/);                 // 水曜
  assert.equal(titleOn('2026-12-12')[0], 'recovery');                     // 回復週の土曜 = テスト
  assert.equal(titleOn('2026-12-07'), null);                              // 月曜は休養
  // P2: 火は 5×5分 と Rattlesnake×3 を週ごとに交互。木は 2×20分 → オーバーアンダー
  assert.match(titleOn('2027-02-16')[1], /5×5分/);
  assert.match(titleOn('2027-02-23')[1], /Rattlesnake×3/);
  assert.match(titleOn('2027-02-18')[1], /閾値 2×20分/);
  assert.match(titleOn('2027-04-01')[1], /オーバーアンダー 3×12分/);
  // 2月中の土曜はローラー、3月から実坂
  assert.match(titleOn('2027-02-20')[1], /ローラー 2×25分/);
  assert.match(titleOn('2027-03-13')[1], /実坂 2×30分/);
  // P3: 火は Rattlesnake と 4×6分 を交互、木は 45分 → 60分、土はレースシミュレーション
  assert.match(titleOn('2027-05-11')[1], /Rattlesnake/);
  assert.match(titleOn('2027-05-18')[1], /4×6分/);
  assert.match(titleOn('2027-05-13')[1], /1×45分/);
  assert.match(titleOn('2027-06-24')[1], /1×60分/);
  assert.match(titleOn('2027-05-15')[1], /レースシミュレーション/);
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
  const tue = menus.phases[1].templates.load.tue;
  const body = tue.segments.filter((s) => !['Z2', 'CD'].includes(s.label));
  const r = Calc.resolveMenu({ ...tue, segments: body }, 250, 60);
  assert.equal(r.totalSec, 44 * 60 + 45);
  const pcts = r.segments.filter((s) => s.type === 'interval').map((s) => s.work.pct[0]);
  assert.deepEqual(pcts, [120, 117, 114, 112, 110, 120, 117, 114, 112, 110]);
  // FTP 250W の 140% = 350W
  assert.deepEqual(r.segments.find((s) => s.label === 'セット1：入り').w, [350, 350]);
  // 計画の暫定 FTP 305W: ハードスタート 425W、30秒は 365 → 335W
  const plan = Calc.resolveMenu(tue, 305, 62).segments;
  assert.deepEqual(plan.find((s) => s.label === 'セット1：入り').w, [425, 425]);
  assert.deepEqual(plan.filter((s) => s.type === 'interval').slice(0, 5).map((s) => s.work.w[0]), [365, 355, 350, 340, 335]);
  // P2 以降は3セット
  const p2 = menus.phases[2].templates.load2.tue.segments;
  assert.equal(p2.filter((s) => /：入り$/.test(s.label)).length, 3);
});

// ---------- 体重 ----------

test('週の月曜', () => {
  assert.equal(Calc.mondayOf(d('2026-10-28')).getDate(), 26); // 水曜 → 10/26(月)
  assert.equal(Calc.mondayOf(d('2026-11-02')).getDate(), 2); // 月曜はそのまま
  assert.equal(Calc.mondayOf(d('2026-11-08')).getDate(), 2); // 日曜 → その週の月曜
});

test('体重の計画: 62kg → 2月中旬に60kg → 4月末に58kg → 本番まで維持', () => {
  const plan = Calc.weightPlan(menus, 62);
  assert.deepEqual(plan.map((p) => [p.date.getMonth() + 1, p.date.getDate(), p.kg]),
    [[11, 9, 62], [11, 22, 62], [2, 14, 60], [4, 30, 58], [5, 9, 58], [8, 1, 58], [8, 29, 58]]);
  assert.equal(Calc.targetWeightAt(plan, d('2026-11-15')), 62);
  close(Calc.targetWeightAt(plan, d('2027-01-03')), 61, 1e-9); // P1 のちょうど真ん中
  assert.equal(Calc.targetWeightAt(plan, d('2027-05-05')), 58); // 4月末に届いたあとは維持
  assert.equal(Calc.targetWeightAt(plan, d('2027-08-29')), 58);
  // P1 の減量ペースは週 0.15kg 程度
  close((62 - 60) / (Calc.daysBetween(d('2026-11-22'), d('2027-02-14')) / 7), 0.167, 0.01);
});

test('体重の集計: 目標との差・直近のペース', () => {
  const plan = Calc.weightPlan(menus, 62);
  const log = [
    { date: d('2026-11-09'), kg: 62.0 },
    { date: d('2026-11-16'), kg: 62.3 },
    { date: d('2026-11-23'), kg: 62.1 },
    { date: d('2026-11-30'), kg: 61.8 },
    { date: d('2026-12-07'), kg: 61.9 },
  ];
  const s = Calc.weightStats(log, plan, menus);
  assert.equal(s.latest.kg, 61.9);
  close(s.target, 62 - (2 * 15) / 84, 1e-9); // 11/22 から15日、84日で2kg
  close(s.diff, 61.9 - s.target, 1e-9);
  close(s.recentPace, (61.9 - 62.0) / 4, 1e-9); // ちょうど4週前の 11/9 と比較
  close(s.lastChange, 0.1, 1e-9);
  assert.deepEqual(s.warnings, []);
  assert.deepEqual([s.next.date.getMonth() + 1, s.next.date.getDate(), s.next.kg], [2, 14, 60]);
  assert.equal(Calc.weightStats([], plan, menus), null);
});

test('体重の注意: 急な減量・維持の時期の減らしすぎ・計画より重い', () => {
  const plan = Calc.weightPlan(menus, 62);
  // 減量の時期でも、1週間で体重の1%超の減少は注意
  const fast = Calc.weightStats([{ date: d('2026-12-07'), kg: 62 }, { date: d('2026-12-14'), kg: 61.2 }], plan, menus);
  assert.deepEqual(fast.warnings.map((w) => w.code), ['fast-loss']);
  // 維持の時期(58kg に届いたあとの特異期): 2週で 0.9kg 減 → 注意
  const keep = Calc.weightStats([{ date: d('2027-05-31'), kg: 58.4 }, { date: d('2027-06-14'), kg: 57.5 }], plan, menus);
  assert.deepEqual(keep.warnings.map((w) => w.code), ['maintain-deficit']);
  // 減量の時期(P2)に同じペースで減っても、維持の注意は出ない
  const losing = Calc.weightStats([{ date: d('2027-03-01'), kg: 59.9 }, { date: d('2027-03-15'), kg: 59.0 }], plan, menus);
  assert.ok(!losing.warnings.some((w) => w.code === 'maintain-deficit'));
  const behind = Calc.weightStats([{ date: d('2027-03-01'), kg: 61.0 }], plan, menus);
  assert.deepEqual(behind.warnings.map((w) => w.code), ['behind']);
});

// ---------- セッションの種類 ----------

test('menus.json: すべてのメニューに kind があり、負荷週の火・木・土はキーセッション(テストの日を除く)', () => {
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
      const menu = Calc.findDayMenu(phase, info, info.day).menu;
      assert.ok(Calc.isKeySession(menu) || menu.kind === 'test', `${phase.name} ${info.week}週目 ${info.day}`);
    }
  }
  // 軽めの週はキーセッションが木曜の1本だけ
  const rec = menus.phases[1].templates.recovery;
  assert.deepEqual(Object.keys(rec).filter((day) => Calc.isKeySession(rec[day])), ['thu']);
});

test('menus.json: 火曜・木曜のメニューはすべて 1時間15分以内(朝のローラーは 1.5h まで)', () => {
  for (const phase of menus.phases) {
    for (const [key, days] of Object.entries(phase.templates)) {
      for (const day of ['tue', 'wed', 'thu']) {
        if (!days[day]) continue;
        const r = Calc.resolveMenu(days[day], 300, 60);
        const limit = day === 'wed' ? 90 : 75;
        assert.ok(r.totalSec <= limit * 60, `${phase.name} ${key} ${day} ${days[day].title}: ${Calc.formatDuration(r.totalSec)}`);
      }
    }
  }
});

test('menus.json: キーセッションは 火 = VO2max、木 = SST・閾値、土 = 実走(負荷週)', () => {
  for (const phase of menus.phases.filter((p) => p.blocks !== false)) {
    for (let t = d(phase.start); t <= d(phase.end); t.setDate(t.getDate() + 1)) {
      const info = Calc.getPhaseAndWeek(t, menus);
      if (info.isRecovery) continue;
      const found = Calc.findDayMenu(phase, info, info.day);
      const where = `${phase.name} ${info.week}週目 ${info.day}`;
      if (info.day === 'tue') assert.equal(found.menu.kind, 'vo2', where);
      if (info.day === 'thu') assert.ok(['sst', 'threshold'].includes(found.menu.kind), where);
      if (info.day === 'wed' || info.day === 'sun') assert.equal(found.menu.kind, 'z2', where);
      if (info.day === 'mon' || info.day === 'fri') assert.equal(found, null, where);
    }
  }
});

test('menus.json: テスト・チェックポイントの日(計画の日程どおり)', () => {
  const kindOn = (date) => {
    const info = Calc.getPhaseAndWeek(d(date), menus);
    const f = Calc.findDayMenu(info.phase, info, info.day);
    return f && `${f.menu.kind}:${f.menu.title}|${(f.menu.notes || []).join(' ')}`;
  };
  assert.match(kindOn('2026-11-21'), /^test:20分テスト/);
  assert.match(kindOn('2027-02-13'), /^test:20分テスト.*FTP 315W・体重 60kg/);
  assert.match(kindOn('2027-05-08'), /^test:実坂TT 40分以上.*FTP 330W・体重 58kg/);
  assert.match(kindOn('2027-06-19'), /^test:地元峠TT 55分前後/);
  assert.match(kindOn('2027-07-17'), /^test:地元峠TT.*FTP 340W前後/);
  assert.match(kindOn('2027-07-24'), /^race:乗鞍試走/);
  assert.match(kindOn('2027-08-08'), /^test:最終TT/);
  // 回復週の週末はテスト(7/10 と 7/31 は直後に峠TT・最終TTがあるので Z2)
  for (const date of ['2026-12-12', '2027-01-02', '2027-01-23', '2027-03-06', '2027-03-27', '2027-04-17', '2027-05-29']) {
    assert.match(kindOn(date), /^test:/, date);
  }
  for (const date of ['2027-07-10', '2027-07-31']) assert.match(kindOn(date), /^z2:/, date);
  // 設定タブに出すチェックポイントの日は、すべてテストか試走の日
  for (const c of menus.goals.checkpoints) assert.match(kindOn(c.date), /^(test|race):/, c.date);
});

test('レースシミュレーション: 55分、10・25・40分で1分のペースアップ(130%)、ラスト3分全開', () => {
  const sat = menus.phases[3].templates.load.sat;
  const sim = sat.segments.slice(1, -1);
  let t = 0;
  const ups = [];
  for (const s of sim) {
    if (s.label === 'ペースアップ') { ups.push(t); assert.equal(s.pct, 130); assert.equal(s.min, 1); }
    t += s.min;
  }
  assert.equal(t, 55);
  assert.deepEqual(ups, [10, 25, 40]);
  assert.equal(sim[sim.length - 1].label, 'ラスト3分全開');
  assert.deepEqual(sim[0].pct, [98, 100]);
  // FTP 305W で 130% = 395W
  assert.deepEqual(Calc.resolveSegment(sim[1], 305, 58).w, [395, 395]);
});

test('オーバーアンダー: 2分 95% → 1分 108% を4回で1本12分、3本', () => {
  const ou = menus.phases[2].templates.block3.thu.segments[1];
  const r = Calc.resolveSegment(ou, 300, 60);
  assert.equal(r.totalSec, 3 * 12 * 60 + 2 * 5 * 60);
  assert.equal(r.restLabel, 'アンダー');
  assert.deepEqual([r.rest.pct[0], r.work.pct[0]], [95, 108]);
});

test('反復の「つなぎ」の名前は restLabel で変えられる(既定は「つなぎ」)', () => {
  const plain = Calc.resolveSegment({ label: 'SST', reps: 2, work: { pct: 90, min: 10 }, rest: { pct: 55, min: 5 } }, 300, 60);
  assert.equal(plain.restLabel, 'つなぎ');
  const attack = Calc.resolveSegment({ label: 'x', reps: 1, restFirst: true, restLabel: 'アタック', work: { pct: 115, min: 5 }, rest: { pct: 150, sec: 30 } }, 300, 60);
  assert.equal(attack.restLabel, 'アタック');
  assert.equal(attack.totalSec, 330);
});

test('menus.json: P0 リセットは低強度だけ(Z2＋短いスプリント)、2週目の土曜に20分テスト', () => {
  const t = menus.phases.find((p) => p.id === 'p0').templates;
  for (const w of ['week1', 'week2']) {
    for (const day of ['tue', 'wed', 'thu', 'sun']) assert.equal(t[w][day].kind, 'z2', `${w} ${day}`);
    const sprint = t[w].tue.segments.find((s) => s.label === 'スプリント');
    assert.deepEqual([sprint.reps, sprint.work.sec], [6, 10]);
  }
  assert.equal(t.week1.sat.kind, 'z2');
  assert.equal(t.week2.sat.kind, 'test');
  const hours = (w) => Object.values(t[w]).reduce((a, m) => a + Calc.resolveMenu(m, 300, 60).totalSec, 0) / 3600;
  assert.ok(hours('week1') >= 7 && hours('week1') <= 9);
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


test('予想タイム: 計画の仮定(高地で一律 −6%)と、目標タイムに必要な FTP', () => {
  const opts = { riderKg: 58, fixedLossPct: 6 };
  const r = Calc.predictClimb({ ...opts, ftp: 344 });
  close(r.altitudeLossPct, 6, 1e-9);
  // 計画: 58kg・海抜FTP 約344W で 53分台(コースレコード 53:46 級)
  close(r.totalSec, 53 * 60 + 46, 15);
  // 逆算: 目標タイムに必要な FTP。55分は 53:46 より低く、体重が重いほど高い
  const need5346 = Calc.ftpForClimbTime(Calc.parseTime('53:46'), opts);
  close(need5346, 344, 2);
  const need55 = Calc.ftpForClimbTime(55, opts);
  assert.ok(need55 < need5346 && need55 > 325 && need55 < 340, String(need55));
  close(Calc.predictClimb({ ...opts, ftp: need55 }).totalSec, 55 * 60, 0.5);
  // 減量1kgは約5W分
  close((Calc.ftpForClimbTime(55, { ...opts, riderKg: 62 }) - need55) / 4, 5, 1);
  // 一律の仮定は、標高に応じた式(順応なし)より低下が小さい
  assert.ok(r.totalSec < Calc.predictClimb({ riderKg: 58, ftp: 344 }).totalSec);
});
