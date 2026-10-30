const { test } = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../calc.js');
const B = require('../backup.js');
const G = require('../gdrive.js');

const d = (s) => Calc.parseDate(s);
const sample = () => ({
  settings: { weight: 62.4, ftpOverride: 315, icuKey: 'SECRET', googleClientId: 'cid.apps.googleusercontent.com', maxHr: 190 },
  history: [{ id: 'a', date: '2026-11-21', ftp: 320 }],
  weightLog: [{ date: '2026-11-02', kg: 63 }],
  sessionLog: { '2026-11-03': { rpe: 7, result: 'done' } },
  adjustments: { 'base:2': { kinds: { vo2: 2 }, z2Pct: 0 } },
  oneRmLog: [{ date: '2026-11-19', kg: 125 }],
  backup: { lastDate: '2026-11-02', folderId: 'F1' },
  tab: 'menu',
});

test('バックアップ: API キー・Google の接続情報・バックアップ状態は含めない', () => {
  const b = B.buildBackup(sample(), new Date(2026, 10, 2, 7, 30));
  assert.equal(b.app, 'ttftp');
  assert.equal(b.version, 1);
  assert.equal(b.date, '2026-11-02');
  assert.equal(b.data.settings.icuKey, undefined);
  assert.equal(b.data.settings.googleClientId, undefined);
  assert.equal(b.data.backup, undefined);
  assert.equal(b.data.settings.maxHr, 190);
  assert.deepEqual(b.data.oneRmLog, [{ date: '2026-11-19', kg: 125 }]);
  assert.ok(!JSON.stringify(b).includes('SECRET'));
  assert.deepEqual(B.summary(b), { tt: 1, weight: 1, sessions: 1, oneRm: 1, adjustments: 1 });
  assert.equal(B.fileName(new Date(2026, 10, 2)), 'ttftp-backup-2026-11-02.json');
});

test('検証: このアプリのバックアップ以外・壊れたもの・新しすぎる形式は受け付けない', () => {
  const ok = B.buildBackup(sample());
  assert.equal(B.validate(ok), null);
  assert.match(B.validate(null), /JSON/);
  assert.match(B.validate({ app: 'other', version: 1, data: { settings: {} } }), /このアプリのバックアップではありません/);
  assert.match(B.validate({ ...ok, version: 99 }), /新しい形式/);
  assert.match(B.validate({ ...ok, data: { settings: {}, history: 'x' } }), /history/);
  assert.match(B.validate({ ...ok, data: {} }), /壊れています/);
});

test('復元: 中身はバックアップのもの、API キー・Google の接続情報・バックアップ状態は今の端末のまま', () => {
  const b = B.buildBackup(sample());
  const current = { settings: { icuKey: 'NEWKEY', googleClientId: 'cid2', weight: 70 }, history: [], backup: { lastDate: '2026-12-07', folderId: 'F9' } };
  const next = B.restore(current, b);
  assert.equal(next.settings.weight, 62.4);
  assert.equal(next.settings.icuKey, 'NEWKEY');
  assert.equal(next.settings.googleClientId, 'cid2');
  assert.deepEqual(next.backup, { lastDate: '2026-12-07', folderId: 'F9' });
  assert.equal(next.history.length, 1);
  assert.throws(() => B.restore(current, { app: 'x' }), /このアプリのバックアップではありません/);
});

test('今週のバックアップが必要か(月曜はじまり)', () => {
  assert.equal(B.isDue(null, d('2026-11-02')), true);
  assert.equal(B.isDue('2026-11-02', d('2026-11-02')), false); // 月曜に取った
  assert.equal(B.isDue('2026-11-02', d('2026-11-08')), false); // 同じ週の日曜
  assert.equal(B.isDue('2026-11-02', d('2026-11-09')), true);  // 次の月曜
  assert.equal(B.isDue('2026-11-05', d('2026-11-12')), true);  // 先週の木曜に取った → 今週はまだ
  assert.equal(B.isDue('2026-11-10', d('2026-11-12')), false);
});

// ---------- Google ドライブ(fetch を差し替え) ----------

function fakeDrive() {
  const files = []; // { id, name, parents, mimeType, body }
  let n = 0;
  const calls = [];
  const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => (typeof o === 'string' ? o : JSON.stringify(o)) });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', auth: opts.headers && opts.headers.Authorization });
    const u = new URL(url);
    const qs = u.searchParams.get('q') || '';
    if (u.pathname.endsWith('/files') && !u.pathname.includes('/upload/') && (opts.method || 'GET') === 'GET') {
      const name = (qs.match(/name='([^']+)'/) || [])[1];
      const parent = (qs.match(/'([^']+)' in parents/) || [])[1];
      const folderOnly = qs.includes("mimeType='application/vnd.google-apps.folder'");
      let r = files.filter((f) => (!name || f.name === name) && (!parent || (f.parents || []).includes(parent)) && (!folderOnly || f.mimeType.includes('folder')));
      if (u.searchParams.get('orderBy') === 'name desc') r = r.sort((a, b) => (a.name < b.name ? 1 : -1));
      return json({ files: r.map(({ id, name: nm }) => ({ id, name: nm })) });
    }
    if (u.pathname === '/drive/v3/files' && opts.method === 'POST') {
      const meta = JSON.parse(opts.body);
      const f = { id: `id${++n}`, ...meta };
      files.push(f);
      return json({ id: f.id });
    }
    if (u.pathname.endsWith('/upload/drive/v3/files') && opts.method === 'POST') {
      const meta = JSON.parse(opts.body.split('\r\n\r\n')[1].split('\r\n')[0]);
      const body = opts.body.split('\r\n\r\n')[2].split('\r\n--')[0];
      const f = { id: `id${++n}`, ...meta, body };
      files.push(f);
      return json({ id: f.id, name: f.name });
    }
    const m = u.pathname.match(/\/files\/([^/]+)$/);
    if (m && opts.method === 'PATCH') {
      const f = files.find((x) => x.id === decodeURIComponent(m[1]));
      f.body = opts.body;
      return json({ id: f.id, name: f.name });
    }
    if (m && u.searchParams.get('alt') === 'media') {
      const f = files.find((x) => x.id === decodeURIComponent(m[1]));
      return json(f.body);
    }
    if (m) {
      const f = files.find((x) => x.id === decodeURIComponent(m[1]));
      return f ? json({ id: f.id, trashed: false }) : json('not found', 404);
    }
    return json('unexpected', 500);
  };
  return { files, calls, fetchImpl };
}

test('ドライブ: 専用フォルダを作り、バックアップを保存・一覧・読み込みできる', async () => {
  const drv = fakeDrive();
  const folder = await G.ensureFolder('T', B.FOLDER_NAME, null, drv.fetchImpl);
  assert.equal(drv.files.filter((f) => f.mimeType.includes('folder')).length, 1);
  assert.equal(await G.ensureFolder('T', B.FOLDER_NAME, null, drv.fetchImpl), folder); // 2回目は作らない
  assert.equal(await G.ensureFolder('T', B.FOLDER_NAME, folder, drv.fetchImpl), folder);
  assert.equal(await G.ensureFolder('T', B.FOLDER_NAME, 'gone', drv.fetchImpl), folder); // 消えていたら探し直す

  const b1 = B.buildBackup(sample(), new Date(2026, 10, 2));
  await G.saveJson('T', folder, B.fileName(new Date(2026, 10, 2)), b1, drv.fetchImpl);
  await G.saveJson('T', folder, B.fileName(new Date(2026, 10, 9)), b1, drv.fetchImpl);
  // 同じ日に2回保存しても1ファイル(上書き)
  const b2 = { ...b1, data: { ...b1.data, settings: { ...b1.data.settings, weight: 61.9 } } };
  await G.saveJson('T', folder, B.fileName(new Date(2026, 10, 9)), b2, drv.fetchImpl);
  const list = await G.listJson('T', folder, drv.fetchImpl);
  assert.deepEqual(list.map((f) => f.name), ['ttftp-backup-2026-11-09.json', 'ttftp-backup-2026-11-02.json']);
  const back = await G.readJson('T', list[0].id, drv.fetchImpl);
  assert.equal(back.data.settings.weight, 61.9);
  assert.equal(B.validate(back), null);
  assert.ok(drv.calls.every((c) => c.auth === 'Bearer T'));
});

test('ドライブ: エラーはステータス付きのメッセージにする', async () => {
  const failing = async () => ({ ok: false, status: 403, text: async () => 'insufficientPermissions' });
  await assert.rejects(G.listJson('T', 'F', failing), /403.*insufficientPermissions/);
});
