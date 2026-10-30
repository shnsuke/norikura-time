/* 画面の制御。計算は calc.js (window.Calc) に任せる */
(function () {
  'use strict';
  const C = window.Calc;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'ttftp.v1';

  // ---------- 保存 ----------

  const defaultState = () => ({
    settings: {
      weight: null,
      ftpOverride: null,
      bikeKg: C.DEFAULTS.bikeKg,
      cda: C.DEFAULTS.cda,
      crr: C.DEFAULTS.crr,
      lossPct: C.DEFAULTS.drivetrainLoss * 100,
      k: C.DEFAULTS.k,
    },
    history: [],
    weightLog: [],
    sessionLog: {},
    adjustments: {},
    oneRmLog: [],
    backup: {},
    tab: 'menu',
    mode: 'A',
  });

  function load() {
    const s = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return s;
      const saved = JSON.parse(raw);
      return {
        ...s,
        ...saved,
        settings: { ...s.settings, ...(saved.settings || {}) },
        history: Array.isArray(saved.history) ? saved.history : [],
        weightLog: Array.isArray(saved.weightLog) ? saved.weightLog : [],
        sessionLog: saved.sessionLog && typeof saved.sessionLog === 'object' ? saved.sessionLog : {},
        adjustments: saved.adjustments && typeof saved.adjustments === 'object' ? saved.adjustments : {},
        oneRmLog: Array.isArray(saved.oneRmLog) ? saved.oneRmLog : [],
      };
    } catch (e) {
      return s;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 保存できない環境(プライベートモード等)ではこのセッション内だけ保持 */
    }
  }

  const state = load();
  let menus = null;

  // ---------- 共通 ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const mdLabel = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  function currentWeight() {
    const w = num(state.settings.weight);
    return w && w > 0 ? w : null;
  }

  function latestTT() {
    if (!state.history.length) return null;
    return [...state.history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.savedAt - a.savedAt))[0];
  }

  /** 現在のFTPとその出どころ */
  function currentFtp() {
    const o = num(state.settings.ftpOverride);
    if (o && o > 0) return { ftp: o, source: '手入力' };
    const t = latestTT();
    if (t) return { ftp: t.ftp, source: `TT ${t.date.slice(5).replace('-', '/')} ${t.name || ''}`.trim() };
    return { ftp: null, source: '未設定' };
  }

  function renderHeader() {
    const { ftp, source } = currentFtp();
    const w = currentWeight();
    $('ftpHeadW').textContent = ftp ? fmt(ftp) : '—';
    $('ftpHeadWkg').textContent = ftp && w ? fmt(ftp / w, 2) : '—';
    $('ftpHeadSrc').textContent = source;
  }

  // ---------- タブ ----------

  const TABS = ['menu', 'tt', 'weight', 'history', 'prefs'];
  function showTab(name) {
    if (!TABS.includes(name)) name = 'menu';
    for (const t of TABS) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
      $(`view-${t}`).hidden = t !== name;
    }
    state.tab = name;
    save();
    if (name === 'menu') renderMenu();
    if (name === 'weight') renderWeight();
    if (name === 'history') { renderHistory(); renderReviewSelect(); renderReview(); }
    if (name === 'prefs') { renderPrediction(); renderOneRm(); renderBackup(); }
  }
  for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => showTab(t));

  // ---------- 設定 ----------

  const prefFields = {
    pWeight: 'weight', pFtp: 'ftpOverride', pBike: 'bikeKg', pCda: 'cda', pCrr: 'crr', pLoss: 'lossPct', pK: 'k',
  };

  function altSettings() {
    const s = state.settings;
    return { altitude: s.altOn !== false, acclimatized: s.acclimatized === true, ftpAltM: num(s.ftpAltM) || 0 };
  }

  function fillPrefs() {
    $('pIcuKey').value = state.settings.icuKey || '';
    const a = altSettings();
    $('pAltOn').checked = a.altitude;
    $('pAccl').value = a.acclimatized ? 'yes' : 'no';
    $('pFtpAlt').value = num(state.settings.ftpAltM) === null ? '' : state.settings.ftpAltM;
    $('pAccl').disabled = $('pFtpAlt').disabled = !a.altitude;
    for (const [id, key] of Object.entries(prefFields)) {
      const v = state.settings[key];
      $(id).value = v === null || v === undefined ? '' : v;
    }
  }

  let prefsToastTimer;
  $('prefsForm').addEventListener('input', (e) => {
    const key = prefFields[e.target.id];
    if (!key) return;
    state.settings[key] = num(e.target.value);
    save();
    renderHeader();
    computeTT();
    renderPrediction();
    $('prefsToast').hidden = false;
    clearTimeout(prefsToastTimer);
    prefsToastTimer = setTimeout(() => ($('prefsToast').hidden = true), 1500);
  });
  $('prefsForm').addEventListener('submit', (e) => e.preventDefault());
  $('pAltOn').addEventListener('change', (e) => {
    state.settings.altOn = e.target.checked;
    $('pAccl').disabled = $('pFtpAlt').disabled = !e.target.checked;
    save();
    renderPrediction();
  });
  $('pAccl').addEventListener('change', (e) => {
    state.settings.acclimatized = e.target.value === 'yes';
    save();
    renderPrediction();
  });
  $('pFtpAlt').addEventListener('input', (e) => {
    state.settings.ftpAltM = num(e.target.value);
    save();
    renderPrediction();
  });
  $('pIcuKey').addEventListener('input', (e) => {
    state.settings.icuKey = e.target.value.trim();
    save();
  });

  $('resetAdvanced').addEventListener('click', () => {
    const d = defaultState().settings;
    for (const key of ['bikeKg', 'cda', 'crr', 'lossPct', 'k']) state.settings[key] = d[key];
    save();
    fillPrefs();
    computeTT();
    renderPrediction();
  });

  function physicsSettings() {
    const s = state.settings;
    const d = defaultState().settings;
    const pick = (k) => (num(s[k]) === null ? d[k] : num(s[k]));
    return { bikeKg: pick('bikeKg'), cda: pick('cda'), crr: pick('crr'), drivetrainLoss: pick('lossPct') / 100, k: pick('k') };
  }

  // ---------- 乗鞍の予想タイム ----------

  function renderPrediction() {
    const el = $('climbPrediction');
    const { ftp } = currentFtp();
    const weight = currentWeight();
    const head = '<div class="eyebrow">乗鞍ヒルクライム 予想タイム</div>';
    if (!ftp || !weight) {
      el.innerHTML = `${head}<p class="hint">体重と FTP（TT結果か手入力）が入ると、乗鞍エコーライン 20.5km・標高差1260m の予想タイムを表示します。</p>`;
      return;
    }
    const ps = physicsSettings();
    const alt = altSettings();
    const opts = { ...ps, ...alt, ftp, riderKg: weight };
    let r;
    try {
      r = C.predictClimb(opts);
    } catch (e) {
      el.innerHTML = `${head}<p class="warn">${esc(e.message)}</p>`;
      return;
    }
    const rows = r.segments.map((s) => `<tr>
      <td>${esc(s.name)}<br><span class="hint">${fmt(s.distanceKm, 1)}km・${fmt(s.gradePct, 1)}%</span></td>
      <td class="num">${fmt(s.powerW)}</td><td class="num">${fmt(s.speedKmh, 1)}</td><td class="num">${C.formatClock(s.sec)}</td></tr>`).join('');
    const flat = alt.altitude ? C.predictClimb({ ...opts, altitude: false }) : null;
    const altLine = flat
      ? `<p class="sub">高地で平均 <b>−${fmt(r.altitudeLossPct, 1)}</b>%（${fmt(r.basePowerW)}W → ${fmt(r.powerW)}W）。
         高地の影響が無ければ <b>${C.formatClock(flat.totalSec)}</b>（${C.formatClock(r.totalSec - flat.totalSec)} 速い）</p>`
      : '<p class="sub">高地によるパワー低下は考慮していません。</p>';
    // 期分けの減量目標(60kg・58kg)で試算
    const whatIf = [60, 58].filter((w) => w < weight - 0.05).map((w) => {
      const x = C.predictClimb({ ...opts, riderKg: w });
      return `<tr><td>体重 ${w}kg</td><td class="num">${fmt(ftp / w, 2)} W/kg</td><td class="num">${C.formatClock(x.totalSec)}</td>
        <td class="num">${C.formatClock(r.totalSec - x.totalSec)} 短縮</td></tr>`;
    }).join('');
    el.innerHTML = `${head}
      <div class="predict-time">${C.formatClock(r.totalSec)}</div>
      <div class="predict-meta">
        <span>平均 <b>${fmt(r.powerW)}</b> W</span><span><b>${fmt(r.wkg, 2)}</b> W/kg</span>
        <span>FTPの <b>${fmt(r.pctFtp)}</b>%</span><span>平均 <b>${fmt(r.speedKmh, 1)}</b> km/h</span>
      </div>
      ${altLine}
      <div class="scroll"><table>
        <thead><tr><th>区間</th><th class="num">W</th><th class="num">km/h</th><th class="num">タイム</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${whatIf ? `<div class="scroll"><table><thead><tr><th>FTP ${fmt(ftp)}W のまま</th><th class="num"></th><th class="num">予想</th><th class="num">差</th></tr></thead><tbody>${whatIf}</tbody></table></div>` : ''}
      <p class="hint">FTP ${fmt(ftp)}W・体重 ${fmt(weight, 1)}kg・詳細設定の値で計算。所要時間に見合うパワー（FTP × (60/分)^k）を基準に、${alt.altitude ? `標高に応じて下がるパワー（Bassett ら 1999 の式・高地順応${alt.acclimatized ? 'あり' : 'なし'}、FTP計測地 ${fmt(alt.ftpAltM)}m 基準）で` : '一定ペースで'}登る想定です。区間の勾配は大会要項からの概算で、風・集団走行・路面状況は考慮していません。</p>`;
  }

  // ---------- TT入力 ----------

  let lastResult = null;

  function setMode(mode) {
    state.mode = mode;
    $('fieldsA').hidden = mode !== 'A';
    $('fieldsB').hidden = mode !== 'B';
    save();
    computeTT();
  }
  $('modeA').addEventListener('change', () => setMode('A'));
  $('modeB').addEventListener('change', () => setMode('B'));

  function stat(label, value, unit, main) {
    return `<div class="stat${main ? ' main' : ''}"><div class="k">${label}</div><div class="v">${value}<small>${unit}</small></div></div>`;
  }

  function computeTT() {
    const out = $('ttResult');
    const hint = $('ttHint');
    const weight = currentWeight();
    const ps = physicsSettings();
    lastResult = null;
    out.innerHTML = '';
    hint.textContent = '';

    try {
      if (state.mode === 'A') {
        const P = num($('aPower').value);
        const t = C.parseTime($('aTime').value);
        if (!P || !(t > 0)) {
          hint.textContent = '平均パワーと所要時間を入れると FTP を計算します。';
          return finishTT();
        }
        const ftp = C.ftpFromPower(P, t, ps.k);
        const warn = C.durationWarning(t);
        lastResult = { mode: 'A', avgPower: P, minutes: t, ftp, inputs: { power: P, time: $('aTime').value.trim() } };
        out.innerHTML =
          (warn ? `<p class="warn">${esc(warn)}</p>` : '') +
          `<div class="big-stats">
            ${stat('推定FTP', fmt(ftp), 'W', true)}
            ${stat('FTP / 体重', weight ? fmt(ftp / weight, 2) : '—', 'W/kg')}
            ${stat('平均パワー', fmt(P), 'W')}
            ${stat('参考：20分×0.95', fmt(C.ftpFrom20min(P)), 'W')}
          </div>
          <p class="breakdown">FTP = ${fmt(P)} × (${fmt(t, 2)} / 60)<sup>${ps.k}</sup> = ${fmt(ftp, 1)} W。
          参考値は平均パワーを20分パワーとみなした場合の値です。</p>`;
      } else {
        const dist = num($('bDist').value);
        const gain = num($('bGain').value);
        const t = C.parseTime($('bTime').value);
        const alt = num($('bAlt').value);
        if (!weight) {
          hint.textContent = 'タイムからの推定には体重が必要です。「設定」で体重を入れてください。';
          return finishTT();
        }
        if (!dist || gain === null || !(t > 0)) {
          hint.textContent = '距離・獲得標高・タイムを入れると、平均パワーと FTP を推定します。';
          return finishTT();
        }
        const r = C.estimatePower({ distanceKm: dist, gainM: gain, minutes: t, riderKg: weight, avgAltM: alt, ...ps });
        const ftp = C.ftpFromPower(r.power, t, ps.k);
        const warn = C.durationWarning(t);
        lastResult = {
          mode: 'B', avgPower: r.power, minutes: t, ftp,
          inputs: { distanceKm: dist, gainM: gain, time: $('bTime').value.trim(), avgAltM: alt },
        };
        out.innerHTML =
          `<p class="notice">勾配が一定と仮定した推定値です。風・路面・ペースの上げ下げは考慮していません。</p>` +
          (warn ? `<p class="warn">${esc(warn)}</p>` : '') +
          `<div class="big-stats">
            ${stat('推定FTP', fmt(ftp), 'W', true)}
            ${stat('FTP / 体重', fmt(ftp / weight, 2), 'W/kg')}
            ${stat('推定平均パワー', fmt(r.power), 'W')}
            ${stat('平均速度', fmt(r.speedKmh, 1), 'km/h')}
          </div>
          <p class="breakdown">平均勾配 ${fmt(r.gradePct, 1)}% ／ 空気密度 ${fmt(r.rho, 3)} kg/m³ ／
          重力＋転がり ${fmt(r.gravityRollingW)} W ＋ 空気抵抗 ${fmt(r.aeroW)} W、駆動損失 ${fmt(ps.drivetrainLoss * 100, 1)}% を加算（総重量 ${fmt(weight + ps.bikeKg, 1)} kg）</p>`;
      }
    } catch (e) {
      lastResult = null;
      out.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
    }
    finishTT();
  }

  function finishTT() {
    $('ttSave').disabled = !lastResult;
  }

  $('ttForm').addEventListener('input', (e) => {
    if (e.target.name !== 'mode') computeTT();
  });

  $('ttForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!lastResult) return;
    const rec = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      date: $('ttDate').value || isoDate(new Date()),
      name: $('ttName').value.trim(),
      weight: currentWeight(),
      ...lastResult,
    };
    state.history.push(rec);
    save();
    renderHeader();
    const overridden = num(state.settings.ftpOverride);
    const toast = $('ttToast');
    toast.textContent = overridden
      ? `保存しました。設定で FTP を手入力（${overridden}W）しているため、メニューは手入力の値で計算されます。`
      : `保存しました。メニューを FTP ${fmt(rec.ftp)}W で計算します。`;
    toast.hidden = false;
  });

  // ---------- デッドリフト ----------

  const ST = () => window.Strength;
  const oneRm = (asOf, before) => ST().current1RM(state.oneRmLog, (menus && menus.strength && menus.strength.initial1RM) || null, asOf, before);
  const kgFmt = (x) => String(Math.round(x * 100) / 100); // 112.5 / 1.25 / 118.3
  const platesText = (w) => (w.plates.length ? `片側 ${w.plates.map(kgFmt).join(' + ')}kg${w.rest ? `（+${w.rest}kg 組めない端数）` : ''}` : 'バーのみ');

  /** メニュー画面に出すその日のデッドリフト */
  function liftHtml(date) {
    if (!menus || !menus.strength) return '';
    const plan = ST().planFor(date, menus);
    if (!plan) return '';
    // その日の時点の 1RM で計算する(テスト当日はテスト前の値)
    const rm = oneRm(isoDate(date), !!plan.test);
    if (!rm.kg) return '';
    const r = ST().resolvePlan(plan, rm.kg, menus.strength);
    const since = ST().daysSinceUpdate(state.oneRmLog, new Date());
    const remindDays = menus.strength.reminderDays || 28;
    const remind = !r.test && since !== null && since >= remindDays && C.daysBetween(new Date(), date) <= 0
      ? `<p class="notice">1RM の更新から ${since} 日たちました。限界に近いセットの重さと回数を「設定」で入力して更新してください。</p>` : '';
    const warm = r.warmup.map((w) => `<li><span><span class="kg">${kgFmt(w.kg)}</span>kg × ${w.reps}回</span><span class="meta">${w.bar ? '' : `${w.pct}%`}</span><span class="plates">${platesText(w)}</span></li>`).join('');
    const head = `<div class="log-head"><b>${esc(menus.strength.name || 'デッドリフト')}</b><span class="chip">${esc(r.timing)}</span>
      <span class="hint">1RM ${kgFmt(rm.kg)}kg${rm.date ? `（${rm.date.slice(5).replace('-', '/')} 更新）` : '（初期値）'}・${esc(r.focus || '')}</span></div>`;
    if (r.test) {
      const att = r.attempts.map((a) => `<li><span>${esc(a.label)}　<span class="kg">${kgFmt(a.kg)}</span>kg × 1回</span><span class="meta">${a.pct}%</span>
        <span class="plates">${platesText(a)}${a.note ? `・${esc(a.note)}` : ''}</span></li>`).join('');
      const done = state.oneRmLog.find((x) => x.date === isoDate(date));
      return `<div class="lift">${head}
        <p><b>1RM テスト</b>：ウォームアップのあと、試技は2回まで。いちばん重く挙がったセットを記録すると 1RM を更新します。</p>
        <h3 class="hint">ウォームアップ</h3><ul class="lift-sets">${warm}</ul>
        <h3 class="hint">試技</h3><ul class="lift-sets">${att}</ul>
        ${done ? `<p class="toast">この日の結果 ${kgFmt(done.fromKg)}kg × ${done.fromReps}回 → 1RM ${kgFmt(done.kg)}kg を記録済みです。</p>` : ''}
        ${C.daysBetween(new Date(), date) <= 0 ? `<div class="rm-form" data-rmform data-date="${isoDate(date)}">
          <div class="grid3">
            <label class="field">重さ (kg)<input type="number" class="rm-kg" inputmode="decimal" step="2.5" min="20" placeholder="${kgFmt(r.attempts[0].kg)}"></label>
            <label class="field">回数<select class="rm-reps">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}回</option>`).join('')}</select></label>
          </div>
          <p class="rm-preview hint" aria-live="polite">挙がった重さと回数を入れると 1RM に換算します。</p>
          <button type="button" class="primary rm-save" disabled>結果を記録して 1RM を更新</button>
        </div>` : '<p class="hint">当日になると結果を記録できます。</p>'}
      </div>`;
    }
    const work = r.work.map((w) => `<li><span>${w.label ? `${esc(w.label)}　` : ''}<span class="kg">${kgFmt(w.kg)}</span>kg × ${w.reps}回 × ${w.sets}セット</span>
      <span class="meta">${w.pct}%</span><span class="plates">${platesText(w)}</span></li>`).join('');
    return `<div class="lift">${head}${remind}<ul class="lift-sets">${work}</ul>
      <details><summary>ウォームアップ（${r.warmup.length}段階）</summary><ul class="lift-sets">${warm}</ul></details></div>`;
  }

  /** 換算のプレビュー(フォームの中の値から) */
  function rmPreview(form) {
    const kg = num(form.querySelector('.rm-kg').value);
    const reps = Number(form.querySelector('.rm-reps').value);
    const out = form.querySelector('.rm-preview');
    const btn = form.querySelector('.rm-save');
    let v = null;
    try { v = kg ? ST().brzycki(kg, reps) : null; } catch (e) { out.textContent = e.message; btn.disabled = true; return null; }
    if (!v) { btn.disabled = true; return null; }
    const cur = oneRm().kg;
    const diff = cur ? v - cur : 0;
    out.innerHTML = `換算 1RM <b>${v.toFixed(1)}kg</b>${cur ? `（今の ${kgFmt(cur)}kg より ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}kg）` : ''}${
      diff < 0 ? '<br>今より低い値です。疲労の影響かもしれません。保存するかどうかは選べます。' : ''}`;
    btn.disabled = false;
    return { kg, reps, value: Math.round(v * 10) / 10 };
  }

  document.addEventListener('input', (e) => {
    const form = e.target.closest && e.target.closest('[data-rmform]');
    if (form) rmPreview(form);
  });
  document.addEventListener('change', (e) => {
    const form = e.target.closest && e.target.closest('[data-rmform]');
    if (form) rmPreview(form);
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.rm-save');
    if (!btn) return;
    const form = btn.closest('[data-rmform]');
    const r = rmPreview(form);
    if (!r) return;
    const dateInput = form.querySelector('.rm-date');
    const date = form.dataset.date || (dateInput && dateInput.value) || isoDate(new Date());
    state.oneRmLog.push({ date, kg: r.value, fromKg: r.kg, fromReps: r.reps, savedAt: Date.now() });
    save();
    form.querySelector('.rm-kg').value = '';
    renderOneRm();
    if (menus && state.tab === 'menu') renderDay();
    const msg = form.querySelector('.rm-preview');
    msg.textContent = `${date.slice(5).replace('-', '/')} の 1RM を ${kgFmt(r.value)}kg で保存しました。`;
    btn.disabled = true;
  });

  function renderOneRm() {
    if (!menus || !menus.strength) return;
    if (!$('rmDate').value) $('rmDate').value = isoDate(new Date());
    const rm = oneRm();
    const since = ST().daysSinceUpdate(state.oneRmLog, new Date());
    $('rmCurrent').innerHTML = `現在の 1RM <b>${kgFmt(rm.kg)}</b>kg　${rm.date ? `${rm.date.slice(5).replace('-', '/')} 更新・${since}日前` : '初期値'}`;
    const rows = [...state.oneRmLog].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.savedAt - a.savedAt));
    $('rmHistory').innerHTML = rows.map((x) => `<tr><td>${esc(x.date.slice(2).replace(/-/g, '/'))}</td>
      <td>${kgFmt(x.fromKg)}kg × ${x.fromReps}回</td><td class="num">${kgFmt(x.kg)}</td>
      <td><button type="button" class="del" data-rmsaved="${x.savedAt}">削除</button></td></tr>`).join('')
      + `<tr><td>—</td><td class="hint">初期値</td><td class="num">${kgFmt(menus.strength.initial1RM)}</td><td></td></tr>`;
  }

  $('rmHistory').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rmsaved]');
    if (!btn) return;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'もう一度押して削除';
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = '削除'; } }, 3000);
      return;
    }
    state.oneRmLog = state.oneRmLog.filter((x) => String(x.savedAt) !== btn.dataset.rmsaved);
    save();
    renderOneRm();
  });

  // ---------- 体重 ----------

  const weightEntries = () => state.weightLog
    .map((e) => ({ date: C.parseDate(e.date), kg: e.kg }))
    .sort((a, b) => a.date - b.date);

  /** その日の週(月曜)に体重を記録し、設定の体重も最新の記録に合わせる */
  function recordWeight(date, kg) {
    const key = isoDate(C.mondayOf(date));
    state.weightLog = state.weightLog.filter((e) => e.date !== key);
    state.weightLog.push({ date: key, kg });
    const latest = weightEntries().pop();
    state.settings.weight = latest.kg;
    save();
    fillPrefs();
    renderHeader();
    computeTT();
    return key;
  }

  function planStartKg() {
    const set = num(state.settings.planStartKg);
    if (set) return set;
    const first = weightEntries()[0];
    return first ? first.kg : currentWeight();
  }

  function weightPlanNow() {
    const start = planStartKg();
    return menus && start ? C.weightPlan(menus, start) : null;
  }

  // 月曜にメニュー画面を開いたら、今週の記録が無ければ入力欄を出す
  function renderWeighPrompt() {
    const today = new Date();
    const week = isoDate(C.mondayOf(today));
    const show = today.getDay() === 1 && !state.weightLog.some((e) => e.date === week);
    $('weighPrompt').hidden = !show;
  }
  $('promptSave').addEventListener('click', () => {
    const kg = num($('promptKg').value);
    if (!kg || kg < 20) { $('promptKg').focus(); return; }
    recordWeight(new Date(), kg);
    renderMenu();
    backupIfDue('weight');
  });

  $('weighForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const kg = num($('weighKg').value);
    const toast = $('weighToast');
    toast.hidden = false;
    if (!kg || kg < 20) {
      toast.textContent = '体重を kg で入れてください。';
      return;
    }
    const date = $('weighDate').value ? C.parseDate($('weighDate').value) : new Date();
    const key = recordWeight(date, kg);
    toast.textContent = `${key.slice(5).replace('-', '/')} の週に ${fmt(kg, 1)}kg を記録しました。`;
    $('weighKg').value = '';
    renderWeight();
    backupIfDue('weight');
  });

  $('planStartKg').addEventListener('input', (e) => {
    state.settings.planStartKg = num(e.target.value);
    save();
    renderWeight();
  });

  $('weighBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'もう一度押して削除';
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = '削除'; } }, 3000);
      return;
    }
    state.weightLog = state.weightLog.filter((x) => x.date !== btn.dataset.date);
    const latest = weightEntries().pop();
    if (latest) state.settings.weight = latest.kg;
    save();
    fillPrefs();
    renderHeader();
    renderWeight();
  });

  const signed = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;

  function renderWeight() {
    if (!$('weighDate').value) $('weighDate').value = isoDate(C.mondayOf(new Date()));
    $(state.weighRange === 'all' ? 'rangeAll' : 'rangeRecent').checked = true;
    $('planStartKg').value = num(state.settings.planStartKg) === null ? '' : state.settings.planStartKg;
    const entries = weightEntries();
    const plan = weightPlanNow();

    // 一覧(新しい順)
    $('weighEmpty').hidden = entries.length > 0;
    $('weighBody').innerHTML = [...entries].reverse().map((e, i, arr) => {
      const t = plan ? C.targetWeightAt(plan, e.date) : null;
      const prev = arr[i + 1];
      const wk = prev && C.daysBetween(prev.date, e.date) === 7 ? signed(e.kg - prev.kg) : '—';
      return `<tr><td>${mdLabel(e.date)}</td><td class="num">${fmt(e.kg, 1)}</td>
        <td class="num">${t === null ? '—' : fmt(t, 1)}</td><td class="num">${t === null ? '—' : signed(e.kg - t)}</td>
        <td class="num">${wk}</td><td><button type="button" class="del" data-date="${isoDate(e.date)}">削除</button></td></tr>`;
    }).join('');

    // 集計
    const st = $('weighStats');
    if (!plan || !entries.length) {
      st.innerHTML = '';
    } else {
      const r = C.weightStats(entries, plan, menus);
      const status = r.diff <= 0
        ? `<span class="chip recovery">計画どおり</span>`
        : r.diff < 1 ? `<span class="chip load">計画より重い</span>` : `<span class="chip load">要注意</span>`;
      const next = r.next
        ? `<span>${mdLabel(r.next.date)} に ${fmt(r.next.kg, 0)}kg → 必要なペース <b class="diff">${signed(r.next.pacePerWeek, 2)}</b> kg/週</span>`
        : '';
      const recent = r.recentPace === null ? '' : `<span>直近4週のペース <b class="diff">${signed(r.recentPace, 2)}</b> kg/週</span>`;
      st.innerHTML = `
        <div class="today">
          <div class="eyebrow">最新 ${mdLabel(r.latest.date)} の週</div>
          <div class="headline">${fmt(r.latest.kg, 1)}kg <span class="hint">目標 ${fmt(r.target, 1)}kg より <b class="diff">${signed(r.diff)}</b>kg</span></div>
          <div class="chips">${status}</div>
          <div class="predict-meta">${next}${recent}</div>
        </div>
        ${r.warnings.map((w) => `<p class="warn">${esc(w.text)}</p>`).join('')}`;
    }
    renderWeightChart(entries, plan);
  }

  /** 体重のグラフ(SVG)。横=日付、縦=kg。計画は破線、実測は実線＋点。ホバーで週の値を表示 */
  function renderWeightChart(entries, plan) {
    const box = $('weighChart');
    if (!menus || (!plan && !entries.length)) {
      box.innerHTML = '<p class="hint">体重を記録すると、ここにグラフが出ます。</p>';
      return;
    }
    const W = Math.max(300, Math.round(box.clientWidth || 340));
    const H = 220;
    const m = { l: 34, r: 34, t: 22, b: 24 };
    const seasonStart = C.parseDate(menus.phases[0].start);
    const raceDay = C.parseDate(menus.raceDate || menus.phases[menus.phases.length - 1].end);
    // 表示期間: 全期間 = シーズン開始(それより前の記録があればそこ)〜レース、直近12週 = 最新の記録の11週前〜4週後
    let x0 = entries.length && entries[0].date < seasonStart ? C.mondayOf(entries[0].date) : seasonStart;
    let x1 = raceDay;
    const range = state.weighRange === 'all' ? 'all' : 'recent';
    if (range === 'recent') {
      const anchor = entries.length ? entries[entries.length - 1].date : C.mondayOf(new Date());
      x0 = new Date(anchor); x0.setDate(x0.getDate() - 77);
      if (entries.length && entries[0].date > x0) x0 = new Date(entries[0].date);
      x1 = new Date(anchor); x1.setDate(x1.getDate() + 28);
    }
    const days = Math.max(7, C.daysBetween(x0, x1));
    const inView = (d) => C.daysBetween(x0, d) >= 0 && C.daysBetween(d, x1) >= 0;
    const shown = entries.filter((e) => inView(e.date));
    // 計画線は表示期間で切り取る(両端は補間値)
    const planPts = plan
      ? [{ date: x0, kg: C.targetWeightAt(plan, x0) }, ...plan.filter((p) => C.daysBetween(x0, p.date) > 0 && C.daysBetween(p.date, x1) > 0), { date: x1, kg: C.targetWeightAt(plan, x1) }]
      : [];
    const kgs = [...shown.map((e) => e.kg), ...planPts.map((p) => p.kg)];
    let lo = Math.floor(Math.min(...kgs) - 0.5);
    let hi = Math.ceil(Math.max(...kgs) + 0.5);
    if (hi - lo < 4) { lo = Math.floor((lo + hi) / 2 - 2); hi = lo + 4; }
    const X = (d) => m.l + ((W - m.l - m.r) * C.daysBetween(x0, d)) / days;
    const Y = (kg) => m.t + ((H - m.t - m.b) * (hi - kg)) / (hi - lo);
    const step = hi - lo > 8 ? 2 : 1;
    let g = '';
    // 横の目盛り(kg)
    for (let kg = lo; kg <= hi; kg += step) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(kg)}" y2="${Y(kg)}"></line>
        <text class="axis" x="${m.l - 6}" y="${Y(kg) + 3}" text-anchor="end">${kg}</text>`;
    }
    // 日付の目盛り: 全期間は各月、直近12週は4週ごと
    if (range === 'all') {
      g += `<text class="axis" x="${X(x0)}" y="${H - 6}" text-anchor="start">${mdLabel(x0)}</text>`;
      for (let d = new Date(x0.getFullYear(), x0.getMonth() + 1, 1); d <= x1; d.setMonth(d.getMonth() + 1)) {
        if (X(d) - X(x0) > 28) g += `<text class="axis" x="${X(d)}" y="${H - 6}" text-anchor="middle">${d.getMonth() + 1}月</text>`;
      }
    } else {
      for (let d = new Date(x0); d <= x1; d.setDate(d.getDate() + 28)) {
        g += `<text class="axis" x="${X(d)}" y="${H - 6}" text-anchor="middle">${mdLabel(d)}</text>`;
      }
    }
    // 期の区切りと名前
    menus.phases.forEach((p, i) => {
      const a = C.parseDate(p.start);
      const b = C.parseDate(p.end);
      if (C.daysBetween(b, x0) > 0 || C.daysBetween(x1, a) > 0) return;
      const ca = a < x0 ? x0 : a;
      const cb = b > x1 ? x1 : b;
      if (i > 0 && inView(a)) g += `<line class="phase-line" x1="${X(a)}" x2="${X(a)}" y1="${m.t - 8}" y2="${H - m.b}"></line>`;
      if (X(cb) - X(ca) > 24) g += `<text class="phase-label" x="${(X(ca) + X(cb)) / 2}" y="${m.t - 10}" text-anchor="middle">${esc(p.name.replace('期', ''))}</text>`;
    });
    // 今日
    const today = new Date();
    if (inView(today)) {
      g += `<line class="today-line" x1="${X(today)}" x2="${X(today)}" y1="${m.t}" y2="${H - m.b}"></line>`;
    }
    // 計画
    if (plan) {
      g += `<polyline class="plan-line" points="${planPts.map((p) => `${X(p.date)},${Y(p.kg)}`).join(' ')}"></polyline>`;
      plan.slice(1, 3).filter((p) => inView(p.date)).forEach((p) => {
        g += `<circle class="plan-goal" cx="${X(p.date)}" cy="${Y(p.kg)}" r="4"></circle>
          <text class="label muted" x="${X(p.date)}" y="${Y(p.kg) - 8}" text-anchor="middle">${fmt(p.kg, 0)}kg</text>`;
      });
    }
    // 実測
    if (shown.length) {
      if (shown.length > 1) g += `<polyline class="actual-line" points="${shown.map((e) => `${X(e.date)},${Y(e.kg)}`).join(' ')}"></polyline>`;
      g += shown.map((e) => `<circle class="actual-dot" cx="${X(e.date)}" cy="${Y(e.kg)}" r="4"></circle>`).join('');
      const last = shown[shown.length - 1];
      g += `<text class="label" x="${X(last.date) + 7}" y="${Y(last.kg) + 4}">${fmt(last.kg, 1)}</text>`;
    }
    g += `<line class="cross" id="weighCross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"></line>
      <rect id="weighHit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"></rect>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="体重の推移と減量計画のグラフ。値は下の表にもあります。">${g}</svg><div class="chart-tip" id="weighTip" hidden></div>`;

    // ホバー/タップ: 一番近い週の実測と計画を表示
    const svg = box.querySelector('svg');
    const tip = $('weighTip');
    const cross = $('weighCross');
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const d = new Date(x0);
      d.setDate(d.getDate() + Math.round(((px - m.l) / (W - m.l - m.r)) * days));
      const wk = C.mondayOf(d);
      const near = entries.find((e) => C.daysBetween(e.date, wk) === 0);
      const t = plan ? C.targetWeightAt(plan, wk) : null;
      cross.setAttribute('x1', X(wk));
      cross.setAttribute('x2', X(wk));
      cross.setAttribute('visibility', 'visible');
      tip.innerHTML = `${mdLabel(wk)} の週<br>実測 <b>${near ? `${fmt(near.kg, 1)}kg` : '—'}</b><br>計画 <b>${t === null ? '—' : `${fmt(t, 1)}kg`}</b>${near && t !== null ? `<br>差 <b>${signed(near.kg - t)}kg</b>` : ''}`;
      tip.hidden = false;
      // 十字線と重ならないよう、左半分なら右側、右半分なら左側に出す
      const left = (X(wk) / W) * rect.width;
      const pos = left < rect.width / 2 ? left + 10 : left - tip.offsetWidth - 10;
      tip.style.left = `${Math.min(Math.max(0, pos), rect.width - tip.offsetWidth)}px`;
      tip.style.top = `${(m.t / H) * rect.height}px`;
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    const hit = $('weighHit');
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  for (const id of ['rangeRecent', 'rangeAll']) {
    $(id).addEventListener('change', (e) => {
      state.weighRange = e.target.value;
      save();
      renderWeight();
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.tab === 'weight') renderWeight(); }, 150);
  });

  // ---------- ブロック振り返り ----------

  const R = () => window.Review;
  const KIND_ORDER = ['vo2', 'threshold', 'sst', 'race'];
  let reviewData = null;

  /** 振り返れるブロック(今のブロックまで)。値は "期のindex:ブロック" */
  function reviewableBlocks() {
    if (!menus) return [];
    const now = C.getPhaseAndWeek(new Date(), menus);
    const out = [];
    menus.phases.forEach((p, pi) => {
      const total = p.blocks === false ? 1 : C.getPhaseAndWeek(C.parseDate(p.end), menus).block;
      for (let b = 1; b <= total; b++) {
        const block = p.blocks === false ? null : b;
        const r = R().blockRange(menus, pi, block);
        if (now.status === 'before' || C.daysBetween(new Date(), r.start) > 0) return;
        out.push({ value: `${pi}:${block === null ? 'all' : block}`, pi, block, range: r,
          label: `${p.name}${block === null ? '' : ` ブロック${block}`}（${mdLabel(r.start)}〜${mdLabel(r.end)}）` });
      }
    });
    return out;
  }

  function renderReviewSelect() {
    const opts = reviewableBlocks();
    const sel2 = $('reviewBlock');
    const prev = sel2.value;
    sel2.innerHTML = opts.length
      ? opts.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')
      : '<option value="">シーズンが始まると選べます</option>';
    if (opts.some((o) => o.value === prev)) sel2.value = prev;
    else if (opts.length) {
      // 既定: 回復週なら今のブロック、それ以外は1つ前のブロック
      const now = C.getPhaseAndWeek(new Date(), menus);
      const idx = now.status === 'in' && (now.isRecovery || now.phase.blocks === false) ? opts.length - 1 : Math.max(0, opts.length - 2);
      sel2.value = opts[idx].value;
    }
    $('reviewFetch').disabled = $('reviewLocal').disabled = !opts.length;
    $('pMaxHr').value = num(state.settings.maxHr) || '';
  }

  /** ブロック内のキーセッションと Z2 の日 */
  function blockSchedule(pi, block) {
    const r = R().blockRange(menus, pi, block);
    const keys = [];
    const z2 = [];
    for (let d = new Date(r.start); C.daysBetween(d, r.end) >= 0; d.setDate(d.getDate() + 1)) {
      const date = new Date(d);
      const info = C.getPhaseAndWeek(date, menus);
      const f = info.status === 'in' ? findAdjusted(info.phase, info, info.day, date) : null;
      if (!f) continue;
      const iso = isoDate(date);
      if (C.isKeySession(f.menu)) {
        keys.push({ date, iso, kind: f.menu.kind, title: f.menu.title, plannedSec: C.resolveMenu(f.menu, 100, null).totalSec, log: state.sessionLog[iso] || null });
      } else if (f.menu.kind === 'z2') z2.push({ date, iso });
    }
    return { range: r, keys, z2 };
  }

  function previousBlock(pi, block) {
    if (block !== null && block > 1) return { pi, block: block - 1 };
    if (pi === 0) return null;
    const p = menus.phases[pi - 1];
    return { pi: pi - 1, block: p.blocks === false ? null : C.getPhaseAndWeek(C.parseDate(p.end), menus).block };
  }

  const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };

  async function runReview(useIntervals) {
    const status = $('reviewStatus');
    status.hidden = false;
    const [piS, blkS] = $('reviewBlock').value.split(':');
    if (piS === '') return;
    const pi = Number(piS);
    const block = blkS === 'all' ? null : Number(blkS);
    const sch = blockSchedule(pi, block);
    const maxHrSet = num(state.settings.maxHr);
    let maxHr = maxHrSet;
    let efNow = null;
    let efPrev = null;
    let fetched = false;

    if (useIntervals) {
      const key = (state.settings.icuKey || '').trim();
      if (!key) { status.textContent = '「設定」で intervals.icu の API キーを入れてください。記録だけで判定することもできます。'; return; }
      status.textContent = 'intervals.icu から取得中…';
      try {
        const prev = previousBlock(pi, block);
        const oldest = prev ? R().blockRange(menus, prev.pi, prev.block).start : sch.range.start;
        const acts = await window.Intervals.fetchActivities(key, isoDate(oldest), isoDate(sch.range.end));
        if (!maxHr) {
          const withMax = acts.find((a) => a.athlete_max_hr);
          if (withMax) { maxHr = withMax.athlete_max_hr; state.settings.maxHr = maxHr; save(); }
        }
        for (const k of sch.keys) {
          const a = window.Intervals.pickActivity(acts, k.iso);
          if (!a) continue;
          k.activity = { id: a.id, movingSec: a.moving_time, ftp: a.icu_ftp };
          const ivs = await window.Intervals.fetchIntervals(key, a.id);
          const minW = (a.icu_ftp || currentFtp().ftp || 0) * 0.85;
          k.hr = R().hrMetrics(ivs, maxHr, minW) || R().hrMetrics(ivs, maxHr, 0);
        }
        const efOf = (dates) => meanOf(dates.map((z) => window.Intervals.pickActivity(acts, z.iso)).filter((a) => a && a.icu_efficiency_factor).map((a) => a.icu_efficiency_factor));
        efNow = efOf(sch.z2);
        if (prev) efPrev = efOf(blockSchedule(prev.pi, prev.block).z2);
        fetched = true;
      } catch (err) {
        status.textContent = err instanceof TypeError
          ? 'intervals.icu に接続できませんでした。GitHub Pages 版で開いているか、ネットワーク接続を確認してください。'
          : `${err.message}。API キーが正しいか確認してください。`;
        return;
      }
    }

    for (const k of sch.keys) k.judge = R().judgeSession(k.kind, k.log, k.hr || null);
    const ftpBefore = median(sch.keys.map((k) => (k.log && k.log.ftp) || (k.activity && k.activity.ftp)).filter(Boolean));
    const ftpAfter = currentFtp().ftp;
    const proposal = R().proposeAdjustments(sch.keys.map((k) => ({ kind: k.kind, verdict: k.judge.verdict })),
      { z2: { efNow, efPrev }, ftp: { before: ftpBefore, after: ftpAfter } });
    const target = R().nextBlock(menus, pi, block);
    reviewData = { pi, block, sch, proposal, target, maxHr, efNow, efPrev, ftpBefore, ftpAfter, fetched };
    status.textContent = fetched
      ? `${sch.keys.filter((k) => k.activity).length} / ${sch.keys.length} 回分のライドを intervals.icu から取得しました。${maxHr ? `maxHR ${maxHr} で計算しています。` : 'maxHR が分からないため心拍は使っていません。'}`
      : '記録（実施結果・RPE）だけで判定しました。';
    renderReview();
  }

  function renderReview() {
    const el = $('reviewResult');
    if (!reviewData) { el.innerHTML = ''; renderAdjHistory(); return; }
    const { sch, proposal, target, efNow, efPrev, ftpBefore, ftpAfter } = reviewData;
    const kindLabel = (k) => C.SESSION_KINDS[k];
    const rows = sch.keys.map((k) => {
      const log = k.log;
      const rec = !log || !log.result ? '<span class="hint">未記録</span>'
        : log.result === 'skipped' ? '休んだ'
        : `${log.result === 'partial' ? '途中まで' : '完了'}${log.rpe ? `・RPE ${log.rpe}` : ''}`;
      const time = k.activity ? `${Math.round(k.activity.movingSec / 60)}/${Math.round(k.plannedSec / 60)}分` : '—';
      const hr = k.hr ? `${k.hr[R().CRITERIA[k.kind].hrMetric].toFixed(0)}%${k.hr.drift !== null && R().CRITERIA[k.kind].drift ? `<br><span class="hint">上昇 ${k.hr.drift >= 0 ? '+' : ''}${k.hr.drift.toFixed(1)}</span>` : ''}` : '—';
      const v = k.judge.verdict;
      const short = k.activity && k.plannedSec && k.activity.movingSec < k.plannedSec * 0.95 && log && log.result === 'done'
        ? '<br><span class="hint">時間が予定より短い</span>' : '';
      return `<tr><td>${mdLabel(k.date)}<br><span class="hint">${esc(kindLabel(k.kind))}</span></td>
        <td>${rec}${short}</td><td class="num">${time}</td><td class="num">${hr}</td>
        <td>${v ? `<span class="verdict ${v}">${R().VERDICTS[v].label}</span>` : '<span class="hint">—</span>'}</td></tr>`;
    }).join('');
    const missing = sch.keys.filter((k) => !k.log || !k.log.result).length;
    const adjOptions = (cur) => [-3, -2, -1, 0, 1, 2, 3].map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v > 0 ? '+' : ''}${v}%</option>`).join('');
    const kindRows = KIND_ORDER.map((k) => {
      const x = proposal.kinds[k];
      const c = x.counts;
      const why = x.n
        ? `余裕${c.easy}・適正${c.ok}・きつい${c.hard}・未完了${c.failed}（平均 ${x.avg >= 0 ? '+' : ''}${x.avg.toFixed(2)}）${x.n === 1 ? '・1回分のため ±1% まで' : ''}${x.cappedByFtp ? '・FTP上昇で上限' : ''}`
        : '判定できたセッションがありません';
      return `<div class="proposal-row"><b>${esc(kindLabel(k))}</b>
        <select class="inline" data-adj="${k}" aria-label="${esc(kindLabel(k))}の調整">${adjOptions(x.adj)}</select>
        <span class="why">${why}</span></div>`;
    }).join('');
    const z2Opts = [0, -20, -30].map((v) => `<option value="${v}"${v === proposal.z2Pct ? ' selected' : ''}>${v ? `${v}%` : 'そのまま'}</option>`).join('');
    const efLine = efNow && efPrev
      ? `心拍効率 ${efNow.toFixed(2)}（前のブロック ${efPrev.toFixed(2)}、${proposal.efDrop >= 0 ? '−' : '+'}${Math.abs(proposal.efDrop).toFixed(1)}%）`
      : efNow ? `心拍効率 ${efNow.toFixed(2)}（前のブロックのデータなし）` : '心拍効率のデータなし';
    const targetLabel = target
      ? (() => { const p = menus.phases[target.phaseIndex]; const r = R().blockRange(menus, target.phaseIndex, target.block); return `${p.name}${target.block === null ? '' : ` ブロック${target.block}`}（${mdLabel(r.start)}〜${mdLabel(r.end)}）`; })()
      : null;
    el.innerHTML = `
      <div class="scroll"><table>
        <thead><tr><th>日</th><th>記録</th><th class="num">時間</th><th class="num">心拍</th><th>判定</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="hint">このブロックにキーセッションはありません。</td></tr>'}</tbody></table></div>
      ${missing ? `<p class="hint">未記録が ${missing} 回あります。メニュータブでその日を開くと記録できます（記録後にもう一度判定してください）。</p>` : ''}
      <p class="hint">心拍：VO2 は最後の本の最高心拍、それ以外は本番区間の平均心拍（maxHR 比）。上昇は最後の本 − 最初の本（ポイント）。</p>
      <h3>次のブロックの調整案${targetLabel ? `：${esc(targetLabel)}` : ''}</h3>
      ${targetLabel ? `
      <div class="proposal">
        ${kindRows}
        <div class="proposal-row"><b>Z2 の量（水・日）</b><select class="inline" id="adjZ2" aria-label="Z2 の量">${z2Opts}</select>
          <span class="why">${esc(efLine)}${proposal.fatigue.length ? `／疲労のサイン：${esc(proposal.fatigue.join('、'))}` : ''}</span></div>
      </div>
      ${proposal.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}
      <p class="hint">FTP：${ftpBefore ? `${fmt(ftpBefore)}W → ` : ''}${ftpAfter ? `${fmt(ftpAfter)}W` : '未設定'}。強度の調整は本番区間の %FTP に足します（同じ期のあいだは累積）。</p>
      <button type="button" class="primary" id="approveAdj">承認して次のブロックに反映</button>` : '<p class="hint">次のブロックはありません（シーズン最後のブロックです）。</p>'}`;
    renderAdjHistory();
  }

  $('reviewFetch').addEventListener('click', () => runReview(true));
  $('reviewLocal').addEventListener('click', () => runReview(false));
  $('reviewBlock').addEventListener('change', () => { reviewData = null; $('reviewStatus').hidden = true; renderReview(); });
  $('pMaxHr').addEventListener('input', (e) => { state.settings.maxHr = num(e.target.value); save(); });
  $('openReview').addEventListener('click', () => showTab('history'));

  async function uploadBlock(target) {
    const key = (state.settings.icuKey || '').trim();
    if (!key || !target) return null;
    const r = R().blockRange(menus, target.phaseIndex, target.block);
    const events = window.Intervals.buildEvents(menus, r.start, r.end, adjustMenu);
    await window.Intervals.uploadEvents(key, events);
    return { r, n: events.length };
  }

  $('reviewResult').addEventListener('click', async (e) => {
    if (!e.target.closest('#approveAdj') || !reviewData || !reviewData.target) return;
    const kinds = {};
    $('reviewResult').querySelectorAll('[data-adj]').forEach((sel3) => {
      const v = Number(sel3.value);
      if (v) kinds[sel3.dataset.adj] = v;
    });
    const t = reviewData.target;
    const k = R().keyOf(t.phase, t.block);
    state.adjustments[k] = {
      kinds, z2Pct: Number($('adjZ2').value), approvedAt: Date.now(), ftp: reviewData.ftpAfter,
      from: R().keyOf(menus.phases[reviewData.pi].id, reviewData.block),
    };
    save();
    const status = $('reviewStatus');
    status.hidden = false;
    status.textContent = '保存しました。';
    try {
      const up = await uploadBlock(t);
      status.textContent = up
        ? `保存し、${mdLabel(up.r.start)}〜${mdLabel(up.r.end)} の ${up.n} 件を intervals.icu の予定表に上書き登録しました。直近7日分が Zwift に送られます。`
        : '保存しました。intervals.icu の API キーが無いため、予定表には登録していません。';
    } catch (err) {
      status.textContent = `保存しましたが、intervals.icu への登録に失敗しました（${err.message}）。「設定」の登録ボタンで登録し直してください。`;
    }
    renderAdjHistory();
  });

  function renderAdjHistory() {
    const el = $('adjHistory');
    const entries = Object.entries(state.adjustments || {});
    if (!entries.length || !menus) { el.innerHTML = ''; return; }
    const label = (key) => {
      const [phase, blk] = key.split(':');
      const p = menus.phases.find((x) => x.id === phase);
      return `${p ? p.name : phase}${blk === 'all' ? '' : ` ブロック${blk}`}`;
    };
    const order = (key) => { const [phase, blk] = key.split(':'); return menus.phases.findIndex((x) => x.id === phase) * 10 + (blk === 'all' ? 0 : Number(blk)); };
    el.innerHTML = `<h3>反映済みの調整</h3><div class="scroll"><table><thead><tr><th>対象</th><th>強度</th><th>Z2</th><th></th></tr></thead><tbody>${
      entries.sort((a, b) => order(a[0]) - order(b[0])).map(([key, a]) => `<tr><td>${esc(label(key))}</td>
        <td>${Object.entries(a.kinds || {}).map(([k, v]) => `${esc(C.SESSION_KINDS[k])} ${v > 0 ? '+' : ''}${v}%`).join('<br>') || 'そのまま'}</td>
        <td>${a.z2Pct ? `${a.z2Pct}%` : 'そのまま'}</td>
        <td><button type="button" class="del" data-adjkey="${esc(key)}">取り消す</button></td></tr>`).join('')
    }</tbody></table></div>`;
  }

  $('adjHistory').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-adjkey]');
    if (!btn) return;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'もう一度押して取り消す';
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = '取り消す'; } }, 3000);
      return;
    }
    const key = btn.dataset.adjkey;
    delete state.adjustments[key];
    save();
    const [phase, blk] = key.split(':');
    const pi = menus.phases.findIndex((x) => x.id === phase);
    const status = $('reviewStatus');
    status.hidden = false;
    try {
      // 取り消したブロック以降(同じ期)の予定を登録し直す
      const p = menus.phases[pi];
      const r0 = R().blockRange(menus, pi, blk === 'all' ? null : Number(blk));
      const key2 = (state.settings.icuKey || '').trim();
      if (key2) {
        const events = window.Intervals.buildEvents(menus, r0.start, C.parseDate(p.end), adjustMenu);
        await window.Intervals.uploadEvents(key2, events);
        status.textContent = `取り消し、${mdLabel(r0.start)}〜${mdLabel(C.parseDate(p.end))} の予定を登録し直しました。`;
      } else status.textContent = '取り消しました。';
    } catch (err) {
      status.textContent = `取り消しましたが、intervals.icu への登録に失敗しました（${err.message}）。`;
    }
    renderAdjHistory();
  });

  // ---------- 履歴 ----------

  function renderHistory() {
    const body = $('historyBody');
    const rows = [...state.history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.savedAt - a.savedAt));
    $('historyEmpty').hidden = rows.length > 0;
    body.innerHTML = rows.map((r) => {
      const detail = r.mode === 'A'
        ? `パワー ${fmt(r.avgPower)}W × ${esc(r.inputs?.time ?? fmt(r.minutes, 1))}`
        : `タイム ${fmt(r.inputs?.distanceKm, 1)}km / ${fmt(r.inputs?.gainM)}m / ${esc(r.inputs?.time ?? '')}`;
      return `<tr>
        <td>${esc(r.date.slice(2).replace(/-/g, '/'))}</td>
        <td>${esc(r.name || '—')}<br><span class="hint">${detail}</span></td>
        <td class="num">${fmt(r.avgPower)}</td>
        <td class="num">${fmt(r.ftp)}</td>
        <td class="num">${r.weight ? fmt(r.ftp / r.weight, 2) : '—'}</td>
        <td><button type="button" class="del" data-id="${esc(r.id)}">削除</button></td>
      </tr>`;
    }).join('');
  }

  // confirm() は使えない環境があるため、2回押しで削除
  $('historyBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'もう一度押して削除';
      setTimeout(() => {
        if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = '削除'; }
      }, 3000);
      return;
    }
    state.history = state.history.filter((r) => r.id !== btn.dataset.id);
    save();
    renderHistory();
    renderHeader();
  });

  // ---------- ブロック振り返りの調整を反映したメニュー ----------

  function adjustMenu(menu, date) {
    return window.Review.applyAdjustment(menu, window.Review.adjustmentFor(date, menus, state.adjustments));
  }

  function findAdjusted(phase, info, day, date) {
    const f = C.findDayMenu(phase, info, day);
    return f ? { ...f, menu: adjustMenu(f.menu, date) } : null;
  }

  // ---------- メニュー ----------

  const sel = { phase: 0, week: 1, day: 'mon' };
  let todayInfo = null;

  function dateOf(phaseIndex, week, day) {
    const d = C.parseDate(menus.phases[phaseIndex].start);
    d.setDate(d.getDate() + (week - 1) * 7 + C.WEEK_ORDER.indexOf(day));
    return d;
  }

  function weeksOf(phaseIndex) {
    return C.getPhaseAndWeek(C.parseDate(menus.phases[phaseIndex].end), menus).totalWeeks;
  }

  function selectToday() {
    todayInfo = C.getPhaseAndWeek(new Date(), menus);
    sel.day = todayInfo.day;
    if (todayInfo.status === 'in') {
      sel.phase = todayInfo.phaseIndex;
      sel.week = todayInfo.week;
    } else if (todayInfo.status === 'after') {
      sel.phase = menus.phases.length - 1;
      sel.week = weeksOf(sel.phase);
    } else {
      sel.phase = 0;
      sel.week = 1;
    }
  }

  function weekLabel(info) {
    if (info.phase.blocks === false) return `${info.week}週目`;
    return `${info.week}週目（ブロック${info.block}・${info.isRecovery ? '回復週' : '負荷週'}）`;
  }

  function weekChip(info) {
    if (info.phase.blocks === false) return `<span class="chip peak">ピーキング ${info.week}/${info.totalWeeks}週</span>`;
    return info.isRecovery
      ? `<span class="chip recovery">回復週</span>`
      : `<span class="chip load">負荷週 ${info.weekInBlock}/${(menus.blockWeeks || 3) - 1}</span>`;
  }

  function renderToday() {
    const card = $('todayCard');
    const t = todayInfo;
    const now = new Date();
    const race = menus.raceDate ? C.parseDate(menus.raceDate) : null;
    const toRace = race ? C.daysBetween(now, race) : null;
    const raceChip = toRace !== null && toRace >= 0
      ? `<span class="chip">${esc(menus.raceName || 'レース')}まであと${toRace}日</span>` : '';
    let html = `<div class="eyebrow">今日 ${now.getMonth() + 1}/${now.getDate()}（${C.DAY_LABELS[t.day]}）</div>`;
    if (t.status === 'in') {
      html += `<div class="headline">${esc(t.phase.name)} ${weekLabel(t)}</div>
        <div class="chips">${weekChip(t)}<span class="chip">${t.week}/${t.totalWeeks}週</span>${raceChip}</div>`;
    } else if (t.status === 'before') {
      const p = menus.phases[0];
      html += `<div class="headline">シーズン開始前</div>
        <div class="chips"><span class="chip">${esc(p.name)}開始（${mdLabel(C.parseDate(p.start))}）まであと${t.daysUntilStart}日</span>${raceChip}</div>`;
    } else if (t.status === 'after') {
      html += `<div class="headline">シーズン終了</div><div class="hint">期分けの期間は終わりました。下のメニューは閲覧できます。</div>`;
    } else {
      html += `<div class="headline">期の定義の間の日です</div><div class="hint">menus.json の期間に隙間があります。</div>`;
    }
    card.innerHTML = html;
  }

  function renderSelectors() {
    $('phaseSelect').innerHTML = menus.phases
      .map((p, i) => `<option value="${i}"${i === sel.phase ? ' selected' : ''}>${esc(p.name)}（${mdLabel(C.parseDate(p.start))}〜${mdLabel(C.parseDate(p.end))}）</option>`)
      .join('');
    const n = weeksOf(sel.phase);
    let opts = '';
    for (let w = 1; w <= n; w++) {
      const info = C.getPhaseAndWeek(dateOf(sel.phase, w, 'mon'), menus);
      const suffix = info.phase.blocks === false ? '' : info.isRecovery ? '・回復' : `・B${info.block}`;
      opts += `<option value="${w}"${w === sel.week ? ' selected' : ''}>${w}週目 ${mdLabel(dateOf(sel.phase, w, 'mon'))}〜${suffix}</option>`;
    }
    $('weekSelect').innerHTML = opts;
  }

  function zoneOf(pct) {
    const p = Array.isArray(pct) ? (pct[0] + pct[1]) / 2 : pct;
    if (p < 56) return 'z1';
    if (p < 76) return 'z2';
    if (p < 88) return 'z3';
    if (p < 95) return 'z4';
    if (p < 106) return 'z5';
    if (p < 121) return 'z6';
    return 'z7';
  }

  const fmtW = (x) => (x.isRange ? `${x.w[0]}–${x.w[1]}` : `${x.w[0]}`);
  const fmtWkg = (x) => (x.wkg ? (x.isRange ? `${fmt(x.wkg[0], 2)}–${fmt(x.wkg[1], 2)}` : fmt(x.wkg[0], 2)) : '—');
  const fmtPct = (x) => (x.isRange ? `${x.pct[0]}–${x.pct[1]}%` : `${x.pct[0]}%`);

  function powerLine(x, hasFtp) {
    if (!hasFtp) return `<span class="w">${fmtPct(x)}</span><span class="pct">FTP</span>`;
    return `<span class="w">${fmtW(x)}<small class="unit"> W</small></span><span class="wkg">${fmtWkg(x)} W/kg</span><span class="pct">${fmtPct(x)}</span>`;
  }

  function inlinePower(x, sec, hasFtp) {
    const p = hasFtp ? `<b>${fmtW(x)}W</b>（${fmtWkg(x)} W/kg・${fmtPct(x)}）` : `<b>${fmtPct(x)}</b>`;
    return `${C.formatDuration(sec)} @ ${p}`;
  }

  /** 区間 → 強度プロファイル用のブロック列 [{sec, pct}] */
  function profileBlocks(segments) {
    const blocks = [];
    const mid = (x) => (x.pct[0] + x.pct[1]) / 2;
    for (const s of segments) {
      if (s.type === 'steady') blocks.push({ sec: s.totalSec, pct: mid(s), zone: zoneOf(s.pct) });
      else if (s.type === 'note') blocks.push({ sec: s.totalSec || 60, pct: 100, zone: 'z7', note: true });
      else {
        for (let set = 0; set < s.sets; set++) {
          for (let r = 0; r < s.reps; r++) {
            if (s.restFirst) blocks.push({ sec: s.rest.sec, pct: mid(s.rest), zone: zoneOf(s.rest.pct) });
            blocks.push({ sec: s.work.sec, pct: mid(s.work), zone: zoneOf(s.work.pct) });
            if (s.rest && !s.restFirst && r < s.reps - 1) blocks.push({ sec: s.rest.sec, pct: mid(s.rest), zone: zoneOf(s.rest.pct) });
          }
          if (s.setRest && set < s.sets - 1) blocks.push({ sec: s.setRest.sec, pct: mid(s.setRest), zone: zoneOf(s.setRest.pct) });
        }
      }
    }
    return blocks;
  }

  function renderDay() {
    const { ftp } = currentFtp();
    const weight = currentWeight();
    const phase = menus.phases[sel.phase];
    const date = dateOf(sel.phase, sel.week, sel.day);
    const info = C.getPhaseAndWeek(date, menus);
    const found = findAdjusted(phase, info, sel.day, date);
    const el = $('dayDetail');
    const dayHead = `${mdLabel(date)}（${C.DAY_LABELS[sel.day]}）`;
    const notice = [];
    if (!ftp) notice.push('FTP が未設定のため %FTP で表示しています。「TT入力」で記録するか「設定」で手入力してください。');
    if (!weight) notice.push('体重が未設定のため W/kg を表示できません。「設定」で入力してください。');
    $('menuNotice').innerHTML = notice.map(esc).join('<br>');
    $('menuNotice').hidden = notice.length === 0;

    if (!found) {
      zwoTarget = null;
      logTarget = null;
      el.innerHTML = `<div class="day-head"><h2>${dayHead} 休養</h2></div><p class="rest-day">この日のメニューはありません。</p>`;
      return;
    }
    const r = C.resolveMenu(found.menu, ftp || 100, weight);
    const hasFtp = !!ftp;
    const blocks = profileBlocks(r.segments);
    const profile = blocks
      .map((b) => `<span style="flex:${b.sec} 1 0;height:${Math.max(6, Math.min(b.pct, 160) / 160 * 100)}%;background:var(--${b.zone});${b.note ? 'opacity:.35' : ''}"></span>`)
      .join('');

    const segs = r.segments.map((s) => {
      if (s.type === 'note') {
        return `<li class="seg"><span class="zone" style="background:var(--line)"></span>
          <span class="label">${esc(s.label)}</span><span class="time">${s.totalSec ? C.formatDuration(s.totalSec) : ''}</span>
          ${s.note ? `<span class="sub">${esc(s.note)}</span>` : ''}</li>`;
      }
      if (s.type === 'steady') {
        return `<li class="seg"><span class="zone" style="background:var(--${zoneOf(s.pct)})"></span>
          <span class="label">${esc(s.label)}</span><span class="time">${C.formatDuration(s.totalSec)}</span>
          <span class="power">${powerLine(s, hasFtp)}</span>
          ${s.note ? `<span class="sub">${esc(s.note)}</span>` : ''}</li>`;
      }
      const one = s.restFirst
        ? `(${C.formatDuration(s.rest.sec)}つなぎ → ${C.formatDuration(s.work.sec)})`
        : C.formatDuration(s.work.sec);
      const reps = `${s.sets > 1 ? `${s.sets}セット × ` : ''}${s.reps} × ${one}`;
      const lines = [];
      if (s.rest) lines.push(`つなぎ ${inlinePower(s.rest, s.rest.sec, hasFtp)}`);
      if (s.setRest) lines.push(`セット間 ${inlinePower(s.setRest, s.setRest.sec, hasFtp)}`);
      if (s.note) lines.push(esc(s.note));
      return `<li class="seg"><span class="zone" style="background:var(--${zoneOf(s.work.pct)})"></span>
        <span class="label">${esc(s.label)}　${reps}</span><span class="time">${C.formatDuration(s.totalSec)}</span>
        <span class="power">${powerLine(s.work, hasFtp)}</span>
        ${lines.map((l) => `<span class="sub">${l}</span>`).join('')}</li>`;
    }).join('');

    el.innerHTML = `
      <div class="day-head"><h2>${dayHead} ${esc(r.title)}${found.menu.adjusted ? ` <span class="chip peak">調整 ${esc(found.menu.adjusted)}</span>` : ''}</h2><span class="day-total">${C.formatDuration(r.totalSec)}</span></div>
      <div class="profile" aria-hidden="true">${profile}</div>
      <ul class="segs">${segs}</ul>
      ${r.notes.length ? `<ul class="day-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${liftHtml(date)}
      ${C.isKeySession(found.menu) ? sessionLogHtml(date, found.menu) : ''}
      <div class="zwo-row">
        <div class="btn-row">
          <button type="button" class="ghost" id="icuCopy">intervals.icu 用にコピー</button>
          <button type="button" class="ghost" id="zwoSave">.zwo を保存</button>
        </div>
        <span class="hint">「設定」の intervals.icu 連携で予定表にまとめて登録すると、Zwift に自動で入ります。コピーしたテキストは intervals.icu のワークアウトの説明欄に貼るとそのまま組み立てられます。Zwift側のFTPは${ftp ? ` ${fmt(ftp)}W に` : 'このアプリと同じ値に'}合わせてください。</span>
        <textarea class="copy-area" id="icuCopyArea" readonly hidden></textarea>
      </div>`;
    logTarget = { date: isoDate(date), menu: found.menu, phase: phase.id, week: info.week, block: info.block };
    zwoTarget = {
      menu: found.menu,
      name: `${mdLabel(date)}（${C.DAY_LABELS[sel.day]}）${phase.name} ${found.menu.title}`,
      description: `${phase.name} ${weekLabel(info)}`,
      file: `${isoDate(date)}_${phase.id}_${sel.day}.zwo`,
    };
  }

  // ---------- キーセッションの記録(RPE・実施結果) ----------

  const RESULTS = { done: '最後までできた', partial: '途中でやめた・ERGを下げた', skipped: '休んだ' };
  const rpeLabel = (n) => (n <= 2 ? 'とても楽' : n <= 4 ? '楽' : n <= 6 ? 'ややきつい' : n <= 8 ? 'きつい' : n === 9 ? 'とてもきつい' : '限界');
  let logTarget = null;

  function sessionLogHtml(date, menu) {
    const key = isoDate(date);
    if (C.daysBetween(new Date(), date) > 0) {
      return `<div class="session-log"><div class="log-head"><b>記録</b><span class="hint">当日になると RPE と実施結果を記録できます。</span></div></div>`;
    }
    const rec = state.sessionLog[key] || {};
    const rpeBtns = Array.from({ length: 10 }, (_, i) => i + 1)
      .map((n) => `<button type="button" role="radio" aria-checked="${rec.rpe === n}" data-rpe="${n}"${rec.result === 'skipped' ? ' disabled' : ''}>${n}</button>`).join('');
    const resBtns = Object.entries(RESULTS)
      .map(([k, label]) => `<button type="button" role="radio" aria-checked="${rec.result === k}" data-result="${k}">${label}</button>`).join('');
    const summary = rec.result
      ? `${RESULTS[rec.result]}${rec.rpe && rec.result !== 'skipped' ? `・RPE ${rec.rpe}（${rpeLabel(rec.rpe)}）` : ''}`
      : '未記録';
    return `<div class="session-log" id="sessionLog">
      <div class="log-head"><b>記録</b><span class="chip${rec.result === 'done' ? ' recovery' : rec.result === 'partial' ? ' load' : ''}" id="logSummary">${esc(summary)}</span></div>
      <div class="field">実施結果<div class="result-toggle" role="radiogroup" aria-label="実施結果">${resBtns}</div></div>
      <div class="field">RPE（きつさ 1〜10）<span class="hint" id="rpeHint">${rec.rpe ? `${rec.rpe}：${rpeLabel(rec.rpe)}` : '1 とても楽 〜 10 限界'}</span>
        <div class="rpe-grid" role="radiogroup" aria-label="RPE">${rpeBtns}</div></div>
      <label class="field">メモ（任意）<input type="text" id="logNote" value="${esc(rec.note || '')}" placeholder="例：4本目で心拍が上がりきった" autocomplete="off"></label>
    </div>`;
  }

  function saveSessionLog(patch) {
    if (!logTarget) return;
    const prev = state.sessionLog[logTarget.date] || {};
    const rec = {
      ...prev, ...patch,
      kind: logTarget.menu.kind, title: logTarget.menu.title,
      phase: logTarget.phase, week: logTarget.week, block: logTarget.block ?? null, savedAt: Date.now(),
      ftp: currentFtp().ftp,
    };
    if (rec.result === 'skipped') delete rec.rpe;
    state.sessionLog[logTarget.date] = rec;
    save();
  }

  $('dayDetail').addEventListener('click', (e) => {
    const rpe = e.target.closest('[data-rpe]');
    const res = e.target.closest('[data-result]');
    if (!rpe && !res) return;
    if (rpe) saveSessionLog({ rpe: Number(rpe.dataset.rpe), result: (state.sessionLog[logTarget.date] || {}).result || 'done' });
    if (res) saveSessionLog({ result: res.dataset.result });
    renderDay();
    renderWeekStrip();
  });
  $('dayDetail').addEventListener('change', (e) => {
    if (e.target.id === 'logNote') saveSessionLog({ note: e.target.value.trim() });
  });

  let zwoTarget = null;
  $('dayDetail').addEventListener('click', (e) => {
    if (e.target.closest('#icuCopy') && zwoTarget) {
      const text = window.Intervals.menuToText(zwoTarget.menu);
      const btn = $('icuCopy');
      const fallback = () => {
        // クリップボードが使えない環境では選択状態のテキストを表示して手でコピーしてもらう
        const area = $('icuCopyArea');
        area.value = text;
        area.hidden = false;
        area.focus();
        area.select();
        btn.textContent = '下のテキストを長押ししてコピー';
      };
      try {
        navigator.clipboard.writeText(text).then(() => (btn.textContent = 'コピーしました'), fallback);
      } catch (err) {
        fallback();
      }
      return;
    }
    if (!e.target.closest('#zwoSave') || !zwoTarget) return;
    const xml = window.Zwo.menuToZwo(zwoTarget.menu, { name: zwoTarget.name, description: zwoTarget.description });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = zwoTarget.file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function renderWeekStrip() {
    const phase = menus.phases[sel.phase];
    const today = isoDate(new Date());
    $('weekStrip').innerHTML = C.WEEK_ORDER.map((day) => {
      const date = dateOf(sel.phase, sel.week, day);
      const info = C.getPhaseAndWeek(date, menus);
      const found = findAdjusted(phase, info, day, date);
      let meta = '休';
      let bar = 'var(--line)';
      if (found) {
        const r = C.resolveMenu(found.menu, 100, null);
        meta = r.totalSec ? `${(r.totalSec / 3600).toFixed(1)}h` : '—';
        const peak = r.segments.reduce((m, s) => {
          const x = s.type === 'interval' ? s.work : s.type === 'steady' ? s : null;
          return x ? Math.max(m, x.pct[1]) : m;
        }, 0);
        bar = `var(--${zoneOf(peak || 50)})`;
      }
      const isToday = isoDate(date) === today;
      const rec = found && C.isKeySession(found.menu) ? state.sessionLog[isoDate(date)] : null;
      if (rec && rec.result) meta = rec.result === 'skipped' ? '休んだ' : rec.rpe ? `RPE${rec.rpe}` : '✓';
      return `<button type="button" role="tab" aria-selected="${day === sel.day}" data-day="${day}">
        <span class="dname${isToday ? ' today-mark' : ''}">${C.DAY_LABELS[day]}</span>
        <span class="dbar" style="background:${bar}"></span>
        <span class="dmeta">${meta}</span>${window.Strength.planFor(date, menus) ? '<span class="dlift">DL</span>' : ''}</button>`;
    }).join('');
  }

  function renderPhaseNotes() {
    const p = menus.phases[sel.phase];
    const rows = [['狙い', p.focus], ['量', p.volume], ['体重', p.weightTarget]].filter((r) => r[1]);
    const notes = [...(p.notes || []), ...(menus.commonNotes || [])];
    $('phaseNotes').innerHTML = `<summary>${esc(p.name)}のポイント</summary>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  }

  function renderMenu() {
    renderWeighPrompt();
    renderBackupPrompt();
    if (!menus) return;
    const nowInfo = C.getPhaseAndWeek(new Date(), menus);
    $('reviewPrompt').hidden = !(nowInfo.status === 'in' && nowInfo.isRecovery && ['sat', 'sun'].includes(nowInfo.day));
    renderToday();
    renderSelectors();
    renderWeekStrip();
    renderDay();
    renderPhaseNotes();
  }

  $('phaseSelect').addEventListener('change', (e) => {
    sel.phase = Number(e.target.value);
    sel.week = Math.min(sel.week, weeksOf(sel.phase));
    renderMenu();
  });
  $('weekSelect').addEventListener('change', (e) => {
    sel.week = Number(e.target.value);
    renderMenu();
  });
  $('weekStrip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-day]');
    if (!b) return;
    sel.day = b.dataset.day;
    renderWeekStrip();
    renderDay();
  });
  $('backToday').addEventListener('click', () => {
    selectToday();
    renderMenu();
  });

  async function uploadToIntervals(weeks) {
    const status = $('icuStatus');
    status.hidden = false;
    const key = (state.settings.icuKey || '').trim();
    if (!key) {
      status.textContent = 'intervals.icu の API キーを入れてください。';
      return;
    }
    if (!menus) {
      status.textContent = 'メニューを読み込めていないため登録できません。';
      return;
    }
    const today = new Date();
    const seasonStart = C.parseDate(menus.phases[0].start);
    const seasonEnd = C.parseDate(menus.phases[menus.phases.length - 1].end);
    const from = C.daysBetween(today, seasonStart) > 0 ? seasonStart : today;
    let to = seasonEnd;
    if (weeks) {
      to = new Date(from);
      to.setDate(to.getDate() + weeks * 7 - 1);
      if (C.daysBetween(to, seasonEnd) < 0) to = seasonEnd;
    }
    const events = window.Intervals.buildEvents(menus, from, to, adjustMenu);
    if (!events.length) {
      status.textContent = '登録するメニューがありません（シーズン期間外です）。';
      return;
    }
    status.textContent = `${events.length}件を送信中…`;
    for (const id of ['icuUpload4', 'icuUploadAll']) $(id).disabled = true;
    try {
      await window.Intervals.uploadEvents(key, events);
      status.textContent = `${mdLabel(from)}〜${mdLabel(to)} の ${events.length} 件を intervals.icu の予定表に登録しました。直近7日分が Zwift に送られます。`;
    } catch (err) {
      status.textContent = err instanceof TypeError
        ? 'intervals.icu に接続できませんでした。claude.ai 上のページからは外部に接続できないため、GitHub Pages 版で開いてください。ネットワーク接続も確認してください。'
        : `${err.message}。API キーが正しいか確認してください。`;
    } finally {
      for (const id of ['icuUpload4', 'icuUploadAll']) $(id).disabled = false;
    }
  }
  $('icuUpload4').addEventListener('click', () => uploadToIntervals(4));
  $('icuUploadAll').addEventListener('click', () => uploadToIntervals(null));

  async function loadMenus() {
    try {
      const res = await fetch('menus.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      menus = await res.json();
      selectToday();
      renderMenu();
      if (state.tab === 'weight') renderWeight();
      if (state.tab === 'history') { renderReviewSelect(); renderReview(); }
      if (state.tab === 'prefs') renderOneRm();
    } catch (e) {
      const n = $('menuNotice');
      n.hidden = false;
      n.textContent = location.protocol === 'file:'
        ? 'menus.json を読み込めませんでした。index.html を直接開くとブラウザの制限で読み込めないため、GitHub Pages かローカルサーバー（例: npx serve）で開いてください。'
        : `menus.json を読み込めませんでした（${e.message}）。JSONの書式（カンマや括弧の閉じ忘れ）を確認してください。`;
    }
  }

  // ---------- バックアップ(Google ドライブ) ----------

  const BK = () => window.Backup;
  const GD = () => window.GDrive;
  const clientId = () => (state.settings.googleClientId || '').trim();
  let backupBusy = false;

  function setBackupStatus(text) {
    const el = $('backupStatus');
    el.hidden = !text;
    el.textContent = text || '';
  }

  /** ドライブに保存する。ボタンのタップの中から呼ぶ(Google の許可画面のため) */
  async function backupNow(reason) {
    if (backupBusy) return false;
    if (!clientId()) {
      setBackupStatus('「Google のクライアント ID」を入れてください。');
      return false;
    }
    backupBusy = true;
    setBackupStatus('Google ドライブに保存中…');
    try {
      const token = await GD().getToken(clientId());
      const folderId = await GD().ensureFolder(token, BK().FOLDER_NAME, state.backup && state.backup.folderId);
      const now = new Date();
      const name = BK().fileName(now);
      await GD().saveJson(token, folderId, name, BK().buildBackup(state, now));
      state.backup = { ...(state.backup || {}), folderId, lastDate: isoDate(now), lastAt: Date.now(), lastFile: name };
      save();
      setBackupStatus(`${name} を保存しました${reason === 'weight' ? '（体重の記録と一緒に保存）' : ''}。`);
      return true;
    } catch (err) {
      setBackupStatus(`バックアップできませんでした：${err.message}`);
      return false;
    } finally {
      backupBusy = false;
      renderBackup();
      renderBackupPrompt();
    }
  }

  /** 今週まだなら保存する(月曜の体重記録から呼ぶ) */
  async function backupIfDue(reason) {
    if (!clientId() || !BK().isDue(state.backup && state.backup.lastDate)) return;
    const ok = await backupNow(reason);
    if (!ok && state.tab !== 'prefs') {
      // 失敗したときはメニュー画面のお知らせから再試行できる
      renderBackupPrompt();
    }
  }

  function renderBackupPrompt() {
    const due = !!clientId() && BK().isDue(state.backup && state.backup.lastDate);
    // 月曜で体重がまだなら、体重の記録と一緒に保存されるので出さない
    const weighPending = !$('weighPrompt').hidden;
    $('backupPrompt').hidden = !due || weighPending;
  }

  function renderBackup() {
    $('pGoogleClientId').value = state.settings.googleClientId || '';
    const b = state.backup || {};
    $('backupLast').innerHTML = b.lastDate
      ? `最後のバックアップ <b>${mdLabel(C.parseDate(b.lastDate))}</b>（${esc(b.lastFile || '')}）`
      : 'まだバックアップしていません。';
    $('backupNow').disabled = $('backupList').disabled = !clientId() || backupBusy;
  }

  $('pGoogleClientId').addEventListener('input', (e) => {
    state.settings.googleClientId = e.target.value.trim();
    save();
    if (clientId()) GD().loadGis().catch(() => {});
    renderBackup();
  });
  $('backupNow').addEventListener('click', () => backupNow('manual'));
  $('backupPromptBtn').addEventListener('click', () => backupNow('prompt'));

  // 復元: 一覧 → 選ぶ → 中身を確認 → 復元
  let restoreTarget = null;
  $('backupList').addEventListener('click', async () => {
    const box = $('backupFiles');
    restoreTarget = null;
    setBackupStatus('バックアップの一覧を取得中…');
    try {
      const token = await GD().getToken(clientId());
      const folderId = await GD().ensureFolder(token, BK().FOLDER_NAME, state.backup && state.backup.folderId);
      state.backup = { ...(state.backup || {}), folderId };
      save();
      const files = await GD().listJson(token, folderId);
      setBackupStatus(files.length ? `${files.length} 件のバックアップがあります。` : 'まだバックアップがありません。');
      box.innerHTML = files.length ? `<div class="table-scroll"><table class="history"><thead><tr><th>ファイル</th><th></th></tr></thead><tbody>${
        files.map((f) => `<tr><td>${esc(f.name)}</td><td><button type="button" class="del" data-restore="${esc(f.id)}" data-name="${esc(f.name)}">復元</button></td></tr>`).join('')
      }</tbody></table></div>` : '';
    } catch (err) {
      setBackupStatus(`一覧を取得できませんでした：${err.message}`);
    }
  });

  $('backupFiles').addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-restore]');
    const go = e.target.closest('#restoreGo');
    if (pick) {
      setBackupStatus(`${pick.dataset.name} を読み込み中…`);
      try {
        const token = await GD().getToken(clientId());
        const obj = await GD().readJson(token, pick.dataset.restore);
        const err = BK().validate(obj);
        if (err) { setBackupStatus(err); return; }
        restoreTarget = obj;
        const n = BK().summary(obj);
        const old = $('restoreConfirm');
        if (old) old.remove();
        $('backupFiles').insertAdjacentHTML('beforeend', `<div class="notice" id="restoreConfirm">
          <p><b>${esc(pick.dataset.name)}</b>（${esc(obj.date || '')}）の内容：TT ${n.tt}件・体重 ${n.weight}件・RPE の記録 ${n.sessions}件・1RM ${n.oneRm}件・調整 ${n.adjustments}件</p>
          <p>復元すると、この端末の今のデータは置き換わります（intervals.icu の API キーと Google の設定は残ります）。</p>
          <button type="button" class="primary" id="restoreGo">この内容で復元する</button></div>`);
        setBackupStatus('内容を確認してください。');
      } catch (err2) {
        setBackupStatus(`読み込めませんでした：${err2.message}`);
      }
      return;
    }
    if (go && restoreTarget) {
      try {
        const next = BK().restore(state, restoreTarget);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (err3) {
        setBackupStatus(`復元できませんでした：${err3.message}`);
        return;
      }
      location.reload();
    }
  });

  // クライアント ID があれば Google のスクリプトを先に読み込んでおく(タップ時にポップアップが止められないように)
  if (clientId()) GD().loadGis().catch(() => {});

  // ---------- 起動 ----------

  fillPrefs();
  $('ttDate').value = isoDate(new Date());
  if (state.mode === 'B') $('modeB').checked = true;
  $('fieldsA').hidden = state.mode !== 'A';
  $('fieldsB').hidden = state.mode !== 'B';
  renderHeader();
  computeTT();
  showTab(state.tab);
  loadMenus();
})();
