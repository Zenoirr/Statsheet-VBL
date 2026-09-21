'use strict';
/* =====================================================
   VBL STATS — app.js
   Painel de estatísticas de vôlei por set, com ratings por
   função, substituições, histórico local e feedback.
===================================================== */

/* ---------- constants & data model ---------- */
const STORAGE_KEY   = 'vbl_match_v2';
const HISTORY_KEY   = 'vbl_history_v2';
const LOG_SEEN_KEY  = 'vbl_seen_log_v2';
const CURRENT_LOG   = '2.0';
const FEEDBACK_HOOK = 'https://discord.com/api/webhooks/1499136757302694064/VhXFResF9kvZq6_5MQHj7C_srELShvBS7WltYL_H3tpViQ5zcJJtXxTIvuC80a1_dJUc';

const uid = () => Math.random().toString(36).slice(2, 9);

// [role, name, scored, scoredOn, mistakeOf, mistakeDef, assist, block]
const DEFAULT_ROWS = () => ([
  ['Ponteiro',  'Player1', 0, 0, 0, 0, 0, 0],
  ['Oposto',    'Player2', 0, 0, 0, 0, 0, 0],
  ['Líbero',    'Player3', 0, 0, 0, 0, 0, 0],
  ['Ds Spiker', 'Player4', 0, 0, 0, 0, 0, 0],
  ['Ds Tsk',    'Player5', 0, 0, 0, 0, 0, 0],
  ['Setter',    'Player6', 0, 0, 0, 0, 0, 0],
]);

const FIELDS = {
  Setter: [['Assistências', 6], ['Block', 7], ['Pontos Feitos', 2], ['Erro Ofensivo', 4], ['Erro Defensivo', 5]],
  'Ds Tsk': [['Assistências', 6], ['Pontos Feitos', 2], ['Pontos Tomados', 3], ['Erro Ofensivo', 4], ['Erro Defensivo', 5]],
  default: [['Pontos Feitos', 2], ['Pontos Tomados', 3], ['Erro Ofensivo', 4], ['Erro Defensivo', 5]],
};

const ROLE_CSS = {
  Ponteiro: 'ponteiro', Oposto: 'oposto', 'Líbero': 'libero',
  'Ds Spiker': 'dsspiker', 'Ds Tsk': 'dstsk', Setter: 'setter',
};

const ICONS = {
  score: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.8"/></svg>`,
  taken: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3z" stroke="currentColor" stroke-width="1.8"/></svg>`,
  assist: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 12h8.5M12 8l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  block: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5c0 4.7-2.7 8.4-5 10-2.3-1.6-5-5.3-5-10V4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  off: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 19L19 5M8 5l11 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  def: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3z" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.3h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  rate: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1-4.4-4.3 6.1-.9L12 3.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
};

/* ---------- pure calculations ---------- */
const clamp10 = n => +Math.max(0, Math.min(10, n)).toFixed(1);
const isActive = r => !!(+r[2] || +r[3] || +r[4] || +r[5] || +r[6] || +r[7]);
const roleCss = role => ROLE_CSS[role] || role.toLowerCase().replace(/\s+/g, '');

function rating(r) {
  const [role, , scored, scoredOn, mOf, mDef, assist, block] = r;
  if (!isActive(r)) return 0;
  if (role === 'Setter') {
    return clamp10(7.4 + assist * .20 + block * .02 + scored * .08 - mOf * .17 - mDef * .11);
  }
  if (role === 'Ds Tsk') {
    return clamp10(8.0 + assist * .14 + scored * .13 - scoredOn * .06 - mOf * .08 - mDef * .05);
  }
  const dif = scored - scoredOn;
  if (role === 'Ds Spiker') {
    return clamp10(6.7 + Math.max(0, dif) * .18 - Math.max(0, -dif) * .12 + Math.min(1.3, scored * .08) - mOf * .17 - mDef * .15);
  }
  if (role === 'Ponteiro' || role === 'Oposto' || role === 'Líbero') {
    const isLibero = role === 'Líbero';
    const plus = isLibero ? .075 : .06;
    const gain = isLibero ? .16 : .16;
    const loss = isLibero ? .20 : .24;
    const ofPen = isLibero ? .18 : .24;
    const base = isLibero ? 6.7 : 6.6;
    return clamp10(base + Math.max(0, dif) * gain - Math.max(0, -dif) * loss + Math.min(1.0, scored * plus) - mOf * ofPen - mDef * .20);
  }
  return clamp10(5.4 + Math.max(0, dif) * .16 - Math.max(0, -dif) * .22 + Math.min(1.0, scored * .06) - mOf * .22 - mDef * .20);
}

function mvpScore(r) {
  if (!isActive(r)) return -999;
  const [role, , scored, scoredOn, mOf, mDef, assist, block] = r;
  const base = rating(r);
  if (role === 'Setter') return base + assist * .025 + block * .015 + scored * .04 - (mOf + mDef) * .05;
  if (role === 'Ds Tsk') return base + assist * .018 + scored * .04 - scoredOn * .02 - (mOf + mDef) * .05;
  const w = role === 'Ds Spiker' ? .018 : role === 'Líbero' ? .024 : .02;
  return base + (scored - scoredOn) * .12 + scored * w - mOf * .06 - mDef * .06;
}

const efficiency = r => isActive(r) ? Math.round(rating(r) * 10) : 0;
const consistency = r => !isActive(r) ? '–' : rating(r) >= 8 ? 'Alta' : rating(r) >= 5.5 ? 'Média' : 'Baixa';

const ratingClass = v => !v ? 'v-zero' : v >= 8 ? 'v-excel' : v >= 7 ? 'v-good' : v >= 5 ? 'v-mid' : v >= 4 ? 'v-low' : 'v-bad';
const effClass = v => !v ? 'v-zero' : v >= 80 ? 'v-excel' : v >= 70 ? 'v-good' : v >= 50 ? 'v-mid' : v >= 40 ? 'v-low' : 'v-bad';
const consClass = c => c === 'Alta' ? 'v-excel' : c === 'Média' ? 'v-good' : c === 'Baixa' ? 'v-bad' : 'v-zero';

function ratingBadge(v) {
  if (v >= 8.5) return '🔥';
  if (v >= 7) return '✅';
  if (v >= 5.5) return '⚖️';
  if (v >= 4) return '❄️';
  return '💀';
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const fmtDur = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const fmtDate = ts => { try { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

/* =====================================================
   APP
===================================================== */
class VBLApp {
  constructor() {
    this.el = this._collectEls();
    this._loadState();
    this.currentView = 'set1';
    this.currentSet = 0;
    this.openFinalKey = null;
    this.openHistoryId = null;
    this.openHistoryPlayer = null;
    this.resetArmed = false;
    this.clearHistoryArmed = false;
    this.subTarget = null;
    this.lastSummary = { errors: 0, avg: '0.0' };

    this._bindNav();
    this._bindBoard();
    this._bindCards();
    this._bindSubModal();
    this._bindFeedback();
    this._bindChangelog();
    this._bindHistory();

    this._syncBoard();
    this.render();
    this._startTimer();
    this._maybeShowChangelog();
  }

  /* ---------- element refs ---------- */
  _collectEls() {
    const $ = id => document.getElementById(id);
    return {
      side: $('side'), scrim: $('side-scrim'), burger: $('mtop-burger'), mtopDot: $('mtop-status-dot'),
      nav: $('nav'),
      t1: $('t1'), t2: $('t2'), s1: $('s1'), s2: $('s2'), status: $('match-status'), duration: $('board-duration'),
      resetBtn: $('reset-set'), saveBtn: $('save-match'),
      statErrors: $('stat-errors'), statWeak: $('stat-weak'), statAvg: $('stat-avg'), statPerf: $('stat-perf'),
      errorsCard: document.querySelector('.sum-card--errors'),
      cards: $('cards'),
      viewSet: $('view-set'), viewFinal: $('view-final'), viewHistory: $('view-history'),
      finalTable: $('final-table'),
      histList: $('history-list'), histClear: $('clear-history'),
      subModal: $('modal-sub'), subRole: $('sub-role'), subOut: $('sub-out'), subIn: $('sub-in'),
      subChecks: [...document.querySelectorAll('#sub-set-checks input')], subHint: $('sub-hint'),
      subApply: $('sub-apply'), subCancel: $('sub-cancel'), subClose: $('sub-close'),
      fbModal: $('modal-feedback'), fbOpen: $('open-feedback'), fbClose: $('feedback-close'),
      fbName: $('fb-name'), fbType: $('fb-type'), fbPriority: $('fb-priority'), fbContact: $('fb-contact'),
      fbText: $('fb-text'), fbCount: $('fb-count'), fbStatus: $('fb-status'), fbSend: $('fb-send'),
      logModal: $('modal-log'), logOpen: $('open-log'), logClose: $('log-close'), logTabs: $('log-tabs'), logContent: $('log-content'),
      toastZone: $('toast-zone'),
    };
  }

  /* ---------- state ---------- */
  _loadState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* ignore */ }
    this.state = saved || {
      t1: 'TIME 1', t2: 'TIME 2',
      sets: [DEFAULT_ROWS(), DEFAULT_ROWS(), DEFAULT_ROWS()],
      manualScores: [0, 0],
      status: 0, duration: 0,
      subs: [], subSegments: [],
    };
    // normalize shape in case of older/partial saves
    this.state.sets = (this.state.sets || [DEFAULT_ROWS(), DEFAULT_ROWS(), DEFAULT_ROWS()]).map(set =>
      set.map((row, i) => {
        const base = DEFAULT_ROWS()[i];
        return [base[0], (row && row[1]) || base[1], +(row?.[2] || 0), +(row?.[3] || 0), +(row?.[4] || 0), +(row?.[5] || 0), +(row?.[6] || 0), +(row?.[7] || 0)];
      })
    );
    this.state.manualScores = this.state.manualScores || [0, 0];
    this.state.subs = this.state.subs || [];
    this.state.subSegments = this.state.subSegments || [];
    if (this.state.status === undefined) {
      this.state.status = this.state.sets.flat().some(isActive) ? 1 : 0;
    }
  }

  _save() {
    this.state.t1 = this.el.t1.value;
    this.state.t2 = this.el.t2.value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  get rows() { return this.state.sets[this.currentSet]; }

  setLive() {
    if (this.state.status !== 1) { this.state.status = 1; this._syncStatus(); this._save(); }
  }

  /* ---------- board ---------- */
  _syncBoard() {
    this.el.t1.value = this.state.t1;
    this.el.t2.value = this.state.t2;
    this.el.s1.textContent = this.state.manualScores[0];
    this.el.s2.textContent = this.state.manualScores[1];
    this._syncStatus();
  }

  _syncStatus() {
    const el = this.el.status, dot = this.el.mtopDot;
    el.classList.remove('is-live', 'is-done');
    dot.classList.remove('is-live', 'is-done');
    if (this.state.status === 0) el.textContent = 'NÃO COMEÇOU';
    else if (this.state.status === 1) { el.textContent = 'EM ANDAMENTO'; el.classList.add('is-live'); dot.classList.add('is-live'); }
    else { el.textContent = 'FINALIZADA'; el.classList.add('is-done'); dot.classList.add('is-done'); }
  }

  _startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.el.duration.textContent = fmtDur(this.state.duration || 0);
    this.timer = setInterval(() => {
      if (!this.rows.some(isActive)) return;
      this.state.duration = (this.state.duration || 0) + 1;
      this.el.duration.textContent = fmtDur(this.state.duration);
      if (this.state.duration % 10 === 0) this._save();
    }, 1000);
  }

  _bindBoard() {
    this.el.t1.addEventListener('input', () => this._save());
    this.el.t2.addEventListener('input', () => this._save());
    [this.el.s1, this.el.s2].forEach((el, idx) => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
      el.addEventListener('input', () => this._setManualScore(idx, el.textContent));
      el.addEventListener('blur', () => this._setManualScore(idx, el.textContent));
    });
    this.el.resetBtn.addEventListener('click', () => this._resetSet());
    this.el.saveBtn.addEventListener('click', () => this._saveMatchToHistory());
  }

  _setManualScore(idx, val) {
    let n = parseInt(String(val).replace(/\D/g, ''), 10);
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(2, n));
    const sc = this.state.manualScores;
    sc[idx] = n;
    if (sc[0] === 2 && sc[1] === 2) sc[idx ? 0 : 1] = 1;
    this.el.s1.textContent = sc[0];
    this.el.s2.textContent = sc[1];
    this.setLive();
    this._save();
  }

  /* ---------- navigation ---------- */
  _bindNav() {
    this.el.nav.addEventListener('click', e => {
      const btn = e.target.closest('.side-link');
      if (btn) this._switchView(btn.dataset.view);
    });
    this.el.burger.addEventListener('click', () => this._toggleSidebar(true));
    this.el.scrim.addEventListener('click', () => this._toggleSidebar(false));
  }

  _toggleSidebar(open) {
    this.el.side.classList.toggle('open', open);
    this.el.scrim.classList.toggle('open', open);
  }

  _switchView(view) {
    if (view === this.currentView) { this._toggleSidebar(false); return; }
    this.currentView = view;
    this.el.nav.querySelectorAll('.side-link').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    this._toggleSidebar(false);

    const isSet = view.startsWith('set');
    this.el.viewSet.classList.toggle('is-active', isSet);
    this.el.viewFinal.classList.toggle('is-active', view === 'final');
    this.el.viewHistory.classList.toggle('is-active', view === 'history');

    const summaryEl = document.querySelector('.summary');
    summaryEl.style.display = view === 'history' ? 'none' : 'grid';
    summaryEl.classList.toggle('show-legend', view === 'final');
    document.getElementById('glossary').style.display = view === 'history' ? 'none' : 'grid';

    if (isSet) { this.currentSet = +view.replace('set', '') - 1; this.render(); }
    else if (view === 'final') this._renderFinal();
    else if (view === 'history') this._renderHistory();
  }

  /* ---------- player cards ---------- */
  _bindCards() {
    this.el.cards.addEventListener('click', e => {
      const subBtn = e.target.closest('[data-sub]');
      if (subBtn) { this._openSubModal(+subBtn.dataset.sub); return; }
      const btn = e.target.closest('.counter button');
      if (!btn) return;
      const card = btn.closest('.pcard');
      const idx = +card.dataset.idx, col = +btn.dataset.col;
      const input = card.querySelector(`input[data-col="${col}"]`);
      this._step(input, idx, col, btn.classList.contains('inc') ? 1 : -1, btn);
    });
    this.el.cards.addEventListener('input', e => {
      if (!e.target.matches('input[data-col]')) return;
      const card = e.target.closest('.pcard');
      this._setVal(e.target, +card.dataset.idx, +e.target.dataset.col);
    });
  }

  _step(input, idx, col, dir, btn) {
    this.setLive();
    const row = this.rows[idx];
    row[col] = Math.max(0, (+input.value || 0) + dir);
    input.value = row[col];
    this._save();
    this._updateCardStats();
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  }

  _setVal(input, idx, col) {
    const val = input.type === 'number' ? (+input.value || 0) : input.value;
    if (col === 1) {
      if (this.currentSet === 0) this.state.sets.forEach(set => { if (set[idx]) set[idx][1] = val; });
      else this.rows[idx][1] = val;
    } else {
      this.rows[idx][col] = val;
      if (val > 0) this.setLive();
    }
    this._save();
    this._updateCardStats();
  }

  _buildCardHTML(row, idx) {
    const fields = FIELDS[row[0]] || FIELDS.default;
    const oddClass = fields.length % 2 !== 0 ? ' odd' : '';
    const statsHtml = fields.map(([label, col]) => `
      <div class="field"><span>${esc(label)}</span>
        <div class="counter">
          <button type="button" class="dec" data-col="${col}">&minus;</button>
          <input type="number" data-col="${col}" value="${row[col]}" min="0" step="1" />
          <button type="button" class="inc" data-col="${col}">+</button>
        </div>
      </div>`).join('');

    const activeSub = this._subForSlot(idx, this.currentSet);
    const subTag = activeSub
      ? `<div class="sub-tag">SET ${esc(activeSub.fromSet)} <b>${esc(activeSub.from)}</b> → <em>${esc(activeSub.to)}</em></div>`
      : '';

    return `
    <article class="pcard role-${roleCss(row[0])}" data-idx="${idx}">
      <div class="pcard-top">
        <div class="field"><span>Função</span><div class="role-pill">${esc(row[0])}</div></div>
        <div class="field"><span>Jogador</span>
          <div class="player-line">
            <input data-col="1" value="${esc(row[1])}" />
            <button class="sub-btn" type="button" data-sub="${idx}">SUB</button>
          </div>
        </div>
        ${subTag}
      </div>
      <div class="stat-grid${oddClass}">${statsHtml}</div>
      <div class="pcard-scores">
        <div class="metric"><span>RATING</span><b class="m-rating"></b></div>
        <div class="metric"><span>EFICIÊNCIA</span><b class="m-eff"></b></div>
        <div class="metric"><span>CONSISTÊNCIA</span><b class="m-cons"></b></div>
      </div>
    </article>`;
  }

  render() {
    this.el.cards.innerHTML = this.rows.map((r, i) => this._buildCardHTML(r, i)).join('');
    this._updateCardStats();
  }

  _updateCardStats() {
    this.rows.forEach((row, idx) => {
      const card = this.el.cards.querySelector(`.pcard[data-idx="${idx}"]`);
      if (!card) return;
      const rt = rating(row), eff = efficiency(row), cons = consistency(row);
      const rEl = card.querySelector('.m-rating');
      rEl.textContent = (isActive(row) ? ratingBadge(rt) + ' ' : '') + rt;
      rEl.className = 'm-rating ' + ratingClass(rt);
      const eEl = card.querySelector('.m-eff');
      eEl.textContent = eff + '%'; eEl.className = 'm-eff ' + effClass(eff);
      const cEl = card.querySelector('.m-cons');
      cEl.textContent = cons; cEl.className = 'm-cons ' + consClass(cons);
    });
    this._updateSummary(this.rows);
  }

  _updateSummary(rows) {
    let errors = 0, sum = 0, count = 0;
    rows.forEach(r => {
      errors += (+r[4] || 0) + (+r[5] || 0);
      if (isActive(r)) { sum += rating(r); count++; }
    });
    const avg = count ? (sum / count).toFixed(1) : '0.0';
    this.el.statErrors.textContent = errors;
    this.el.statAvg.textContent = avg;
    this.el.errorsCard.classList.toggle('is-hot', errors > 10);
    this.el.statWeak.innerHTML = this._weaknessHTML(rows);
    const n = parseFloat(avg) || 0;
    this.el.statPerf.textContent = n >= 8.5 ? 'Desempenho excelente' : n >= 7 ? 'Desempenho bom' : n >= 5 ? 'Desempenho médio' : n > 0 ? 'Desempenho baixo' : 'Sem dados ainda';
    this.lastSummary = { errors, avg };
  }

  _weaknessHTML(rows) {
    const items = [];
    rows.forEach(r => {
      const role = r[0];
      if (+r[3] > 0) items.push({ role, type: 'taken', value: +r[3] });
      if (+r[4] > 0) items.push({ role, type: 'of', value: +r[4] });
      if (+r[5] > 0) items.push({ role, type: 'def', value: +r[5] });
    });
    if (!items.length) return 'Nenhum erro registrado';
    const max = Math.max(...items.map(i => i.value));
    const order = { taken: 0, def: 1, of: 2 };
    const winners = items.filter(i => i.value === max).sort((a, b) => order[a.type] - order[b.type]);
    const type = winners[0].type;
    const roles = [...new Set(winners.filter(i => i.type === type).map(i => i.role))];
    const label = type === 'taken' ? 'Pontos tomados no' : type === 'def' ? 'Erro defensivo do' : 'Erro ofensivo do';
    return `${label} <b>${roles.join(' e ')}</b>`;
  }

  /* ---------- reset / save ---------- */
  _resetSet() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.el.resetBtn.textContent = 'Confirmar?';
      this._toast('Confirmar reset', 'Clique novamente para reiniciar este set.', 'warn');
      setTimeout(() => { this.resetArmed = false; this.el.resetBtn.textContent = 'Reiniciar set'; }, 3000);
      return;
    }
    this.resetArmed = false;
    this.el.resetBtn.textContent = 'Reiniciar set';
    const setIdx = this.currentSet;
    this.state.sets[setIdx] = DEFAULT_ROWS();
    this.state.subs = this.state.subs.filter(s => !(s.sets || []).includes(setIdx + 1));
    this.state.subSegments = this.state.subSegments.filter(s => s.setIdx !== setIdx);
    this._save();
    this.render();
    this._toast('Set reiniciado', `Set ${setIdx + 1} voltou a zero.`, 'ok');
  }

  _hasSetInfo(idx) {
    return this.state.sets[idx].some(isActive) || this.state.subSegments.some(s => s.setIdx === idx && s.stats.some(n => n > 0));
  }

  _missingPlayerNames() {
    const miss = [];
    this.state.sets.forEach((set, si) => set.forEach(r => { if (isActive(r) && /^player\d+$/i.test(r[1] || '')) miss.push(`Set ${si + 1} / ${r[0]}`); }));
    this.state.subSegments.forEach(s => { if (/^player\d+$/i.test(s.name)) miss.push(`Set ${s.setIdx + 1} / ${s.role}`); });
    return [...new Set(miss)];
  }

  _validationMessages() {
    const msgs = [];
    const validTeam = (v, n) => { const t = clean(v); return t && !new RegExp(`^time\\s*${n}$`, 'i').test(t); };
    if (!validTeam(this.el.t1.value, 1)) msgs.push('Informe o nome do Time 1.');
    if (!validTeam(this.el.t2.value, 2)) msgs.push('Informe o nome do Time 2.');
    const sc = this.state.manualScores;
    if ((+sc[0] || 0) + (+sc[1] || 0) <= 0) msgs.push('Informe o placar de sets (Time 1 x Time 2).');
    const missing = [0, 1, 2].filter(i => !this._hasSetInfo(i)).map(i => i + 1);
    if (missing.length) msgs.push(`Preencha informações no set ${missing.join(', ')}.`);
    const missNames = this._missingPlayerNames();
    if (missNames.length) msgs.push(`Preencha o nome do jogador em: ${missNames.slice(0, 5).join(', ')}${missNames.length > 5 ? '…' : ''}.`);
    return msgs;
  }

  _combined() {
    const groups = new Map();
    const key = (role, name) => role + '||' + String(name || '').toLowerCase();
    this.state.sets.forEach((set, setIdx) => {
      set.forEach((row, slotIdx) => {
        const role = row[0], name = (row[1] || '').trim() || DEFAULT_ROWS()[slotIdx][1];
        const k = key(role, name);
        if (!groups.has(k)) { const fresh = [role, name, 0, 0, 0, 0, 0, 0]; fresh._sets = [null, null, null]; groups.set(k, fresh); }
        const g = groups.get(k);
        g[1] = name;
        const snap = [role, name, 0, 0, 0, 0, 0, 0];
        for (let c = 2; c <= 7; c++) { const v = +(row[c] || 0); g[c] += v; snap[c] = v; }
        g._sets[setIdx] = snap;
      });
    });
    this.state.subSegments.forEach(seg => {
      const k = key(seg.role, seg.name);
      if (!groups.has(k)) { const fresh = [seg.role, seg.name, 0, 0, 0, 0, 0, 0]; fresh._sets = [null, null, null]; groups.set(k, fresh); }
      const g = groups.get(k);
      for (let i = 0; i < 6; i++) g[i + 2] += (+seg.stats[i] || 0);
      const snap = g._sets[seg.setIdx] || [seg.role, seg.name, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) snap[i + 2] += (+seg.stats[i] || 0);
      g._sets[seg.setIdx] = snap;
    });
    return [...groups.values()];
  }

  _saveMatchToHistory() {
    const msgs = this._validationMessages();
    if (msgs.length) { this._toast('Não foi possível salvar', msgs, 'err', 6500); return; }
    const players = this._combined().filter(isActive).sort((a, b) => mvpScore(b) - mvpScore(a));
    const totalErrors = players.reduce((s, r) => s + (+r[4] || 0) + (+r[5] || 0), 0);
    const active = players.filter(isActive);
    const avg = active.length ? (active.reduce((s, r) => s + rating(r), 0) / active.length).toFixed(1) : '0.0';
    const mvp = players[0] || null;
    const match = {
      id: String(Date.now()) + '_' + uid(),
      createdAt: Date.now(),
      t1: clean(this.el.t1.value), t2: clean(this.el.t2.value),
      score: [...this.state.manualScores],
      avg, totalErrors,
      mvp: mvp ? { role: mvp[0], name: mvp[1], rating: rating(mvp) } : null,
      subs: this.state.subs,
      players: players.map(r => ({
        role: r[0], name: r[1],
        stats: [+r[2] || 0, +r[3] || 0, +r[4] || 0, +r[5] || 0, +r[6] || 0, +r[7] || 0],
        rating: rating(r),
        sets: (r._sets || [null, null, null]).map(x => x ? [x[0], x[1], +x[2] || 0, +x[3] || 0, +x[4] || 0, +x[5] || 0, +x[6] || 0, +x[7] || 0] : null),
      })),
    };
    const hist = this._history();
    hist.unshift(match);
    this._setHistory(hist.slice(0, 80));
    this._toast('Partida salva', 'A partida foi salva no histórico deste navegador.', 'ok');
    if (this.currentView === 'history') this._renderHistory();
  }

  /* ---------- final view ---------- */
  _renderFinal() {
    const all = this._combined();
    const active = all.filter(isActive).sort((a, b) => mvpScore(b) - mvpScore(a));
    const inactive = all.filter(r => !isActive(r));
    const rows = [...active, ...inactive];
    this._updateSummary(rows);

    const mvp = active[0] || null;
    const worst = active.length > 1 ? active[active.length - 1] : null;
    const subNames = new Set(this.state.subs.flatMap(s => [s.from?.toLowerCase(), s.to?.toLowerCase()]).filter(Boolean));

    const head = `<div class="frow head">
      <span>Jogador</span>
      <span>${ICONS.score}P. Feitos<small>Ataques convertidos</small></span>
      <span>${ICONS.taken}P. Tomados<small>Pontos sofridos</small></span>
      <span>${ICONS.off}E. Ofensivo<small>Erro de ataque</small></span>
      <span>${ICONS.def}E. Defensivo<small>Falha defensiva</small></span>
      <span>${ICONS.assist}Assists<small>Assistências</small></span>
      <span>${ICONS.rate}Rating<small>Média</small></span>
      <span></span>
    </div>`;

    const body = rows.map(r => {
      const rt = rating(r);
      const isMvp = mvp && r[1] === mvp[1] && r[0] === mvp[0];
      const isWorst = worst && !isMvp && r[1] === worst[1] && r[0] === worst[0];
      const key = r[0] + '||' + r[1];
      const open = this.openFinalKey === key ? 'open' : '';
      const css = roleCss(r[0]);
      const tags = [
        isMvp ? '<span class="tag tag--mvp">MVP</span>' : '',
        isWorst ? '<span class="tag tag--worst">WORST</span>' : '',
        subNames.has((r[1] || '').toLowerCase()) ? '<span class="tag tag--sub">SUB</span>' : '',
      ].join('');

      const setCards = (r._sets || []).map((snap, i) => {
        const row = snap || [r[0], r[1], 0, 0, 0, 0, 0, 0];
        if (!isActive(row)) return '';
        return this._setCardHTML(row, i);
      }).filter(Boolean).join('') || '<div class="empty-note">Sem detalhes por set para este jogador.</div>';

      return `
      <div class="frow ${isMvp ? 'is-mvp' : ''} ${isWorst ? 'is-worst' : ''}" style="--rc:var(--r-${css})">
        <b class="frow-player" data-key="${esc(key)}" role="button" tabindex="0">
          <span class="frow-role">${esc(r[0])}</span><span class="frow-sep">|</span>
          <span class="frow-name">${esc(r[1])}</span>${tags}
        </b>
        <span>${r[2]}</span><span>${r[3]}</span><span>${r[4]}</span><span>${r[5]}</span><span>${r[6] || 0}</span>
        <span class="frow-rating ${ratingClass(rt)}">${isActive(r) ? ratingBadge(rt) + ' ' : ''}${rt}</span>
        <button class="expand ${open}" data-key="${esc(key)}" type="button">⌄</button>
      </div>
      <div class="setbox ${open}">${setCards}</div>`;
    }).join('');

    this.el.finalTable.innerHTML = head + body;

    // substitutions summary
    document.querySelectorAll('.sub-summary[data-owner="final"]').forEach(n => n.remove());
    const subHtml = this._subSummaryHTML(this.state.subs, 'final');
    if (subHtml) this.el.finalTable.insertAdjacentHTML('beforebegin', subHtml);

    this.el.finalTable.querySelectorAll('[data-key]').forEach(node => {
      node.addEventListener('click', () => {
        const k = node.dataset.key;
        this.openFinalKey = this.openFinalKey === k ? null : k;
        this._renderFinal();
      });
    });
  }

  _setCardHTML(row, setIndex) {
    const role = row[0], rt = rating(row);
    let stats = [];
    const stat = (kind, label, val) => `<span class="mini-stat">${ICONS[kind] || ''}<b>${val}</b><small>${label}</small></span>`;
    if (role === 'Setter') stats = [stat('assist', 'Assists', row[6] || 0), stat('block', 'Blocks', row[7] || 0), stat('score', 'P. Feitos', row[2] || 0), stat('off', 'E. OF', row[4] || 0), stat('def', 'E. DEF', row[5] || 0)];
    else if (role === 'Ds Tsk') stats = [stat('assist', 'Assists', row[6] || 0), stat('score', 'P. Feitos', row[2] || 0), stat('taken', 'P. Tomados', row[3] || 0), stat('off', 'E. OF', row[4] || 0), stat('def', 'E. DEF', row[5] || 0)];
    else stats = [stat('score', 'P. Feitos', row[2] || 0), stat('taken', 'P. Tomados', row[3] || 0), stat('off', 'E. OF', row[4] || 0), stat('def', 'E. DEF', row[5] || 0)];
    stats.push(stat('rate', 'Rating', rt));
    return `<article class="setcard"><div class="setcard-title">SET ${setIndex + 1}</div><div class="setcard-stats">${stats.join('')}</div></article>`;
  }

  _subSummaryHTML(subs, owner) {
    if (!subs || !subs.length) return '';
    const chips = subs.map(s => {
      const css = roleCss(s.role);
      return `<article class="sub-chip" style="--sc:var(--r-${css})"><i>↔</i><b>SET ${esc(s.fromSet)} · ${esc(s.role)}</b><strong>${esc(s.from)} <em>→</em> ${esc(s.to)}</strong><small>aplicado em: ${(s.sets || []).map(n => 'S' + n).join(', ')}</small></article>`;
    }).join('');
    return `<div class="sub-summary" data-owner="${owner}">
      <div class="sub-summary-head"><b>Substituições da partida</b><button class="sub-toggle" type="button">Ver</button></div>
      <div class="sub-list">${chips}</div>
    </div>`;
  }

  /* ---------- substitutions ---------- */
  _subForSlot(slotIdx, setIdx) {
    const list = this.state.subs.filter(s => s.slotIdx === slotIdx && (s.sets || []).includes(setIdx + 1));
    return list[list.length - 1] || null;
  }

  _bindSubModal() {
    document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
      const p = btn.dataset.preset, start = this.currentSet;
      const sets = p === 'all' ? [0, 1, 2] : p === 'current' ? [start] : [0, 1, 2].filter(i => i >= start);
      this.el.subChecks.forEach(ch => ch.checked = sets.includes(+ch.value - 1));
      this._updateSubHint();
    }));
    this.el.subChecks.forEach(ch => ch.addEventListener('change', () => this._updateSubHint()));
    this.el.subClose.addEventListener('click', () => this._closeSubModal());
    this.el.subCancel.addEventListener('click', () => this._closeSubModal());
    this.el.subModal.addEventListener('click', e => { if (e.target === this.el.subModal) this._closeSubModal(); });
    this.el.subApply.addEventListener('click', () => this._applySub());
    this.el.subIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this._applySub(); } });
  }

  _openSubModal(slotIdx) {
    const row = this.rows[slotIdx];
    if (!row) return;
    this.subTarget = { slotIdx, role: row[0], from: clean(row[1]) };
    this.el.subRole.textContent = row[0];
    this.el.subOut.textContent = clean(row[1]) || '—';
    this.el.subIn.value = '';
    const sets = this.currentSet === 2 ? [2] : [0, 1, 2].filter(i => i >= this.currentSet);
    this.el.subChecks.forEach(ch => ch.checked = sets.includes(+ch.value - 1));
    this._updateSubHint();
    this.el.subModal.classList.add('open');
    setTimeout(() => this.el.subIn.focus(), 60);
  }

  _closeSubModal() { this.el.subModal.classList.remove('open'); this.subTarget = null; }

  _updateSubHint() {
    const checked = this.el.subChecks.filter(c => c.checked).map(c => 'Set ' + c.value);
    this.el.subHint.textContent = checked.length ? `Aplicado em: ${checked.join(', ')}.` : 'Marque pelo menos um set para aplicar a substituição.';
  }

  _applySub() {
    const target = this.subTarget;
    if (!target) return;
    const newName = clean(this.el.subIn.value);
    if (newName.length < 2) { this._toast('Nome inválido', 'Digite o nome de quem vai entrar.', 'err'); return; }
    if (newName.toLowerCase() === target.from.toLowerCase()) { this._toast('Sem alteração', 'O novo jogador precisa ter um nome diferente.', 'warn'); return; }
    const setIdxs = this.el.subChecks.filter(c => c.checked).map(c => +c.value - 1);
    if (!setIdxs.length) { this._toast('Nenhum set selecionado', 'Marque ao menos um set.', 'err'); return; }

    const currentRow = this.state.sets[this.currentSet][target.slotIdx];
    if (currentRow && setIdxs.includes(this.currentSet) && isActive(currentRow)) {
      const stats = [+currentRow[2] || 0, +currentRow[3] || 0, +currentRow[4] || 0, +currentRow[5] || 0, +currentRow[6] || 0, +currentRow[7] || 0];
      this.state.subSegments.push({ id: uid(), slotIdx: target.slotIdx, role: target.role, name: target.from, setIdx: this.currentSet, stats, at: Date.now() });
      for (let c = 2; c <= 7; c++) currentRow[c] = 0;
    }
    setIdxs.forEach(i => { this.state.sets[i][target.slotIdx][1] = newName; });

    this.state.subs.push({ id: uid(), slotIdx: target.slotIdx, role: target.role, from: target.from, to: newName, fromSet: this.currentSet + 1, sets: setIdxs.map(i => i + 1), at: Date.now() });
    this.setLive();
    this._save();
    this._closeSubModal();
    this._toast('Substituição aplicada', `${target.from} → ${newName}`, 'ok');
    this.render();
  }

  /* ---------- history ---------- */
  _history() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
  _setHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list || [])); }

  _bindHistory() {
    this.el.histClear.addEventListener('click', () => this._clearHistory());
  }

  _clearHistory() {
    const hist = this._history();
    if (!hist.length) { this._toast('Histórico vazio', 'Não há partidas salvas.', 'warn'); return; }
    if (!this.clearHistoryArmed) {
      this.clearHistoryArmed = true;
      this.el.histClear.textContent = 'Confirmar limpeza?';
      this._toast('Confirmar', 'Clique novamente para apagar todo o histórico.', 'warn');
      setTimeout(() => { this.clearHistoryArmed = false; this.el.histClear.textContent = 'Limpar histórico'; }, 3000);
      return;
    }
    this.clearHistoryArmed = false;
    this.el.histClear.textContent = 'Limpar histórico';
    this._setHistory([]);
    this._toast('Histórico limpo', 'Todas as partidas foram apagadas.', 'warn');
    this._renderHistory();
  }

  _deleteMatch(id) {
    this._setHistory(this._history().filter(m => m.id !== id));
    this._toast('Partida apagada', 'Removida do histórico.', 'warn');
    this._renderHistory();
  }

  _renderHistory() {
    const hist = this._history();
    if (!hist.length) { this.el.histList.innerHTML = '<div class="hist-empty">Nenhuma partida salva ainda.</div>'; return; }

    this.el.histList.innerHTML = hist.map(m => {
      const open = this.openHistoryId === m.id ? 'open' : '';
      const players = m.players || [];
      const rowsHtml = players.map(p => {
        const css = roleCss(p.role);
        const st = p.stats || [0, 0, 0, 0, 0, 0];
        const key = `${m.id}||${p.role}||${p.name}`;
        const rOpen = this.openHistoryPlayer === key ? 'open' : '';
        const setCards = (p.sets || []).map((row, i) => row && isActive(row) ? this._setCardHTML(row, i) : '').filter(Boolean).join('') || '<div class="empty-note">Sem detalhes por set.</div>';
        return `
        <div class="frow" style="--rc:var(--r-${css})">
          <b class="frow-player" data-hkey="${esc(key)}" role="button" tabindex="0">
            <span class="frow-role">${esc(p.role)}</span><span class="frow-sep">|</span><span class="frow-name">${esc(p.name)}</span>
          </b>
          <span>${st[0]}</span><span>${st[1]}</span><span>${st[2]}</span><span>${st[3]}</span><span>${st[4]}</span>
          <span class="frow-rating ${ratingClass(p.rating)}">${p.rating}</span>
          <button class="expand ${rOpen}" data-hkey="${esc(key)}" type="button">⌄</button>
        </div>
        <div class="setbox ${rOpen}">${setCards}</div>`;
      }).join('');

      const head = `<div class="frow head">
        <span>Jogador</span><span>${ICONS.score}P. Feitos</span><span>${ICONS.taken}P. Tomados</span>
        <span>${ICONS.off}E. OF</span><span>${ICONS.def}E. DEF</span><span>${ICONS.assist}Assists</span><span>${ICONS.rate}Rating</span><span></span>
      </div>`;

      const subHtml = this._subSummaryHTML(m.subs, m.id);

      return `<article class="hmatch">
        <div class="hmatch-top">
          <div>
            <div class="hmatch-title">
              <span class="hteam">${esc(m.t1)}</span><span class="hscore">${m.score?.[0] ?? 0} × ${m.score?.[1] ?? 0}</span><span class="hteam">${esc(m.t2)}</span>
            </div>
            <div class="hdate">${fmtDate(m.createdAt)}</div>
            <div class="hmeta">
              <span class="hpill hpill--rating"><small>Rating médio</small><b>${m.avg}</b></span>
              ${m.mvp ? `<span class="hpill hpill--mvp"><small>MVP</small><b>${esc(m.mvp.name)} · ${m.mvp.rating}</b></span>` : ''}
              <span class="hpill hpill--errors"><small>Erros</small><b>${m.totalErrors}</b></span>
              ${m.subs?.length ? `<span class="hpill hpill--sub"><small>Subs</small><b>${m.subs.length}</b></span>` : ''}
            </div>
          </div>
          <div class="hmatch-actions">
            <button class="btn btn--ghost" data-detail="${m.id}" type="button">${open ? 'Fechar' : 'Abrir'}</button>
            <button class="btn btn--danger-ghost" data-del="${m.id}" type="button">Apagar</button>
          </div>
        </div>
        <div class="hmatch-detail ${open}">${subHtml}<div class="table-wrap" style="margin:${subHtml ? '0' : '14px'} 16px 16px;border-radius:12px">${head}${rowsHtml}</div></div>
      </article>`;
    }).join('');

    this.el.histList.querySelectorAll('[data-detail]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.detail;
      this.openHistoryId = this.openHistoryId === id ? null : id;
      if (this.openHistoryId !== id) this.openHistoryPlayer = null;
      this._renderHistory();
    }));
    this.el.histList.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1'; btn.textContent = 'Confirmar?';
        setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = '0'; btn.textContent = 'Apagar'; } }, 2500);
        return;
      }
      this._deleteMatch(btn.dataset.del);
    }));
    this.el.histList.querySelectorAll('[data-hkey]').forEach(node => node.addEventListener('click', () => {
      const k = node.dataset.hkey;
      this.openHistoryPlayer = this.openHistoryPlayer === k ? null : k;
      this._renderHistory();
    }));
    this._bindSubToggles(this.el.histList);
  }

  _bindSubToggles(root) {
    (root || document).querySelectorAll('.sub-summary').forEach(box => {
      const btn = box.querySelector('.sub-toggle');
      const list = box.querySelector('.sub-list');
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const open = list.classList.toggle('open');
        btn.textContent = open ? 'Esconder' : 'Ver';
      });
    });
  }

  /* ---------- feedback ---------- */
  _bindFeedback() {
    this.el.fbOpen.addEventListener('click', () => this._openFeedback());
    this.el.fbClose.addEventListener('click', () => this._closeFeedback());
    this.el.fbModal.addEventListener('click', e => { if (e.target === this.el.fbModal) this._closeFeedback(); });
    this.el.fbText.addEventListener('input', () => { this.el.fbCount.textContent = this.el.fbText.value.length; });
    this.el.fbSend.addEventListener('click', () => this._sendFeedback());
  }

  _openFeedback() {
    this.el.fbModal.classList.add('open');
    this.el.fbStatus.textContent = 'Nada será enviado sem clicar em enviar.';
    this.el.fbStatus.className = 'feedback-note';
    setTimeout(() => this.el.fbName.focus(), 60);
  }
  _closeFeedback() { this.el.fbModal.classList.remove('open'); }

  async _sendFeedback() {
    const text = clean(this.el.fbText.value);
    const name = clean(this.el.fbName.value) || 'Anônimo';
    const type = this.el.fbType.value, priority = this.el.fbPriority.value;
    const contact = clean(this.el.fbContact.value) || 'Não informado';
    if (text.length < 8) { this.el.fbStatus.textContent = 'Escreva uma mensagem um pouco mais detalhada.'; this.el.fbStatus.className = 'feedback-note err'; return; }
    this.el.fbSend.disabled = true;
    this.el.fbStatus.textContent = 'Enviando…'; this.el.fbStatus.className = 'feedback-note';
    try {
      const color = type === 'Bug' ? 15158332 : type === 'Balanceamento' ? 16753920 : type === 'Interface' ? 5814783 : 3066993;
      const payload = {
        username: 'VBL Stats — Feedback',
        content: `**Novo feedback** • ${type} • ${priority}`,
        embeds: [{
          title: 'VBL Stats', description: text.slice(0, 3800), color,
          fields: [
            { name: 'Nome/Nick', value: name.slice(0, 100), inline: true },
            { name: 'Tipo', value: type, inline: true },
            { name: 'Prioridade', value: priority, inline: true },
            { name: 'Contato', value: contact.slice(0, 120), inline: false },
            { name: 'Versão', value: CURRENT_LOG, inline: true },
            { name: 'Página', value: location.href.slice(0, 900), inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      };
      const res = await fetch(FEEDBACK_HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.el.fbStatus.textContent = 'Feedback enviado. Obrigado!'; this.el.fbStatus.className = 'feedback-note ok';
      this.el.fbText.value = ''; this.el.fbContact.value = ''; this.el.fbCount.textContent = '0';
      setTimeout(() => this._closeFeedback(), 1000);
    } catch {
      this.el.fbStatus.textContent = 'Não consegui enviar. Tente novamente mais tarde.'; this.el.fbStatus.className = 'feedback-note err';
    } finally {
      this.el.fbSend.disabled = false;
    }
  }

  /* ---------- changelog ---------- */
  _bindChangelog() {
    this.el.logOpen.addEventListener('click', () => this._openLog());
    this.el.logClose.addEventListener('click', () => this._closeLog());
    this.el.logModal.addEventListener('click', e => { if (e.target === this.el.logModal) this._closeLog(); });
    this.el.logTabs.addEventListener('click', e => { const b = e.target.closest('.log-tab'); if (b) this._selectLog(b.dataset.log); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { this._closeLog(); this._closeFeedback(); this._closeSubModal(); } });
    this._renderLog();
  }

  _sections() {
    return {
      '2.0': { date: '20/09/2026', versions: [
        { title: 'Redesign completo', items: [
          ['Nova identidade visual', 'Layout com navegação lateral, paleta própria e tipografia dedicada, no lugar do visual genérico anterior.'],
          ['Abas removidas', 'As abas Treinos e Times foram removidas para focar o painel na partida.'],
          ['Fundo animado', 'Fundo com gradientes em movimento lento, sutil e sem impacto na performance.'],
          ['Performance', 'Código reorganizado em HTML, CSS e JS separados — menos travamentos e carregamento mais rápido.'],
        ]},
      ]},
      '1.2.5': { date: '01/05/2026', versions: [
        { title: 'Funcionalidades', items: [['Ajustes de UI', 'Refinamentos visuais e correções de performance da versão anterior.']] },
      ]},
      '1.2': { date: '29/04/2026', versions: [
        { title: 'Funcionalidades', items: [
          ['Histórico de partidas', 'Salve partidas completas e consulte placar, MVP, erros e ratings quando quiser.'],
          ['Feedback', 'Envio de sugestões, melhorias e bugs direto pelo sistema.'],
          ['Substituições', 'Troca de jogadores entre sets preservando as estatísticas antigas.'],
        ]},
      ]},
    };
  }

  _renderLog() {
    const sections = this._sections();
    this.el.logContent.innerHTML = Object.entries(sections).map(([ver, data]) => `
      <div class="log-version ${ver === CURRENT_LOG ? 'is-active' : ''}" data-version="${ver}">
        ${data.versions.map(v => `
          <section class="log-section">
            <h3>${esc(v.title)} <span class="log-date">${esc(data.date)}</span></h3>
            <ul>${v.items.map(([t, d]) => `<li><b>${esc(t)}</b><small>${esc(d)}</small></li>`).join('')}</ul>
          </section>`).join('')}
      </div>`).join('');
  }

  _openLog() {
    this._selectLog(CURRENT_LOG);
    this.el.logModal.classList.add('open');
    localStorage.setItem(LOG_SEEN_KEY, CURRENT_LOG);
  }
  _closeLog() { this.el.logModal.classList.remove('open'); localStorage.setItem(LOG_SEEN_KEY, CURRENT_LOG); }
  _selectLog(v) {
    this.el.logTabs.querySelectorAll('.log-tab').forEach(b => b.classList.toggle('is-active', b.dataset.log === v));
    this.el.logContent.querySelectorAll('.log-version').forEach(a => a.classList.toggle('is-active', a.dataset.version === v));
  }
  _maybeShowChangelog() {
    if (localStorage.getItem(LOG_SEEN_KEY) !== CURRENT_LOG) this._openLog();
  }

  /* ---------- toasts ---------- */
  _toast(title, msg, type = 'ok', time = 4000) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const ico = type === 'ok' ? '✓' : type === 'err' ? '!' : '•';
    const body = Array.isArray(msg) ? `<ul>${msg.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : esc(msg);
    el.innerHTML = `<div class="toast-ico">${ico}</div><div><div class="toast-title">${esc(title)}</div><div class="toast-msg">${body}</div></div><button class="toast-close" type="button">×</button>`;
    this.el.toastZone.appendChild(el);
    const close = () => { el.style.opacity = '0'; el.style.transform = 'translateX(14px)'; setTimeout(() => el.remove(), 180); };
    el.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, time);
  }
}

document.addEventListener('DOMContentLoaded', () => { window.vblApp = new VBLApp(); });
