/*
 * Google ドライブへの保存・一覧・読み込み(Drive API v3)。
 * 権限は drive.file(このアプリが作ったファイルだけ)。アクセストークンは Google Identity Services で取得する。
 * ブラウザでは window.GDrive、Node では module.exports で使う(テストでは fetch を差し替える)。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GDrive = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  // ---------- アクセストークン(ブラウザのみ) ----------

  let gisPromise = null;
  /** Google Identity Services のスクリプトを読み込む(ボタンを押す前に読んでおくとポップアップが止められにくい) */
  function loadGis() {
    if (typeof window === 'undefined') return Promise.reject(new Error('ブラウザでのみ使えます'));
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = GIS_SRC;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gisPromise = null; reject(new Error('Google のログイン画面を読み込めませんでした。ネットワーク接続を確認してください。')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  let cached = null; // { clientId, token, expiresAt }

  /**
   * アクセストークンを取得する。ボタンのタップの中から呼ぶこと(ポップアップのため)。
   * 一度許可していれば、2回目以降は確認画面が一瞬出るだけで終わる。
   */
  async function getToken(clientId) {
    if (!clientId) throw new Error('Google のクライアント ID が設定されていません。');
    if (cached && cached.clientId === clientId && cached.expiresAt - Date.now() > 60 * 1000) return cached.token;
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        prompt: '',
        callback: (res) => {
          if (res.error) { reject(new Error(`Google の許可が得られませんでした（${res.error}）。`)); return; }
          cached = { clientId, token: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
          resolve(res.access_token);
        },
        error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'Google の画面が閉じられました。' : 'Google の画面を開けませんでした（ポップアップがブロックされた可能性があります）。')),
      });
      client.requestAccessToken();
    });
  }

  // ---------- Drive API ----------

  async function call(fetchImpl, token, url, opts = {}) {
    const res = await fetchImpl(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) cached = null;
      throw new Error(`Google ドライブが ${res.status} を返しました${text ? `：${text.slice(0, 160)}` : ''}`);
    }
    return opts.raw ? res.text() : res.json();
  }

  const q = (s) => encodeURIComponent(s);
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  /** 専用フォルダの ID(無ければ作る)。knownId があればそれが残っているか確かめて使う */
  async function ensureFolder(token, name, knownId, fetchImpl = fetch) {
    if (knownId) {
      try {
        const f = await call(fetchImpl, token, `${API}/files/${q(knownId)}?fields=id,trashed`);
        if (f && f.id && !f.trashed) return f.id;
      } catch (e) { /* 消えていたら作り直す */ }
    }
    const found = await call(fetchImpl, token,
      `${API}/files?q=${q(`name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id)&spaces=drive`);
    if (found.files && found.files.length) return found.files[0].id;
    const created = await call(fetchImpl, token, `${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    return created.id;
  }

  /** フォルダに JSON を保存する。同じ名前のファイルがあれば中身を上書き(同じ日に2回取っても1つ) */
  async function saveJson(token, folderId, name, obj, fetchImpl = fetch) {
    const body = JSON.stringify(obj, null, 2);
    const same = await call(fetchImpl, token,
      `${API}/files?q=${q(`name='${esc(name)}' and '${folderId}' in parents and trashed=false`)}&fields=files(id)&spaces=drive`);
    if (same.files && same.files.length) {
      return call(fetchImpl, token, `${UPLOAD}/files/${q(same.files[0].id)}?uploadType=media&fields=id,name,modifiedTime`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      });
    }
    const boundary = `ttftp${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    return call(fetchImpl, token, `${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
    });
  }

  /** フォルダ内のバックアップ一覧(新しい順) */
  async function listJson(token, folderId, fetchImpl = fetch) {
    const r = await call(fetchImpl, token,
      `${API}/files?q=${q(`'${folderId}' in parents and trashed=false`)}&orderBy=name desc&pageSize=200&fields=files(id,name,modifiedTime,size)&spaces=drive`);
    return (r.files || []).filter((f) => /\.json$/.test(f.name));
  }

  /** ファイルの中身を JSON として読む */
  async function readJson(token, fileId, fetchImpl = fetch) {
    const text = await call(fetchImpl, token, `${API}/files/${q(fileId)}?alt=media`, { raw: true });
    return JSON.parse(text);
  }

  return { SCOPE, loadGis, getToken, ensureFolder, saveJson, listJson, readJson };
});
