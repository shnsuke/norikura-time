/*
 * バックアップの中身: アプリの保存データを JSON にまとめる/検証する/復元する。
 * intervals.icu の API キーと Google の接続情報は含めない(復元しても今の端末の値を残す)。
 * ブラウザでは window.Backup、Node では module.exports で使う。
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Calc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backup = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  const APP = 'ttftp';
  const VERSION = 1;
  const FOLDER_NAME = '峠TTプランナー バックアップ';
  // 端末ごとの値: バックアップに入れず、復元しても上書きしない
  const DEVICE_SETTINGS = ['icuKey', 'googleClientId'];
  const DEVICE_KEYS = ['backup'];

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** 保存データからバックアップを作る */
  function buildBackup(state, now = new Date()) {
    const data = JSON.parse(JSON.stringify(state));
    for (const k of DEVICE_KEYS) delete data[k];
    if (data.settings) for (const k of DEVICE_SETTINGS) delete data.settings[k];
    return { app: APP, version: VERSION, createdAt: now.toISOString(), date: iso(now), data };
  }

  const fileName = (date) => `ttftp-backup-${iso(date)}.json`;

  /** 読み込んだ JSON がこのアプリのバックアップか確かめる。問題が無ければ null、あれば理由 */
  function validate(obj) {
    if (!obj || typeof obj !== 'object') return 'JSON ではありません。';
    if (obj.app !== APP) return 'このアプリのバックアップではありません。';
    if (typeof obj.version !== 'number' || obj.version > VERSION) return 'このアプリより新しい形式のバックアップです。アプリを更新してから復元してください。';
    const d = obj.data;
    if (!d || typeof d !== 'object' || !d.settings || typeof d.settings !== 'object') return 'バックアップの中身が壊れています。';
    for (const k of ['history', 'weightLog', 'oneRmLog']) {
      if (d[k] !== undefined && !Array.isArray(d[k])) return `バックアップの中身が壊れています（${k}）。`;
    }
    return null;
  }

  /** 中身の件数(復元前の確認用) */
  function summary(obj) {
    const d = obj.data || {};
    return {
      tt: (d.history || []).length,
      weight: (d.weightLog || []).length,
      sessions: Object.keys(d.sessionLog || {}).length,
      oneRm: (d.oneRmLog || []).length,
      adjustments: Object.keys(d.adjustments || {}).length,
    };
  }

  /** バックアップから新しい保存データを作る。端末ごとの値は今のものを残す */
  function restore(current, obj) {
    const err = validate(obj);
    if (err) throw new Error(err);
    const next = JSON.parse(JSON.stringify(obj.data));
    next.settings = next.settings || {};
    for (const k of DEVICE_SETTINGS) {
      if (current.settings && current.settings[k] !== undefined) next.settings[k] = current.settings[k];
    }
    for (const k of DEVICE_KEYS) if (current[k] !== undefined) next[k] = current[k];
    return next;
  }

  /**
   * 今週(月曜はじまり)のバックアップが済んでいなければ true。
   * lastDate: 最後にバックアップした日 'YYYY-MM-DD'
   */
  function isDue(lastDate, today = new Date()) {
    if (!lastDate) return true;
    const monday = Calc.mondayOf(today);
    return Calc.daysBetween(Calc.parseDate(lastDate), monday) > 0;
  }

  return { APP, VERSION, FOLDER_NAME, buildBackup, fileName, validate, summary, restore, isDue };
});
