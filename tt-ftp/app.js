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

  const TABS = ['menu', 'tt', 'history', 'prefs'];
  function showTab(name) {
    if (!TABS.includes(name)) name = 'menu';
    for (const t of TABS) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
      $(`view-${t}`).hidden = t !== name;
    }
    state.tab = name;
    save();
    if (name === 'menu') renderMenu();
    if (name === 'history') renderHistory();
  }
  for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => showTab(t));

  // ---------- 設定 ----------

  const prefFields = {
    pWeight: 'weight', pFtp: 'ftpOverride', pBike: 'bikeKg', pCda: 'cda', pCrr: 'crr', pLoss: 'lossPct', pK: 'k',
  };

  function fillPrefs() {
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
    $('prefsToast').hidden = false;
    clearTimeout(prefsToastTimer);
    prefsToastTimer = setTimeout(() => ($('prefsToast').hidden = true), 1500);
  });
  $('prefsForm').addEventListener('submit', (e) => e.preventDefault());

  $('resetAdvanced').addEventListener('click', () => {
    const d = defaultState().settings;
    for (const key of ['bikeKg', 'cda', 'crr', 'lossPct', 'k']) state.settings[key] = d[key];
    save();
    fillPrefs();
    computeTT();
  });

  function physicsSettings() {
    const s = state.settings;
    const d = defaultState().settings;
    const pick = (k) => (num(s[k]) === null ? d[k] : num(s[k]));
    return { bikeKg: pick('bikeKg'), cda: pick('cda'), crr: pick('crr'), drivetrainLoss: pick('lossPct') / 100, k: pick('k') };
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
    const found = C.findDayMenu(phase, info, sel.day);
    const el = $('dayDetail');
    const dayHead = `${mdLabel(date)}（${C.DAY_LABELS[sel.day]}）`;
    const notice = [];
    if (!ftp) notice.push('FTP が未設定のため %FTP で表示しています。「TT入力」で記録するか「設定」で手入力してください。');
    if (!weight) notice.push('体重が未設定のため W/kg を表示できません。「設定」で入力してください。');
    $('menuNotice').innerHTML = notice.map(esc).join('<br>');
    $('menuNotice').hidden = notice.length === 0;

    if (!found) {
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
      <div class="day-head"><h2>${dayHead} ${esc(r.title)}</h2><span class="day-total">${C.formatDuration(r.totalSec)}</span></div>
      <div class="profile" aria-hidden="true">${profile}</div>
      <ul class="segs">${segs}</ul>
      ${r.notes.length ? `<ul class="day-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }

  function renderWeekStrip() {
    const phase = menus.phases[sel.phase];
    const today = isoDate(new Date());
    $('weekStrip').innerHTML = C.WEEK_ORDER.map((day) => {
      const date = dateOf(sel.phase, sel.week, day);
      const info = C.getPhaseAndWeek(date, menus);
      const found = C.findDayMenu(phase, info, day);
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
      return `<button type="button" role="tab" aria-selected="${day === sel.day}" data-day="${day}">
        <span class="dname${isToday ? ' today-mark' : ''}">${C.DAY_LABELS[day]}</span>
        <span class="dbar" style="background:${bar}"></span>
        <span class="dmeta">${meta}</span></button>`;
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
    if (!menus) return;
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

  async function loadMenus() {
    try {
      const res = await fetch('menus.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      menus = await res.json();
      selectToday();
      renderMenu();
    } catch (e) {
      const n = $('menuNotice');
      n.hidden = false;
      n.textContent = location.protocol === 'file:'
        ? 'menus.json を読み込めませんでした。index.html を直接開くとブラウザの制限で読み込めないため、GitHub Pages かローカルサーバー（例: npx serve）で開いてください。'
        : `menus.json を読み込めませんでした（${e.message}）。JSONの書式（カンマや括弧の閉じ忘れ）を確認してください。`;
    }
  }

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
