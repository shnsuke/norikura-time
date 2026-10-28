/*
 * 峠TT → FTP推定 / 期分けメニュー の計算ロジック。
 * DOMに依存しない純粋関数のみ。ブラウザでは window.Calc、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 9.81;
  const RHO_SEA_LEVEL = 1.225;

  const DEFAULTS = Object.freeze({
    bikeKg: 8.0,
    cda: 0.32,
    crr: 0.004,
    drivetrainLoss: 0.03, // 3%
    k: 0.05,
  });

  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
  const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  function assertPositive(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new RangeError(`${name} は正の数で指定してください`);
    }
  }

  // ---------- FTP推定 ----------

  /** FTP = P × (t / 60)^k */
  function ftpFromPower(powerW, minutes, k = DEFAULTS.k) {
    assertPositive('平均パワー', powerW);
    assertPositive('所要時間', minutes);
    if (typeof k !== 'number' || !Number.isFinite(k)) throw new RangeError('k が不正です');
    return powerW * Math.pow(minutes / 60, k);
  }

  /** 参考値: 20分パワー × 0.95 */
  function ftpFrom20min(powerW) {
    assertPositive('平均パワー', powerW);
    return powerW * 0.95;
  }

  /** 8〜60分の範囲外なら警告文、範囲内なら null */
  function durationWarning(minutes) {
    if (minutes < 8) return '所要時間が8分未満です。無酸素の寄与が大きく、FTPを過大評価しやすくなります。';
    if (minutes > 60) return '所要時間が60分を超えています。FTPを過小評価しやすくなります。';
    return null;
  }

  // ---------- モードB: タイムから平均パワー推定 ----------

  /** 標準大気による空気密度 (kg/m³)。altM 未指定なら海面値 */
  function airDensity(altM) {
    if (altM === undefined || altM === null || Number.isNaN(altM)) return RHO_SEA_LEVEL;
    return RHO_SEA_LEVEL * Math.pow(1 - 2.25577e-5 * altM, 4.25588);
  }

  /**
   * 距離(道のり, km)と獲得標高(m)から平均勾配を求める。
   * 道のりを斜辺とみなし、水平距離 = √(d² − h²)、θ = atan(h / 水平距離)。
   */
  function climbGeometry(distanceKm, gainM) {
    assertPositive('距離', distanceKm);
    if (typeof gainM !== 'number' || !Number.isFinite(gainM) || gainM < 0) {
      throw new RangeError('獲得標高は0以上で指定してください');
    }
    const d = distanceKm * 1000;
    if (gainM >= d) throw new RangeError('獲得標高が距離を超えています');
    const horizontalM = Math.sqrt(d * d - gainM * gainM);
    const theta = Math.atan(gainM / horizontalM);
    return { distanceM: d, horizontalM, theta, gradePct: (gainM / horizontalM) * 100 };
  }

  /**
   * P = [ m総·g·v·(sinθ + Crr·cosθ) + 0.5·ρ·CdA·v³ ] / (1 − 駆動損失)
   * opts: { distanceKm, gainM, minutes, riderKg, bikeKg, cda, crr, drivetrainLoss, avgAltM }
   */
  function estimatePower(opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    assertPositive('体重', o.riderKg);
    assertPositive('所要時間', o.minutes);
    const geo = climbGeometry(o.distanceKm, o.gainM);
    const v = geo.distanceM / (o.minutes * 60);
    const rho = airDensity(o.avgAltM);
    const mass = o.riderKg + o.bikeKg;
    const gravityRolling = mass * G * v * (Math.sin(geo.theta) + o.crr * Math.cos(geo.theta));
    const aero = 0.5 * rho * o.cda * Math.pow(v, 3);
    const power = (gravityRolling + aero) / (1 - o.drivetrainLoss);
    return {
      power,
      speedMs: v,
      speedKmh: v * 3.6,
      rho,
      gradePct: geo.gradePct,
      theta: geo.theta,
      gravityRollingW: gravityRolling,
      aeroW: aero,
    };
  }

  /** "mm:ss" / "h:mm:ss" / "mm" を分(小数)に変換。不正なら NaN */
  function parseTime(str) {
    if (typeof str !== 'string') return NaN;
    const s = str.trim();
    if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return NaN;
    const parts = s.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return NaN;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }

  // ---------- 期・週の判定 ----------

  /** "YYYY-MM-DD" → ローカル時刻の Date (00:00) */
  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** ローカル日付同士の差(日)。夏時間の影響を受けないよう UTC に揃えて比較 */
  function daysBetween(a, b) {
    const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  }

  /**
   * date が menus の何期・何週目かを判定する。
   * 戻り値 status: 'before' | 'in' | 'after'
   * ブロック制の期: block(1始まり), weekInBlock(1〜blockWeeks), isRecovery
   * ブロック制でない期(ピーク期): weekType = 'week{N}'
   */
  function getPhaseAndWeek(date, menus) {
    const phases = menus.phases;
    const blockWeeks = menus.blockWeeks || 3;
    const day = DAY_KEYS[date.getDay()];
    const first = parseDate(phases[0].start);
    const last = parseDate(phases[phases.length - 1].end);
    if (daysBetween(date, first) > 0) {
      return { status: 'before', day, daysUntilStart: daysBetween(date, first) };
    }
    if (daysBetween(last, date) > 0) {
      return { status: 'after', day, daysSinceEnd: daysBetween(last, date) };
    }
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const start = parseDate(p.start);
      const end = parseDate(p.end);
      if (daysBetween(start, date) >= 0 && daysBetween(date, end) >= 0) {
        const weekIndex = Math.floor(daysBetween(start, date) / 7); // 0始まり
        const totalWeeks = Math.ceil((daysBetween(start, end) + 1) / 7);
        const result = {
          status: 'in',
          day,
          phaseIndex: i,
          phase: p,
          week: weekIndex + 1,
          totalWeeks,
        };
        if (p.blocks === false) {
          result.weekType = `week${weekIndex + 1}`;
          result.isRecovery = false;
        } else {
          result.block = Math.floor(weekIndex / blockWeeks) + 1;
          result.weekInBlock = (weekIndex % blockWeeks) + 1;
          result.isRecovery = result.weekInBlock === blockWeeks;
          result.weekType = result.isRecovery ? 'recovery' : 'load';
        }
        return result;
      }
    }
    // 期と期の間に隙間がある場合
    return { status: 'gap', day };
  }

  /**
   * 期・週・曜日からその日のメニューを探す。曜日単位で次の順に最初に見つかったものを使う。
   *   ブロック制・負荷週  : block{B} → load{W} → load
   *   ブロック制・回復週  : block{B}Recovery → recovery
   *   ピーク期(blocks:false): week{N}
   */
  function templateChain(phase, info) {
    if (phase.blocks === false) return [`week${info.week}`];
    if (info.isRecovery) return [`block${info.block}Recovery`, 'recovery'];
    return [`block${info.block}`, `load${info.weekInBlock}`, 'load'];
  }

  function findDayMenu(phase, info, day) {
    const templates = phase.templates || {};
    for (const key of templateChain(phase, info)) {
      if (templates[key] && templates[key][day]) return { key, menu: templates[key][day] };
    }
    return null;
  }

  // ---------- %FTP → W 変換 ----------

  function roundTo5(w) {
    return Math.round(w / 5) * 5;
  }

  /** pct (数値 or [下限, 上限]) を W / W/kg に変換 */
  function resolveIntensity(pct, ftp, weightKg) {
    const range = Array.isArray(pct) ? pct : [pct, pct];
    const w = range.map((p) => roundTo5((ftp * p) / 100));
    const wkg = weightKg > 0 ? w.map((x) => x / weightKg) : null;
    return { pct: range, w, wkg, isRange: range[0] !== range[1] };
  }

  /** {min, sec} → 秒 */
  function durationSec(d) {
    return (d.min || 0) * 60 + (d.sec || 0);
  }

  /**
   * 区間を表示用に解決する。区間の書式:
   *   単一: { label, pct, min | sec }
   *   反復: { label, reps, work: {pct, min|sec}, rest?: {pct, min|sec}, restFirst?, sets?, setRest?: {pct, min|sec} }
   *   メモ: { label, note }  (パワー無し)
   */
  function resolveSegment(seg, ftp, weightKg) {
    if (seg.work) {
      const reps = seg.reps || 1;
      const sets = seg.sets || 1;
      const work = { ...resolveIntensity(seg.work.pct, ftp, weightKg), sec: durationSec(seg.work) };
      const rest = seg.rest ? { ...resolveIntensity(seg.rest.pct, ftp, weightKg), sec: durationSec(seg.rest) } : null;
      const setRest = seg.setRest && sets > 1
        ? { ...resolveIntensity(seg.setRest.pct, ftp, weightKg), sec: durationSec(seg.setRest) }
        : null;
      // 1セット = work×reps + rest×(reps−1)。restFirst なら (rest→work)×reps。セット間休息は sets−1 回
      const restFirst = !!(seg.restFirst && rest);
      const perSet = work.sec * reps + (rest ? rest.sec * (restFirst ? reps : reps - 1) : 0);
      const totalSec = perSet * sets + (setRest ? setRest.sec * (sets - 1) : 0);
      return { type: 'interval', label: seg.label, note: seg.note, reps, sets, restFirst, work, rest, setRest, totalSec };
    }
    if (seg.pct === undefined) {
      return { type: 'note', label: seg.label, note: seg.note, totalSec: durationSec(seg) };
    }
    return {
      type: 'steady',
      label: seg.label,
      note: seg.note,
      ...resolveIntensity(seg.pct, ftp, weightKg),
      totalSec: durationSec(seg),
    };
  }

  function resolveMenu(menu, ftp, weightKg) {
    const segments = (menu.segments || []).map((s) => resolveSegment(s, ftp, weightKg));
    const totalSec = segments.reduce((a, s) => a + s.totalSec, 0);
    return { title: menu.title, notes: menu.notes || [], segments, totalSec };
  }

  /** 秒 → "1時間30分" / "45分" / "30秒" */
  function formatDuration(sec) {
    if (sec < 60) return `${Math.round(sec)}秒`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    let out = '';
    if (h) out += `${h}時間`;
    if (m) out += `${m}分`;
    if (s) out += `${s}秒`;
    return out;
  }

  return {
    DEFAULTS,
    DAY_KEYS,
    DAY_LABELS,
    WEEK_ORDER,
    ftpFromPower,
    ftpFrom20min,
    durationWarning,
    airDensity,
    climbGeometry,
    estimatePower,
    parseTime,
    parseDate,
    daysBetween,
    getPhaseAndWeek,
    templateChain,
    findDayMenu,
    roundTo5,
    resolveIntensity,
    resolveSegment,
    resolveMenu,
    formatDuration,
  };
});
