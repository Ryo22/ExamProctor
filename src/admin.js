import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';

// 接続情報はlocalStorageで管理（ソースにハードコードしない）
let sb = null;
let state = { topics: [], roster: {}, studentStates: {}, memos: {}, lastIds: {} };

function setStatus(msg, color) {
  const el = document.getElementById('cloud-sync-status');
  el.textContent = msg; el.style.color = color;
}

async function initCloud() {
  const url = localStorage.getItem('sb_url') || '';
  const key = localStorage.getItem('sb_key') || '';
  document.getElementById('sb-url').value = url;
  document.getElementById('sb-key-disp').value = key ? key.slice(0, 24) + '…' + key.slice(-8) : '';
  await pullFromCloud();
}

async function pullFromCloud() {
  if (!sb) return;
  try {
    const [sessRes, studRes, statRes] = await Promise.all([
      sb.from('sessions').select('*'),
      sb.from('students').select('*').is('deleted_at', null),
      sb.from('exam_status').select('*').is('deleted_at', null)
    ]);
    if (sessRes.error) throw sessRes.error;
    if (studRes.error) throw studRes.error;
    if (statRes.error) throw statRes.error;

    state.topics = (sessRes.data || []).map(s => s.topic_id);
    state.lastIds = {};
    (sessRes.data || []).forEach(s => { state.lastIds[s.topic_id] = s.last_ntfy_id || ''; });

    state.roster = {}; state.memos = {};
    (studRes.data || []).forEach(s => {
      state.roster[s.sid] = { name: s.name, group: s.class_group, topic: s.topic_id || '' };
    });

    const statusSeverity = { 'OFFLINE': 0, 'LOGIN': 1, 'SAFE': 2, 'ALERT': 3, 'FINISHED': 4 };
    if (Date.now() - lastPollUpdate > 8000) state.studentStates = {};
    (statRes.data || []).forEach(s => {
      const key = `${s.topic_id}:${s.sid}`;
      const local = state.studentStates[key];
      const dbSev = statusSeverity[s.status] ?? 0;
      const localSev = local ? (statusSeverity[local.status] ?? 0) : -1;
      if (dbSev >= localSev)
        state.studentStates[key] = { topic: s.topic_id, sid: s.sid, status: s.status, count: s.alert_count };
      // メモはレコード (topic_id:sid) ごとに保持
      state.memos[key] = s.memo || '';
    });

    renderAll();
    setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
  } catch(e) {
    setStatus('✗ 読込失敗: ' + (e.message || e), 'var(--red)');
    console.error('pullFromCloud error:', e);
  }
}

async function handleLogin() {
  const url   = document.getElementById('cfg-url').value.trim();
  const key   = document.getElementById('cfg-key').value.trim();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');
  errEl.textContent = '';

  if (!url || !key) {
    errEl.textContent = '接続設定を入力してください';
    document.getElementById('conn-details').open = true; return;
  }
  if (!email || !pass) { errEl.textContent = 'メールアドレスとパスワードを入力してください'; return; }

  btn.textContent = 'ログイン中...'; btn.disabled = true;
  try {
    sb = createClient(url, key);
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) { errEl.textContent = 'ログイン失敗: ' + error.message; return; }
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    showAdminApp(data.user);
  } finally {
    btn.textContent = 'ログイン'; btn.disabled = false;
  }
}

async function showAdminApp(user) {
  // ログインユーザー表示
  if (user?.email) {
    const el = document.getElementById('sb-user-disp');
    if (el) el.value = user.email;
  }
  document.getElementById('login-screen').style.display = 'none';
  document.querySelector('.app-header').style.display = 'flex';
  document.querySelector('.app-viewport').classList.add('visible');
  await initCloud();
  subscribeAll();
  renderAlertChart(null);
  clearGrid();
  setInterval(pullFromCloud, 30000);
}

async function handleLogout() {
  if (!confirm('ログアウトしますか？')) return;
  await sb?.auth.signOut();
  location.reload();
}

async function changePassword() {
  const newPass    = document.getElementById('new-pass').value;
  const newConfirm = document.getElementById('new-pass-confirm').value;
  const msgEl      = document.getElementById('pw-change-msg');
  msgEl.style.color = 'var(--red)';
  if (!newPass) { msgEl.textContent = 'パスワードを入力してください'; return; }
  if (newPass.length < 8) { msgEl.textContent = '8文字以上で入力してください'; return; }
  if (newPass !== newConfirm) { msgEl.textContent = 'パスワードが一致しません'; return; }
  msgEl.textContent = '変更中...'; msgEl.style.color = 'var(--muted)';
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) {
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = '変更失敗: ' + error.message;
  } else {
    msgEl.style.color = 'var(--green)';
    msgEl.textContent = '✓ パスワードを変更しました';
    document.getElementById('new-pass').value = '';
    document.getElementById('new-pass-confirm').value = '';
  }
}

function openConnSettings() {
  document.getElementById('login-screen').style.display = 'flex';
  document.querySelector('.app-header').style.display = 'none';
  document.querySelector('.app-viewport').classList.remove('visible');
  const url = localStorage.getItem('sb_url') || '';
  const key = localStorage.getItem('sb_key') || '';
  document.getElementById('cfg-url').value = url;
  document.getElementById('cfg-key').value = key;
  document.getElementById('conn-details').open = true;
}

// Enterキーでログイン
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') handleLogin();
});

document.addEventListener('DOMContentLoaded', async () => {
  const url = localStorage.getItem('sb_url') || '';
  const key = localStorage.getItem('sb_key') || '';
  document.getElementById('cfg-url').value = url;
  document.getElementById('cfg-key').value = key;
  if (!url || !key) { document.getElementById('conn-details').open = true; return; }
  // 保存済み接続情報でセッション復元を試みる
  sb = createClient(url, key);
  const { data: { session } } = await sb.auth.getSession();
  if (session) showAdminApp(session.user);
  else document.getElementById('conn-details').open = false; // 接続情報はあるが未ログイン
});

function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === tabId));
}
document.querySelectorAll('.nav-tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));

function renderAll() { renderDashboard(); renderSessionManager(); renderRosterMaster(); renderDataManagement(); }

// --- 試験セッション ---
async function addTopic() {
  const v = document.getElementById('new-topic-input').value.trim();
  if (!v || state.topics.includes(v)) return;
  const { error } = await sb.from('sessions').insert({ topic_id: v, last_ntfy_id: '' });
  if (error) { setStatus('✗ 保存失敗: ' + error.message, 'var(--red)'); return; }
  state.topics.push(v); state.lastIds[v] = '';
  document.getElementById('new-topic-input').value = '';
  renderAll(); setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
}

function renderSessionManager() {
  const list = document.getElementById('session-manager-list');
  list.innerHTML = state.topics.sort().map(t => {
    const u = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) + `client.html?topic=${encodeURIComponent(t)}`;
    return `<div class="card" style="display:flex; justify-content:space-between; align-items:center;">
      <div><b>${t}</b><div style="display:flex; gap:8px; margin-top:5px;"><input type="text" value="${u}" readonly style="font-size:0.65rem; width:250px;" id="u-${t}"/><button class="btn btn-ghost" onclick="const e=document.getElementById('u-${t}');e.select();document.execCommand('copy');alert('コピー完了');">コピー</button></div></div>
      <button class="btn btn-red" onclick="deleteTopic('${t}')">削除</button></div>`;
  }).join('');
  document.getElementById('topic-datalist').innerHTML = state.topics.sort().map(t => `<option value="${t}">`).join('');
}

async function deleteTopic(t) {
  if (!confirm('削除しますか？')) return;
  await sb.from('exam_status').update({ deleted_at: new Date().toISOString() }).eq('topic_id', t).is('deleted_at', null);
  await sb.from('students').update({ topic_id: null }).eq('topic_id', t);
  const { error } = await sb.from('sessions').delete().eq('topic_id', t);
  if (error) { setStatus('✗ 削除失敗: ' + error.message, 'var(--red)'); return; }
  state.topics = state.topics.filter(x => x !== t);
  delete state.lastIds[t];
  Object.keys(state.studentStates).forEach(k => { if (k.startsWith(t + ':')) delete state.studentStates[k]; });
  Object.keys(state.roster).forEach(sid => { if (state.roster[sid].topic === t) state.roster[sid].topic = ''; });
  renderAll(); setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
}

// --- Supabase Realtime ---
let lastPollUpdate = 0;
let realtimeChannel = null;

function subscribeAll() {
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  realtimeChannel = sb.channel('exam-status-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_status' }, (payload) => {
      const r = payload.new;
      if (!r || !r.topic_id || !r.sid) return;
      const key = `${r.topic_id}:${r.sid}`;
      // 論理削除されたレコードはダッシュボードから除外
      if (r.deleted_at) { delete state.studentStates[key]; renderDashboard(); return; }
      state.studentStates[key] = { topic: r.topic_id, sid: r.sid, status: r.status, count: r.alert_count };
      lastPollUpdate = Date.now();
      renderDashboard();
      setStatus('● ' + new Date().toLocaleTimeString() + '  ' + r.status + ' / ' + r.sid, 'var(--green)');
      scheduleChartRefresh();  // リアルタイム更新時にグラフも更新
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setStatus('● リアルタイム接続完了', 'var(--green)');
      else if (status === 'CHANNEL_ERROR') setStatus('✗ リアルタイム接続失敗', 'var(--red)');
    });
}

// --- ダッシュボード ---
let fT = null, fG = null;
// ソート・フィルター状態
let sortCol = 'sid', sortDir = 1;
let filterText = '', filterStatus = null;
let allTableRows = []; // フィルターチップ適用後の全行（テキスト/ステータスフィルター前）

function setSort(col) {
  sortDir = (sortCol === col) ? -sortDir : 1;
  sortCol = col;
  renderStudentTable();
}

function setStatusFilter(status) {
  filterStatus = status;
  document.querySelectorAll('.sts-filter').forEach(b =>
    b.classList.toggle('active', b.dataset.s === (status ?? ''))
  );
  renderStudentTable();
}

function renderDashboard() {
  const rosterIds = Object.keys(state.roster);
  const groups = [...new Set(rosterIds.map(i => state.roster[i].group))].sort((a,b) => a.localeCompare(b, 'ja'));
  document.getElementById('group-filter-container').innerHTML =
    `<div class="filter-chip filter-all ${fG===null?'active':''}" onclick="fG=null;renderDashboard()">全体表示</div>` +
    groups.map(g => `<div class="filter-chip ${fG===g?'active':''}" onclick="fG='${g}';renderDashboard()">${g}</div>`).join('');
  const sortedTopics = [...state.topics].sort((a,b) => a.localeCompare(b, 'ja'));
  document.getElementById('topic-filter-container').innerHTML =
    `<div class="filter-chip filter-all ${fT===null?'active':''}" onclick="fT=null;renderDashboard()">全体表示</div>` +
    sortedTopics.map(t => `<div class="filter-chip ${fT===t?'active':''}" onclick="fT='${t}';renderDashboard()">${t}</div>`).join('');

  // フィルターチップ適用後の全行を構築（stat boxはこれを使う）
  const allKeys = new Set(Object.keys(state.studentStates));
  state.topics.forEach(t => rosterIds.forEach(id => { if (state.roster[id].topic === t) allKeys.add(`${t}:${id}`); }));
  allTableRows = []; let uk = 0;
  allKeys.forEach(key => {
    const [t, sid] = key.split(':'), r = state.roster[sid];
    const s = state.studentStates[key] || { status:'OFFLINE', count:0 };
    if (fT!==null && t!==fT) return;
    if (fG!==null && (!r || r.group!==fG)) return;
    if (!r && s.status!=='OFFLINE') uk++;
    allTableRows.push({ t, sid, name: r?r.name:'⚠️ 名簿未登録', group: r?r.group:'---', status: s.status, count: s.count, isUk: !r });
  });

  // Stat boxes はテキスト/ステータスフィルター前の全体数を表示
  document.getElementById('stat-unknown').textContent = uk;
  document.getElementById('stat-total').textContent = allTableRows.length;
  document.getElementById('stat-login').textContent = allTableRows.filter(r=>r.status==='LOGIN').length;
  document.getElementById('stat-alert').textContent = allTableRows.filter(r=>r.status==='ALERT').length;

  buildChartTabs();
  renderStudentTable();
}

function renderStudentTable() {
  // テキスト・ステータスフィルター適用
  let rows = [...allTableRows];
  if (filterText.trim()) {
    const q = filterText.trim().toLowerCase();
    rows = rows.filter(r =>
      r.sid.toLowerCase().includes(q)   ||
      r.name.toLowerCase().includes(q)  ||
      r.group.toLowerCase().includes(q) ||
      r.t.toLowerCase().includes(q)
    );
  }
  if (filterStatus) rows = rows.filter(r => r.status === filterStatus);

  // ソート
  const statusOrder = { ALERT:5, SAFE:4, LOGIN:3, OFFLINE:2, FINISHED:1 };
  rows.sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'count')  cmp = a.count - b.count;
    else if (sortCol === 'status') cmp = (statusOrder[a.status]||0) - (statusOrder[b.status]||0);
    else cmp = (a[sortCol]||'').localeCompare(b[sortCol]||'', 'ja');
    return cmp * sortDir;
  });

  // ソートアイコン更新
  document.querySelectorAll('.sort-icon').forEach(el => {
    const isActive = el.dataset.col === sortCol;
    el.textContent = isActive ? (sortDir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    el.classList.toggle('active', isActive);
  });

  // 件数ラベル
  const isFiltered = filterText.trim() || filterStatus;
  document.getElementById('table-count-label').textContent =
    isFiltered ? `${rows.length} / ${allTableRows.length} 件` : `${rows.length} 件`;

  // tbody描画
  document.getElementById('student-tbody').innerHTML = rows.map(r => `
    <tr class="${r.status==='ALERT'?'alert-row':''} ${r.isUk?'unknown-row':''}">
      <td><small>${r.group}</small></td>
      <td><b>${r.sid}</b></td>
      <td>${r.name}</td>
      <td>${r.t}</td>
      <td><span class="pill ${r.status}">${r.status}</span></td>
      <td style="text-align:center;">${r.count}</td>
      <td style="display:flex; gap:5px; flex-wrap:wrap;">
        <button class="btn btn-detail" onclick="showDetail('${r.t}','${r.sid}')">詳細を見る</button>
        <button class="btn btn-ghost" onclick="dismissAlert('${r.t}','${r.sid}')">解除</button>
        <button class="btn btn-ghost" style="color:var(--blue); border-color:var(--blue);" onclick="editRoster('${r.sid}')">編集</button>
      </td>
      <td><input type="text" class="memo-input" value="${(state.memos[`${r.t}:${r.sid}`]||'').replace(/"/g,'&quot;')}" onblur="updateMemo('${r.t}','${r.sid}', this.value)" placeholder="メモ..."/></td>
    </tr>`).join('');
}

async function updateMemo(topic, sid, v) {
  const key = `${topic}:${sid}`;
  state.memos[key] = v;
  const { error } = await sb.from('exam_status')
    .update({ memo: v })
    .eq('topic_id', topic)
    .eq('sid', sid);
  if (error) setStatus('✗ メモ保存失敗: ' + error.message, 'var(--red)');
  else setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
}

async function dismissAlert(t, s) {
  if (!state.studentStates[`${t}:${s}`]) return;
  state.studentStates[`${t}:${s}`].status = 'SAFE';
  const { error } = await sb.from('exam_status').update({ status: 'SAFE' }).eq('topic_id', t).eq('sid', s);
  if (error) setStatus('✗ 更新失敗: ' + error.message, 'var(--red)');
  else setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
  renderDashboard();
}

// --- 名簿 ---
async function ensureTopic(topic_id) {
  if (!topic_id) return false;
  if (state.topics.includes(topic_id)) return true;
  const { error } = await sb.from('sessions').insert({ topic_id, last_ntfy_id: '' });
  if (error) { setStatus('✗ 試験名の作成失敗: ' + error.message, 'var(--red)'); return false; }
  state.topics.push(topic_id); state.lastIds[topic_id] = '';
  renderSessionManager();
  return true;
}

function editRoster(sid) {
  const info = state.roster[sid] || { group:'', name:'', topic:'' };
  document.getElementById('roster-topic-select').value = info.topic || '';
  document.getElementById('roster-group').value = info.group || '';
  clearGrid(false);
  addGridRow(sid, info.name);
  addGridRow();
  switchTab('page-roster');
  setTimeout(() => document.getElementById('roster-grid-body').rows[0]?.cells[1]?.focus(), 80);
}

function renderRosterMaster() {
  const entries = Object.entries(state.roster).sort((a,b)=>a[1].group.localeCompare(b[1].group) || a[0].localeCompare(b[0]));
  const ukSids = [...new Set(Object.keys(state.studentStates).map(k=>k.split(':')[1]).filter(sid => !state.roster[sid]))].sort();
  document.getElementById('roster-tbody-master').innerHTML =
    entries.map(([sid, info]) => `<tr><td>${info.topic||'---'}</td><td>${info.group}</td><td><b>${sid}</b></td><td>${info.name}</td><td><button class="btn btn-ghost" style="color:var(--blue); border-color:var(--blue);" onclick="editRoster('${sid}')">編集</button> <button class="btn btn-red" onclick="deleteRoster('${sid}')">削除</button></td></tr>`).join('') +
    ukSids.map(sid => `<tr class="unknown-row"><td>---</td><td>---</td><td><b>${sid}</b></td><td>⚠️ 未登録</td><td><button class="btn btn-blue" onclick="editRoster('${sid}')">登録</button></td></tr>`).join('');
}

async function deleteRoster(sid) {
  if (!confirm('削除しますか？\n（データはゴミ箱に移動します。設定画面から復元できます）')) return;
  const now = new Date().toISOString();
  await sb.from('exam_status').update({ deleted_at: now }).eq('sid', sid).is('deleted_at', null);
  const { error } = await sb.from('students').update({ deleted_at: now }).eq('sid', sid);
  if (error) { setStatus('✗ 削除失敗: ' + error.message, 'var(--red)'); return; }
  delete state.roster[sid]; delete state.memos[sid];
  renderAll(); setStatus('● 同期済み ' + new Date().toLocaleTimeString(), 'var(--green)');
}

function syncNow() { pullFromCloud(); }

// ─────────────────────────────────────────────
// データ一括削除
// ─────────────────────────────────────────────
function renderDataManagement() {
  const topicSel = document.getElementById('del-topic');
  const groupSel = document.getElementById('del-group');
  if (!topicSel || !groupSel) return;
  const curT = topicSel.value, curG = groupSel.value;
  topicSel.innerHTML = '<option value="">全セッション</option>' +
    state.topics.sort().map(t => `<option value="${t}" ${curT===t?'selected':''}>${t}</option>`).join('');
  const groups = [...new Set(Object.values(state.roster).map(r => r.group).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,'ja'));
  groupSel.innerHTML = '<option value="">全クラス</option>' +
    groups.map(g => `<option value="${g}" ${curG===g?'selected':''}>${g}</option>`).join('');
}

function resetDeletePreview() {
  document.getElementById('del-preview').textContent = '';
  document.getElementById('del-execute-btn').style.display = 'none';
}

async function previewDelete() {
  const topic = document.getElementById('del-topic').value || null;
  const group = document.getElementById('del-group').value || null;
  const delStatus  = document.getElementById('del-status').checked;
  const delHistory = document.getElementById('del-history').checked;
  const delRoster  = document.getElementById('del-roster').checked;

  if (!delStatus && !delHistory && !delRoster) {
    document.getElementById('del-preview').innerHTML = '<span style="color:var(--orange);">削除対象を1つ以上チェックしてください</span>';
    return;
  }

  const previewEl = document.getElementById('del-preview');
  previewEl.textContent = '確認中...';
  document.getElementById('del-execute-btn').style.display = 'none';

  // クラスフィルター用SIDリスト
  let sids = null;
  if (group) {
    const { data } = await sb.from('students').select('sid').eq('class_group', group);
    sids = (data || []).map(s => s.sid);
  }

  const parts = [], errors = [];
  let total = 0;

  const countQuery = async (table, extraFilters) => {
    let q = sb.from(table).select('*', { count: 'exact', head: true }).is('deleted_at', null);
    if (topic) q = q.eq('topic_id', topic);
    if (sids !== null) q = sids.length > 0 ? q.in('sid', sids) : q.eq('sid', '__nomatch__');
    if (extraFilters) q = extraFilters(q);
    const { count, error } = await q;
    if (error) { errors.push(table + ': ' + error.message); return 0; }
    return count || 0;
  };

  if (delStatus) {
    const n = await countQuery('exam_status');
    parts.push(`受験ステータス <b>${n}件</b>`); total += n;
  }
  if (delHistory) {
    const n = await countQuery('exam_status_history');
    parts.push(`状態履歴 <b>${n}件</b>`); total += n;
  }
  if (delRoster) {
    const n = await countQuery('students', q => group ? q.eq('class_group', group) : q);
    parts.push(`名簿 <b>${n}件</b>`); total += n;
  }

  if (errors.length > 0) {
    previewEl.innerHTML = `<span style="color:var(--red);">エラー: ${errors.join(' / ')}</span>`;
    return;
  }

  previewEl.innerHTML = parts.join('　／　') +
    `　→　<span style="color:var(--red); font-weight:900;">計 ${total}件</span>`;
  document.getElementById('del-execute-btn').style.display = total > 0 ? 'block' : 'none';
}

async function executeDelete() {
  const topic = document.getElementById('del-topic').value || null;
  const group  = document.getElementById('del-group').value || null;
  const delStatus  = document.getElementById('del-status').checked;
  const delHistory = document.getElementById('del-history').checked;
  const delRoster  = document.getElementById('del-roster').checked;

  const desc = [
    topic ? `セッション: ${topic}` : '全セッション',
    group  ? `クラス: ${group}`    : '全クラス'
  ].join(' ／ ');
  const targets = [delStatus&&'受験ステータス', delHistory&&'状態履歴', delRoster&&'名簿データ'].filter(Boolean).join('・');

  if (!confirm(`【削除確認】\n\n対象: ${desc}\n削除: ${targets}\n\nこの操作は取り消せません。実行しますか？`)) return;

  const btn = document.getElementById('del-execute-btn');
  const previewEl = document.getElementById('del-preview');
  btn.disabled = true; btn.textContent = '削除中...';

  // クラスフィルター用SIDリスト
  let sids = null;
  if (group) {
    const { data } = await sb.from('students').select('sid').eq('class_group', group);
    sids = (data || []).map(s => s.sid);
  }

  // 論理削除: deleted_at を立てるだけ（物理削除しない）
  const now = new Date().toISOString();
  const softDeleteTable = async (table) => {
    let q = sb.from(table).update({ deleted_at: now }).is('deleted_at', null);
    if (topic && sids !== null) {
      if (sids.length === 0) return null;
      q = q.eq('topic_id', topic).in('sid', sids);
    } else if (topic) {
      q = q.eq('topic_id', topic);
    } else if (sids !== null) {
      if (sids.length === 0) return null;
      q = q.in('sid', sids);
    } else {
      q = q.neq('topic_id', ''); // 全件対象 catch-all
    }
    return await q;
  };

  const errors = [];

  if (delStatus) {
    const res = await softDeleteTable('exam_status');
    if (res?.error) errors.push('受験ステータス: ' + res.error.message);
  }
  if (delHistory) {
    const res = await softDeleteTable('exam_status_history');
    if (res?.error) errors.push('状態履歴: ' + res.error.message);
  }
  if (delRoster) {
    let q = sb.from('students').update({ deleted_at: now }).is('deleted_at', null);
    if (topic) q = q.eq('topic_id', topic);
    if (group)  q = q.eq('class_group', group);
    if (!topic && !group) q = q.neq('sid', '');
    const { error } = await q;
    if (error) errors.push('名簿: ' + error.message);
  }

  btn.disabled = false;
  btn.textContent = '⚠️ 上記のデータを削除する（取り消し不可）';

  if (errors.length === 0) {
    previewEl.innerHTML = '<span style="color:var(--green);">✓ 削除が完了しました</span>';
    btn.style.display = 'none';
    setStatus('● 削除完了 ' + new Date().toLocaleTimeString(), 'var(--green)');
    await pullFromCloud();
    renderAlertChart(currentChartGroup);
  } else {
    previewEl.innerHTML = `<span style="color:var(--red);">エラー: ${errors.join(' ／ ')}</span>`;
    setStatus('✗ 削除エラー', 'var(--red)');
  }
}

// ─────────────────────────────────────────────
// 名簿グリッド（スプレッドシートUI）
// ─────────────────────────────────────────────
function addGridRow(sid = '', name = '') {
  const tbody = document.getElementById('roster-grid-body');
  const tr = document.createElement('tr');
  const num = tbody.rows.length + 1;
  tr.innerHTML = `
    <td class="grid-row-num">${num}</td>
    <td contenteditable="true" class="grid-cell" data-col="0" data-ph="学籍番号"></td>
    <td contenteditable="true" class="grid-cell" data-col="1" data-ph="氏名"></td>
    <td style="text-align:center; padding:2px; border:1px solid var(--border);">
      <button class="btn btn-ghost" style="font-size:0.65rem; padding:3px 7px; color:var(--muted);"
        onclick="this.closest('tr').remove(); renumberGrid();">✕</button>
    </td>`;
  // textContent で設定（XSS対策）
  tr.cells[1].textContent = sid;
  tr.cells[2].textContent = name;
  [1, 2].forEach(ci => tr.cells[ci].addEventListener('keydown', gridKeydown));
  tbody.appendChild(tr);
}

function renumberGrid() {
  const rows = document.getElementById('roster-grid-body').rows;
  for (let i = 0; i < rows.length; i++) rows[i].cells[0].textContent = i + 1;
}

function clearGrid(addEmpty = true) {
  document.getElementById('roster-grid-body').innerHTML = '';
  if (addEmpty) for (let i = 0; i < 10; i++) addGridRow();
}

function gridKeydown(e) {
  const td = e.currentTarget;
  const col = parseInt(td.dataset.col);   // 0=sid, 1=name
  const tr  = td.closest('tr');
  const tbody = document.getElementById('roster-grid-body');

  if (e.key === 'Tab') {
    e.preventDefault();
    if (!e.shiftKey) {
      if (col === 0) { tr.cells[2].focus(); }
      else {
        const next = tr.nextElementSibling;
        if (next) next.cells[1].focus();
        else { addGridRow(); tbody.lastElementChild.cells[1].focus(); }
      }
    } else {
      if (col === 1) { tr.cells[1].focus(); }
      else { tr.previousElementSibling?.cells[2].focus(); }
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cellIdx = col + 1;
    const next = tr.nextElementSibling;
    if (next) next.cells[cellIdx].focus();
    else { addGridRow(); tbody.lastElementChild.cells[cellIdx].focus(); }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    tr.nextElementSibling?.cells[col + 1].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tr.previousElementSibling?.cells[col + 1].focus();
  }
}

// Excel / Googleスプレッドシートからのペースト処理
document.addEventListener('paste', (e) => {
  const active = document.activeElement;
  if (!active?.classList.contains('grid-cell')) return;
  e.preventDefault();

  const text = e.clipboardData.getData('text/plain');
  const pastedRows = text.split(/\r?\n/).filter(r => r.trim());
  if (pastedRows.length === 0) return;

  const tbody = document.getElementById('roster-grid-body');
  const startCol = parseInt(active.dataset.col);
  let currentTr = active.closest('tr');

  pastedRows.forEach((rowText, ri) => {
    if (!currentTr) { addGridRow(); currentTr = tbody.lastElementChild; }
    const cols = rowText.split('\t');
    cols.forEach((cellText, ci) => {
      const targetCol = startCol + ci;
      if (targetCol <= 1) currentTr.cells[targetCol + 1].textContent = cellText.trim();
    });
    const next = currentTr.nextElementSibling;
    if (!next && ri < pastedRows.length - 1) addGridRow();
    currentTr = currentTr.nextElementSibling;
  });
});

function loadRosterIntoGrid() {
  const topic = document.getElementById('roster-topic-select').value.trim();
  const group  = document.getElementById('roster-group').value.trim();
  clearGrid(false);
  const students = Object.entries(state.roster)
    .filter(([, info]) => (!topic || info.topic === topic) && (!group || info.group === group))
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (students.length === 0) {
    for (let i = 0; i < 8; i++) addGridRow();
  } else {
    students.forEach(([sid, info]) => addGridRow(sid, info.name));
    addGridRow(); // 末尾に空行
  }
  setTimeout(() => document.getElementById('roster-grid-body').rows[0]?.cells[1]?.focus(), 50);
}

async function saveRosterGrid() {
  const topic_id    = document.getElementById('roster-topic-select').value.trim();
  const class_group = document.getElementById('roster-group').value.trim() || '---';
  if (!topic_id) { setStatus('⚠️ 試験名を入力してください', 'var(--orange)'); return; }
  if (!await ensureTopic(topic_id)) return;

  const rows = document.getElementById('roster-grid-body').rows;
  const records = [];
  for (const row of rows) {
    const sid  = row.cells[1].textContent.trim();
    const name = row.cells[2].textContent.trim();
    if (sid && name) {
      records.push({ sid, name, class_group, topic_id, memo: state.memos[sid] || '' });
      state.roster[sid] = { name, group: class_group, topic: topic_id };
    }
  }
  if (records.length === 0) { setStatus('⚠️ 保存するデータがありません', 'var(--orange)'); return; }

  const { error } = await sb.from('students').upsert(records);
  if (error) { setStatus('✗ 保存失敗: ' + error.message, 'var(--red)'); return; }
  setStatus(`● ${records.length}件保存完了 ${new Date().toLocaleTimeString()}`, 'var(--green)');
  renderAll();
}

// ─────────────────────────────────────────────
// ゴミ箱（論理削除済みデータの管理）
// ─────────────────────────────────────────────
async function loadTrash() {
  const el = document.getElementById('trash-content');
  el.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">読み込み中...</p>';

  const [statRes, histRes, studRes] = await Promise.all([
    sb.from('exam_status').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    sb.from('exam_status_history').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    sb.from('students').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  ]);

  const totalCount = (statRes.data?.length||0) + (histRes.data?.length||0) + (studRes.data?.length||0);
  document.getElementById('empty-trash-btn').style.display = totalCount > 0 ? 'inline-block' : 'none';

  if (totalCount === 0) {
    el.innerHTML = '<p style="color:var(--green); font-size:0.85rem;">✓ ゴミ箱は空です。</p>';
    return;
  }

  const fmtDate = iso => iso ? new Date(iso).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '---';

  let html = '';

  // 受験ステータス
  if (statRes.data?.length > 0) {
    html += `<p style="font-size:0.75rem; color:var(--muted); font-weight:bold; margin-bottom:0.5rem;">受験ステータス（${statRes.data.length}件）</p>
    <div style="overflow-x:auto; margin-bottom:1.5rem;">
    <table><thead><tr><th>削除日時</th><th>セッション</th><th>学籍番号</th><th>氏名</th><th>状態</th><th>アラート数</th><th>操作</th></tr></thead><tbody>`;
    statRes.data.forEach(r => {
      const name = state.roster[r.sid]?.name || '---';
      html += `<tr>
        <td style="font-size:0.75rem; color:var(--muted);">${fmtDate(r.deleted_at)}</td>
        <td>${r.topic_id}</td><td><b>${r.sid}</b></td><td>${name}</td>
        <td><span class="pill ${r.status}">${r.status}</span></td>
        <td>${r.alert_count}</td>
        <td><button class="btn btn-ghost" style="color:var(--green); border-color:var(--green); font-size:0.7rem;"
          onclick="restoreStatus('${r.topic_id}','${r.sid}')">復元</button></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // 名簿データ
  if (studRes.data?.length > 0) {
    html += `<p style="font-size:0.75rem; color:var(--muted); font-weight:bold; margin-bottom:0.5rem;">名簿データ（${studRes.data.length}件）</p>
    <div style="overflow-x:auto; margin-bottom:1.5rem;">
    <table><thead><tr><th>削除日時</th><th>クラス</th><th>学籍番号</th><th>氏名</th><th>試験</th><th>操作</th></tr></thead><tbody>`;
    studRes.data.forEach(r => {
      html += `<tr>
        <td style="font-size:0.75rem; color:var(--muted);">${fmtDate(r.deleted_at)}</td>
        <td>${r.class_group}</td><td><b>${r.sid}</b></td><td>${r.name}</td><td>${r.topic_id||'---'}</td>
        <td><button class="btn btn-ghost" style="color:var(--green); border-color:var(--green); font-size:0.7rem;"
          onclick="restoreStudent('${r.sid}')">復元</button></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // 状態履歴
  if (histRes.data?.length > 0) {
    html += `<p style="font-size:0.75rem; color:var(--muted); font-weight:bold; margin-bottom:0.5rem;">状態履歴（${histRes.data.length}件）</p>
    <div style="overflow-x:auto;">
    <table><thead><tr><th>削除日時</th><th>記録日時</th><th>セッション</th><th>学籍番号</th><th>状態</th><th>操作</th></tr></thead><tbody>`;
    histRes.data.forEach(r => {
      html += `<tr>
        <td style="font-size:0.75rem; color:var(--muted);">${fmtDate(r.deleted_at)}</td>
        <td style="font-size:0.75rem;">${fmtDate(r.recorded_at)}</td>
        <td>${r.topic_id}</td><td><b>${r.sid}</b></td>
        <td><span class="pill ${r.status}">${r.status}</span></td>
        <td><button class="btn btn-ghost" style="color:var(--green); border-color:var(--green); font-size:0.7rem;"
          onclick="restoreHistory(${r.id})">復元</button></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  el.innerHTML = html;
}

async function restoreStatus(topic_id, sid) {
  const { error } = await sb.from('exam_status').update({ deleted_at: null }).eq('topic_id', topic_id).eq('sid', sid);
  if (error) { alert('復元失敗: ' + error.message); return; }
  setStatus('● 復元完了 ' + new Date().toLocaleTimeString(), 'var(--green)');
  await pullFromCloud();
  loadTrash();
}

async function restoreStudent(sid) {
  const { error } = await sb.from('students').update({ deleted_at: null }).eq('sid', sid);
  if (error) { alert('復元失敗: ' + error.message); return; }
  setStatus('● 復元完了 ' + new Date().toLocaleTimeString(), 'var(--green)');
  await pullFromCloud();
  loadTrash();
}

async function restoreHistory(id) {
  const { error } = await sb.from('exam_status_history').update({ deleted_at: null }).eq('id', id);
  if (error) { alert('復元失敗: ' + error.message); return; }
  setStatus('● 復元完了 ' + new Date().toLocaleTimeString(), 'var(--green)');
  renderAlertChart(currentChartGroup);
  loadTrash();
}

async function emptyTrash() {
  if (!confirm('ゴミ箱内の全データを完全削除します。\nこの操作は取り消せません。よろしいですか？')) return;
  const btn = document.getElementById('empty-trash-btn');
  btn.disabled = true; btn.textContent = '削除中...';
  await Promise.all([
    sb.from('exam_status').delete().not('deleted_at', 'is', null),
    sb.from('exam_status_history').delete().not('deleted_at', 'is', null),
    sb.from('students').delete().not('deleted_at', 'is', null)
  ]);
  btn.disabled = false; btn.textContent = '完全削除（取り消し不可）';
  setStatus('● ゴミ箱を空にしました ' + new Date().toLocaleTimeString(), 'var(--green)');
  loadTrash();
}

// ─────────────────────────────────────────────
// アラート時系列グラフ
// ─────────────────────────────────────────────
const CHART_PALETTE = ['#3b82f6','#ef4444','#22c55e','#f97316','#a855f7','#06b6d4','#eab308','#ec4899'];
let alertChart = null;
let currentChartGroup = null;
let chartRefreshTimer = null;

function scheduleChartRefresh() {
  clearTimeout(chartRefreshTimer);
  chartRefreshTimer = setTimeout(() => renderAlertChart(currentChartGroup), 2000);
}

function buildChartTabs() {
  const groups = [...new Set(Object.values(state.roster).map(r => r.group).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, 'ja'));
  document.getElementById('chart-tabs').innerHTML =
    `<div class="chart-tab ${currentChartGroup===null?'active':''}" onclick="renderAlertChart(null)">全体</div>` +
    groups.map(g => `<div class="chart-tab ${currentChartGroup===g?'active':''}" onclick="renderAlertChart('${g}')">${g}</div>`).join('');
}

async function renderAlertChart(groupFilter) {
  if (!sb) return;
  currentChartGroup = groupFilter;
  buildChartTabs();

  // ALERTイベントのみ取得
  const { data, error } = await sb
    .from('exam_status_history')
    .select('topic_id,sid,status,recorded_at')
    .eq('status', 'ALERT')
    .is('deleted_at', null)
    .order('recorded_at', { ascending: true });

  if (error) {
    console.warn('グラフ: exam_status_history が見つかりません。SQLを実行してください。', error.message);
    return;
  }

  const allEvents = data || [];
  const filtered = groupFilter
    ? allEvents.filter(h => state.roster[h.sid]?.group === groupFilter)
    : allEvents;

  const emptyEl = document.getElementById('chart-empty');
  if (!filtered.length) {
    if (alertChart) { alertChart.destroy(); alertChart = null; }
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  // 全体: グループ別 / 個別タブ: セッション別
  const seriesKey = !groupFilter
    ? (h => state.roster[h.sid]?.group || '---')
    : (h => h.topic_id);

  const seriesNames = [...new Set(filtered.map(seriesKey))].sort();

  // ── 色の固定割り当て（タブをまたいでも同色） ──
  // 全グループをアルファベット順でソートしてパレットのインデックスを固定
  const allGroupsSorted = [...new Set(
    Object.values(state.roster).map(r => r.group).filter(Boolean)
  )].sort((a,b) => a.localeCompare(b, 'ja'));

  const colorForSeries = name => {
    if (!groupFilter) {
      // 全体タブ: グループ名でインデックス固定
      const idx = allGroupsSorted.indexOf(name);
      return CHART_PALETTE[(idx >= 0 ? idx : 0) % CHART_PALETTE.length];
    } else {
      // 個別タブ: そのグループの色をベースに使う（タブと全体で色が一致）
      const groupIdx = allGroupsSorted.indexOf(groupFilter);
      return CHART_PALETTE[(groupIdx >= 0 ? groupIdx : 0) % CHART_PALETTE.length];
    }
  };

  const fmt2 = n => String(n).padStart(2, '0');
  const fmtTime = ms => {
    const d = new Date(ms);
    return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`;
  };

  // ── スパイク型グラフ: ALERTの瞬間だけY=1に跳ね上がり、前後はY=0 ──
  // 全アラート時刻を使ってスパイク幅を動的に計算
  const allTs = filtered.map(h => new Date(h.recorded_at).getTime());
  const globalMin = Math.min(...allTs);
  const globalMax = Math.max(...allTs);
  const timeRange = Math.max(globalMax - globalMin, 60000);
  // 隣接イベント間の最小間隔の40%をスパイク半幅とする（視認できる幅を確保）
  const sortedTs = [...new Set(allTs)].sort((a,b) => a-b);
  let minGap = timeRange;
  for (let i = 1; i < sortedTs.length; i++) minGap = Math.min(minGap, sortedTs[i] - sortedTs[i-1]);
  const SPIKE_HALF = Math.min(minGap * 0.4, timeRange * 0.02);

  const datasets = seriesNames.map(name => {
    const events = filtered.filter(h => seriesKey(h) === name);
    const color   = colorForSeries(name);

    // 開始ベースライン
    const points = [{ x: globalMin - SPIKE_HALF * 3, y: 0, synthetic: true }];

    events.forEach(h => {
      const ts = new Date(h.recorded_at).getTime();
      points.push({ x: ts - SPIKE_HALF, y: 0, synthetic: true });   // 直前ゼロ
      points.push({                                                    // ピーク
        x: ts, y: 1, synthetic: false,
        meta: { sid: h.sid, topic: h.topic_id, recorded_at: h.recorded_at,
                name: state.roster[h.sid]?.name || h.sid }
      });
      points.push({ x: ts + SPIKE_HALF, y: 0, synthetic: true });   // 直後ゼロ
    });

    // 終端ベースライン
    points.push({ x: Date.now(), y: 0, synthetic: true });

    return {
      label: name,
      data: points,
      parsing: false,
      stepped: false,
      tension: 0,
      borderColor: color,
      backgroundColor: color + '30',
      fill: true,
      borderWidth: 2,
      pointRadius:      ctx => ctx.dataset.data[ctx.dataIndex]?.synthetic ? 0 : 7,
      pointHoverRadius: ctx => ctx.dataset.data[ctx.dataIndex]?.synthetic ? 0 : 10,
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
    };
  });

  const ctx = document.getElementById('alert-chart').getContext('2d');
  if (alertChart) alertChart.destroy();
  alertChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const el = elements[0];
        const pt = datasets[el.datasetIndex].data[el.index];
        if (pt.synthetic || !pt.meta) return;
        highlightDetail(pt.meta.topic, pt.meta.sid, pt.meta.recorded_at);
      },
      onHover: (evt, elements) => {
        const canvas = evt.native?.target;
        if (!canvas) return;
        const clickable = elements.some(el => !datasets[el.datasetIndex]?.data[el.index]?.synthetic);
        canvas.style.cursor = clickable ? 'pointer' : 'default';
      },
      scales: {
        x: {
          type: 'linear',
          grid: { color: '#2a2d3a' },
          ticks: { color: '#64748b', font: { size: 11 }, maxTicksLimit: 10, callback: val => fmtTime(val) }
        },
        y: {
          grid: { color: '#2a2d3a' },
          ticks: { color: '#64748b', font: { size: 11 },
            callback: v => v === 0 ? '0' : v === 1 ? 'ALERT' : '' },
          beginAtZero: true, max: 1.6,
          title: { display: true, text: 'アラート発生', color: '#64748b', font: { size: 11 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0', font: { size: 12 }, padding: 16 } },
        tooltip: {
          backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#94a3b8', padding: 10,
          filter: item => !datasets[item.datasetIndex]?.data[item.dataIndex]?.synthetic,
          callbacks: {
            title: items => fmtTime(items[0].parsed.x),
            label: item => {
              const pt = datasets[item.datasetIndex].data[item.dataIndex];
              return ` ${item.dataset.label}：${pt?.meta?.name || ''}`;
            }
          }
        }
      }
    }
  });
}

// グラフ点クリック: 詳細モーダルを開き該当レコードをハイライト
async function highlightDetail(topic, sid, recorded_at) {
  await showDetail(topic, sid, recorded_at);
}

// ─────────────────────────────────────────────
// 詳細モーダル
// ─────────────────────────────────────────────
async function showDetail(topic, sid, highlightAt = null) {
  const name  = state.roster[sid]?.name  || sid;
  const group = state.roster[sid]?.group || '---';
  const curSt = state.studentStates[`${topic}:${sid}`];
  const curStatus = curSt ? curSt.status : 'OFFLINE';

  document.getElementById('detail-modal-content').innerHTML = `
    <h2 style="margin-bottom:0.4rem; padding-right:2rem;">${name}</h2>
    <p style="color:var(--muted); font-size:0.8rem; margin-bottom:1.5rem;">
      ${group} &nbsp;|&nbsp; 学籍番号: <b style="color:var(--text);">${sid}</b>
      &nbsp;|&nbsp; 試験: <b style="color:var(--text);">${topic}</b>
      &nbsp;|&nbsp; 現在: <span class="history-pill ${curStatus}">${curStatus}</span>
    </p>
    <p style="color:var(--muted); font-size:0.85rem;">読み込み中...</p>`;
  document.getElementById('detail-modal').classList.add('show');

  const { data, error } = await sb
    .from('exam_status_history')
    .select('*')
    .eq('topic_id', topic)
    .eq('sid', sid)
    .is('deleted_at', null)
    .order('recorded_at', { ascending: false });

  if (error) {
    document.getElementById('detail-modal-content').innerHTML += `
      <p style="color:var(--red); margin-top:1rem;">履歴取得失敗: ${error.message}<br>
      <small>Supabase で supabase_history.sql を実行してください。</small></p>`;
    return;
  }

  const rows = (data || []).map(h => {
    const dt = new Date(h.recorded_at);
    const dateStr = dt.toLocaleDateString('ja-JP', { month:'2-digit', day:'2-digit' });
    const timeStr = dt.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    return `<tr data-ts="${h.recorded_at}">
      <td style="white-space:nowrap; color:var(--muted); font-size:0.75rem;">${dateStr}</td>
      <td style="white-space:nowrap;"><b>${timeStr}</b></td>
      <td><span class="history-pill ${h.status}">${h.status}</span></td>
      <td style="text-align:center;">${h.alert_count}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:2rem;">履歴データがありません</td></tr>`;

  const highlightNote = highlightAt
    ? `<p style="font-size:0.75rem; color:var(--blue); margin-bottom:0.6rem;">📍 グラフでクリックした時点のレコードをハイライト表示しています</p>`
    : '';

  document.getElementById('detail-modal-content').innerHTML = `
    <h2 style="margin-bottom:0.4rem; padding-right:2rem;">${name}</h2>
    <p style="color:var(--muted); font-size:0.8rem; margin-bottom:0.8rem;">
      ${group} &nbsp;|&nbsp; 学籍番号: <b style="color:var(--text);">${sid}</b>
      &nbsp;|&nbsp; 試験: <b style="color:var(--text);">${topic}</b>
      &nbsp;|&nbsp; 現在: <span class="history-pill ${curStatus}">${curStatus}</span>
    </p>
    ${highlightNote}
    <table>
      <thead><tr>
        <th>日付</th><th>時刻</th><th>状態</th><th style="text-align:center;">累計アラート</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // 該当レコードをハイライト＆スクロール
  if (highlightAt) {
    const targetTs = new Date(highlightAt).toISOString();
    // recorded_at は秒精度で一致するものを探す（ミリ秒差を吸収）
    const allRows = document.querySelectorAll('#detail-modal-content tbody tr[data-ts]');
    let best = null, bestDiff = Infinity;
    allRows.forEach(tr => {
      const diff = Math.abs(new Date(tr.dataset.ts) - new Date(highlightAt));
      if (diff < bestDiff) { bestDiff = diff; best = tr; }
    });
    if (best && bestDiff < 2000) {
      best.classList.add('history-highlight');
      setTimeout(() => best.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    }
  }
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('show');
}

// ESCキーでモーダルを閉じる
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// Expose functions called from HTML onclick attributes
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.switchTab = switchTab;
window.addTopic = addTopic;
window.deleteTopic = deleteTopic;
window.dismissAlert = dismissAlert;
window.editRoster = editRoster;
window.deleteRoster = deleteRoster;
window.saveRosterGrid = saveRosterGrid;
window.loadRosterIntoGrid = loadRosterIntoGrid;
window.addGridRow = addGridRow;
window.clearGrid = clearGrid;
window.renumberGrid = renumberGrid;
window.syncNow = syncNow;
window.openConnSettings = openConnSettings;
window.changePassword = changePassword;
window.previewDelete = previewDelete;
window.resetDeletePreview = resetDeletePreview;
window.executeDelete = executeDelete;
window.loadTrash = loadTrash;
window.emptyTrash = emptyTrash;
window.restoreStatus = restoreStatus;
window.restoreStudent = restoreStudent;
window.restoreHistory = restoreHistory;
window.renderAlertChart = renderAlertChart;
window.showDetail = showDetail;
window.closeDetail = closeDetail;
window.updateMemo = updateMemo;
window.setSort = setSort;
window.setStatusFilter = setStatusFilter;
window.renderDashboard = renderDashboard;
window.renderStudentTable = renderStudentTable;
