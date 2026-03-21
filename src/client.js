let TOPIC = "", SID = "";
let monitoringActive = false;
let isOnline = false;
let isChecking = false;
let firstTick = true;
let currentStatus = 'OFFLINE';
let alertCount = 0;
let lastSyncedStatus = null;

document.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get('topic');
    const sidParam = params.get('sid');
    if (topicParam) document.getElementById('input-topic').value = topicParam;
    if (sidParam) document.getElementById('input-sid').value = sidParam;
});

// サーバー経由でステータスを送信（Supabase には直接アクセスしない）
async function syncStatus(status, count) {
    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic_id: TOPIC,
                sid: SID,
                status,
                alert_count: count ?? alertCount,
                last_seen: new Date().toISOString()
            })
        });
        if (res.ok) { lastSyncedStatus = status; return true; }
        console.error('syncStatus API error:', res.status);
        return false;
    } catch(e) {
        console.error('syncStatus error:', e);
        return false;
    }
}

// ① ログインボタン: 入力確認 → LOGIN ステータスを送信 → 案内画面へ
async function handleLogin() {
    const topic = document.getElementById('input-topic').value.trim();
    const sid   = document.getElementById('input-sid').value.trim();
    const errEl = document.getElementById('entry-error');
    const btn   = document.getElementById('login-btn');

    errEl.textContent = '';
    if (!topic || !sid) {
        errEl.textContent = 'セッション名と学籍番号を入力してください。';
        return;
    }

    TOPIC = topic;
    SID   = sid;

    btn.textContent = 'ログイン中...';
    btn.disabled = true;

    // LOGIN ステータスを Supabase へ送信
    const ok = await syncStatus('LOGIN', 0);

    btn.textContent = 'システムにログインする';
    btn.disabled = false;

    if (!ok) {
        errEl.textContent = 'ネットワークエラー。接続を確認して再試行してください。';
        return;
    }

    // 案内画面へ
    document.getElementById('login-topic-disp').textContent = TOPIC;
    document.getElementById('login-sid-disp').textContent   = SID;
    document.getElementById('entry-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('meta-container').classList.remove('hidden');
    document.getElementById('meta-session').textContent = TOPIC;
    document.getElementById('meta-sid').textContent     = SID;
}

// ② 監視開始ボタン: 案内画面 → 監視画面
function startProctoring() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    monitoringActive = true;
    updateUI('CHECKING');
    setInterval(tick, 1000);
}

// メインループ: 接続確認 → 状態更新 → 同期
async function tick() {
    if (isChecking) return;
    if (!monitoringActive && lastSyncedStatus === 'FINISHED') return;
    isChecking = true;

    let online = false;
    try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 3000);
        await fetch('https://www.gstatic.com/generate_204', {
            method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal
        });
        online = true;
    } catch(e) { online = false; }

    const wasOnline = isOnline;
    isOnline = online;

    if (monitoringActive && currentStatus !== 'FINISHED') {
        if (firstTick) {
            firstTick = false;
            if (online) {
                currentStatus = 'ALERT';
                alertCount++;
                updateUI('ALERT');
            } else {
                currentStatus = 'SAFE';
                updateUI('SAFE');
            }
        } else if (!wasOnline && online) {
            await syncStatus('SAFE');
            await new Promise(r => setTimeout(r, 500));
            currentStatus = 'ALERT';
            alertCount++;
            updateUI('ALERT');
        } else if (wasOnline && !online) {
            currentStatus = 'SAFE';
            updateUI('SAFE');
        } else if (online && currentStatus === 'SAFE') {
            currentStatus = 'ALERT';
            alertCount++;
            updateUI('ALERT');
        }
    }

    if (online && currentStatus !== lastSyncedStatus) {
        await syncStatus(currentStatus);
    }

    isChecking = false;
}

function updateUI(status) {
    const card  = document.getElementById('main-screen');
    const icon  = document.getElementById('state-icon');
    const label = document.getElementById('state-label');
    const desc  = document.getElementById('state-desc');
    const btn   = document.getElementById('dismiss-btn');

    if (status === 'CHECKING') {
        card.className = 'card';
        icon.textContent = '🔍';
        label.textContent = '確認中...';
        label.style.color = 'var(--muted)';
        desc.textContent = 'ネットワーク接続をチェックしています...';
        btn.style.display = 'none';
    } else if (status === 'SAFE') {
        card.className = 'card';
        icon.textContent = '✅';
        label.textContent = 'オフライン確認';
        label.style.color = 'var(--green)';
        desc.textContent = 'ネットワーク未接続を確認しました。そのまま試験を続けてください。';
        btn.style.display = 'none';
    } else if (status === 'ALERT') {
        card.className = 'card alert-active';
        icon.textContent = '⚠️';
        label.textContent = 'ネット接続検知';
        label.style.color = 'var(--red)';
        desc.textContent = '直ちに Wi-Fi をオフにするか、LANケーブルを抜いてください！';
        btn.style.display = 'block';
    } else if (status === 'ENDED') {
        card.className = 'card';
        icon.textContent = '✅';
        label.textContent = '試験終了';
        label.style.color = 'var(--muted)';
        desc.textContent = 'お疲れ様でした。このページを閉じてください。';
        btn.style.display = 'none';
        document.getElementById('end-btn').style.display = 'none';
    }
}

function onDismiss() {
    currentStatus = 'SAFE';
    updateUI('SAFE');
    if (isOnline) {
        (async () => { await syncStatus('SAFE'); })();
    }
}

function onEnd() {
    if (!confirm('試験を終了しますか？\n終了後は監視が停止されます。')) return;
    monitoringActive = false;
    currentStatus = 'FINISHED';
    updateUI('ENDED');
}

window.handleLogin = handleLogin;
window.startProctoring = startProctoring;
window.onDismiss = onDismiss;
window.onEnd = onEnd;
