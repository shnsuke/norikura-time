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

test('期の区切りと週数: P0 3 / P1 13 / P2 8 / P3 10 / P4 8 / P5 8 / P6 3 = 53週、レースは 2027/11/14', () => {
  const weeks = menus.phases.map((p) => Calc.getPhaseAndWeek(d(p.end), menus).totalWeeks);
  assert.deepEqual(weeks, [3, 13, 8, 10, 8, 8, 3]);
  assert.deepEqual(menus.phases.map((p) => p.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.equal(menus.phases[0].start, '2026-11-09');
  assert.equal(menus.raceDate, '2027-11-14');
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
  const after = Calc.getPhaseAndWeek(d('2027-11-15'), menus);
  assert.equal(after.status, 'after');
});

test('P1 冬季ベース: 3週1ブロック、3週目が軽めの週。13週目は5ブロック目の1週目', () => {
  const w1 = Calc.getPhaseAndWeek(d('2026-11-30'), menus);
  assert.equal(w1.phase.id, 'p1');
  assert.deepEqual([w1.week, w1.block, w1.weekInBlock, w1.isRecovery, w1.day], [1, 1, 1, false, 'mon']);
  const w3 = Calc.getPhaseAndWeek(d('2026-12-20'), menus); // 3週目の日曜
  assert.deepEqual([w3.week, w3.weekInBlock, w3.isRecovery, w3.day], [3, 3, true, 'sun']);
  const w4 = Calc.getPhaseAndWeek(d('2026-12-21'), menus);
  assert.deepEqual([w4.week, w4.block, w4.weekInBlock, w4.isRecovery], [4, 2, 1, false]);
  const last = Calc.getPhaseAndWeek(d('2027-02-28'), menus);
  assert.deepEqual([last.phase.id, last.week, last.block, last.weekInBlock, last.isRecovery], ['p1', 13, 5, 1, false]);
});

test('期の境界: P0・P2・P3・P6', () => {
  const p0 = Calc.getPhaseAndWeek(d('2026-11-09'), menus);
  assert.deepEqual([p0.phase.id, p0.week, p0.weekType, p0.isRecovery], ['p0', 1, 'week1', false]);
  const p2 = Calc.getPhaseAndWeek(d('2027-03-01'), menus);
  assert.deepEqual([p2.phase.id, p2.week, p2.block], ['p2', 1, 1]);
  const p3 = Calc.getPhaseAndWeek(d('2027-07-04'), menus);
  assert.deepEqual([p3.phase.id, p3.week, p3.block, p3.weekInBlock], ['p3', 10, 4, 1]);
  const race = Calc.getPhaseAndWeek(d('2027-11-14'), menus);
  assert.deepEqual([race.phase.id, race.week, race.weekType, race.day], ['p6', 3, 'week3', 'sun']);
  const ev = Calc.findDayMenu(race.phase, race, 'sun').menu;
  assert.deepEqual([ev.kind, ev.racePriority], ['event', 'A']);
});

test('メニュー検索: week{N} → block{B} → load{W} → load、軽めの週は recovery', () => {
  const p1 = menus.phases[1];
  const find = (date, day) => Calc.findDayMenu(p1, Calc.getPhaseAndWeek(d(date), menus), day);
  assert.equal(find('2026-12-03', 'thu').key, 'load');                 // ふだんの木曜 = Rattlesnake
  assert.match(find('2026-12-03', 'thu').menu.title, /Rattlesnake/);
  assert.equal(find('2027-02-04', 'thu').key, 'week10');               // 2月は A1 30/30 を交互に
  assert.match(find('2027-02-04', 'thu').menu.title, /A1 30\/30/);
  assert.equal(find('2027-02-27', 'sat').menu.kind, 'test');           // 2月末のテスト
  assert.equal(find('2026-12-19', 'sat').key, 'recovery');             // 軽めの週の土曜
  assert.equal(find('2026-12-19', 'mon'), null);                       // 月曜は休養
  // P3: 火曜は週ごとに V2 5×4分 と VO2 4×5分 を交互
  const p3 = menus.phases[3];
  assert.match(Calc.findDayMenu(p3, Calc.getPhaseAndWeek(d('2027-04-27'), menus), 'tue').menu.title, /5×4分/);
  assert.match(Calc.findDayMenu(p3, Calc.getPhaseAndWeek(d('2027-05-04'), menus), 'tue').menu.title, /4×5分/);
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
  const thu = menus.phases[1].templates.load.thu;
  const body = thu.segments.filter((s) => !['Z2', 'CD'].includes(s.label));
  const r = Calc.resolveMenu({ ...thu, segments: body }, 250, 60);
  assert.equal(r.totalSec, 44 * 60 + 45);
  const pcts = r.segments.filter((s) => s.type === 'interval').map((s) => s.work.pct[0]);
  assert.deepEqual(pcts, [120, 117, 114, 112, 110, 120, 117, 114, 112, 110]);
  // FTP 250W の 140% = 350W
  assert.deepEqual(r.segments.find((s) => s.label === 'セット1：入り').w, [350, 350]);
  // P2 以降は3セット
  const p2 = menus.phases[2].templates.load.thu.segments;
  assert.equal(p2.filter((s) => /：入り$/.test(s.label)).length, 3);
});

// ---------- 体重 ----------

test('週の月曜', () => {
  assert.equal(Calc.mondayOf(d('2026-10-28')).getDate(), 26); // 水曜 → 10/26(月)
  assert.equal(Calc.mondayOf(d('2026-11-02')).getDate(), 2); // 月曜はそのまま
  assert.equal(Calc.mondayOf(d('2026-11-08')).getDate(), 2); // 日曜 → その週の月曜
});

test('体重の計画: 減量しない。61〜62kg(62kg)を維持', () => {
  const flat = Calc.weightPlan(menus, 62);
  assert.ok(flat.every((p) => p.kg === 62));
  assert.equal(flat.length, 8); // 開始 + 7つの期の終わり
  // 62kg より重く始めた場合は P0 の終わり(11/29)までに 62kg、その後は維持
  const plan = Calc.weightPlan(menus, 63);
  assert.deepEqual(plan.slice(0, 2).map((p) => [p.date.getMonth() + 1, p.date.getDate(), p.kg]), [[11, 9, 63], [11, 29, 62]]);
  assert.equal(Calc.targetWeightAt(plan, d('2027-06-01')), 62);
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
  close(s.target, 62, 1e-9);
  close(s.diff, -0.1, 1e-9);
  close(s.recentPace, (61.9 - 62.0) / 4, 1e-9); // ちょうど4週前の 11/9 と比較
  close(s.lastChange, 0.1, 1e-9);
  assert.deepEqual(s.warnings, []);
  assert.equal(Calc.weightStats([], plan, menus), null);
});

test('体重の注意: 急な減量・維持の時期の減らしすぎ・計画より重い', () => {
  const plan = Calc.weightPlan(menus, 62);
  const fast = Calc.weightStats([{ date: d('2026-12-07'), kg: 62 }, { date: d('2026-12-14'), kg: 61.2 }], plan, menus);
  // 1週間で体重の1%超の減少。維持の時期でもあるので両方の注意が出る
  assert.deepEqual(fast.warnings.map((w) => w.code).sort(), ['fast-loss', 'maintain-deficit']);
  // 維持の時期: 2週で 0.9kg 減 → 注意
  const keep = Calc.weightStats([{ date: d('2027-05-03'), kg: 62.0 }, { date: d('2027-05-17'), kg: 61.1 }], plan, menus);
  assert.deepEqual(keep.warnings.map((w) => w.code), ['maintain-deficit']);
  // 63kg から始めて P0 で 62kg に向かう間は、維持の注意は出ない
  const losing = Calc.weightStats([{ date: d('2026-11-09'), kg: 63 }, { date: d('2026-11-23'), kg: 62.3 }], Calc.weightPlan(menus, 63), menus);
  assert.ok(!losing.warnings.some((w) => w.code === 'maintain-deficit'));
  const behind = Calc.weightStats([{ date: d('2027-03-01'), kg: 63.2 }], plan, menus);
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

test('menus.json: ローラー(火・水・木)にスプリントは入れない。強度メニューの目的は VO2max', () => {
  for (const phase of menus.phases) {
    for (const [key, days] of Object.entries(phase.templates)) {
      for (const day of ['tue', 'wed', 'thu']) {
        const menu = days[day];
        if (!menu) continue;
        const where = `${phase.name} ${key} ${day} ${menu.title}`;
        for (const seg of menu.segments) {
          assert.ok(!/スプリント/.test(seg.label), where);
          const pcts = [seg.pct, seg.work && seg.work.pct].filter((x) => x !== undefined).flat();
          assert.ok(pcts.every((x) => x < 180), `${where}: ${JSON.stringify(pcts)}`);
        }
        assert.ok(['vo2', 'z2', 'opener'].includes(menu.kind), `${where}: ${menu.kind}`);
      }
    }
  }
});

test('menus.json: テストと200kmシミュレーションの日(計画の日程どおり)', () => {
  const kindOn = (date) => {
    const info = Calc.getPhaseAndWeek(d(date), menus);
    const f = Calc.findDayMenu(info.phase, info, info.day);
    return f && `${f.menu.kind}:${f.menu.title}`;
  };
  for (const date of ['2026-11-28', '2027-02-27', '2027-04-24', '2027-04-25', '2027-07-31', '2027-08-01']) {
    assert.match(kindOn(date), /^test:/, date);
  }
  for (const date of ['2027-08-21', '2027-09-25', '2027-10-16']) assert.match(kindOn(date), /^race:R1 200km/, date);
  assert.match(kindOn('2027-09-25'), /9月末チェック/);
});

test('反復の「つなぎ」の名前は restLabel で変えられる(既定は「つなぎ」)', () => {
  const plain = Calc.resolveSegment({ label: 'SST', reps: 2, work: { pct: 90, min: 10 }, rest: { pct: 55, min: 5 } }, 300, 60);
  assert.equal(plain.restLabel, 'つなぎ');
  const attack = Calc.resolveSegment({ label: 'x', reps: 1, restFirst: true, restLabel: 'アタック', work: { pct: 115, min: 5 }, rest: { pct: 150, sec: 30 } }, 300, 60);
  assert.equal(attack.restLabel, 'アタック');
  assert.equal(attack.totalSec, 330);
});
