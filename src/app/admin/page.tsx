'use client';

import { useEffect, useState, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// 🛡️ 秘匿設定 (機密情報はここで隠し、環境変数にすることも可能)
const NTFY_BASE = 'https://ntfy.sh';
const STORAGE_KEY = 'proctor_admin_data_next_v4';

export default function AdminPage() {
    const [state, setState] = useState<any>({ topics: [], roster: {}, studentStates: {}, lastIds: {}, chartLabels: [], chartHits: [] });
    const [activeTab, setActiveTab] = useState('page-dash');
    const [filterTopic, setFilterTopic] = useState<string | null>(null);
    const [filterGroup, setFilterGroup] = useState<string | null>(null);
    const [syncTime, setSyncTime] = useState('--:--:--');
    const chartRef = useRef<any>(null);
    const chartInstance = useRef<any>(null);

    // 初期化とLocal Storage読み込み
    useEffect(() => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setState(JSON.parse(raw));

        const interval = setInterval(() => {
            pollAll();
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    // グラフ初期化
    useEffect(() => {
        if (chartRef.current && !chartInstance.current) {
            const ctx = chartRef.current.getContext('2d');
            chartInstance.current = new Chart(ctx, {
                type: 'line',
                data: { labels: state.chartLabels, datasets: [{ label: '検知数', data: state.chartHits, borderColor: '#ef4444', tension: 0.4 }] },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { beginAtZero: true } } }
            });
        }
        if (chartInstance.current) {
            chartInstance.current.data.labels = state.chartLabels;
            chartInstance.current.data.datasets[0].data = state.chartHits;
            chartInstance.current.update('none');
        }
    }, [state.chartLabels, state.chartHits]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    // 通信処理 (ポーリング)
    const pollAll = async () => {
        const topics = state.topics;
        for (const t of topics) {
            try {
                const since = state.lastIds[t] || 'all';
                const resp = await fetch(`${NTFY_BASE}/${t}/json?poll=1&since=${since}`);
                if (!resp.ok) continue;
                const text = await resp.text();
                text.trim().split('\n').filter(Boolean).forEach(line => {
                    const msg = JSON.parse(line);
                    if (msg.event === 'message') {
                        // メッセージの処理
                        processMessage(t, msg);
                    }
                });
            } catch (e) {}
        }
        setSyncTime(new Date().toLocaleTimeString());
    };

    const processMessage = (t: string, msg: any) => {
        const parts = msg.message.split(':');
        const type = parts[0], sid = parts[1];
        if(!sid) return;
        const key = `${t}:${sid}`;
        const ts = new Date(msg.time * 1000);

        setState((prev: any) => {
            const newState = { ...prev };
            if (!newState.studentStates[key]) {
                newState.studentStates[key] = { topic: t, sid, status: 'SAFE', alertCount: 0, lastCheck: ts };
            }
            const s = newState.studentStates[key];
            if (new Date(s.lastCheck) > ts) return prev; // 重複防止
            
            s.lastCheck = ts;
            if (type === 'ALERT') { 
                s.status = 'ALERT'; s.alertCount++;
                // グラフ更新フラグなど
            }
            else if (type === 'FOCUS_LOST') s.status = 'FOCUS-LOST';
            else if (type === 'FOCUS_GAINED') s.status = 'SAFE';
            else if (type === 'REGISTER') s.status = 'SAFE';
            else if (type === 'DISMISS') s.status = 'SAFE';

            newState.lastIds[t] = msg.id;
            return newState;
        });
    };

    // --- UI レンダリング補助 ---
    const allRosterIds = Object.keys(state.roster);
    const groups = ['全体表示', ...Array.from(new Set(allRosterIds.map(id => state.roster[id].group || '---')))];
    const filteredRows = state.topics.flatMap((t:string) => {
        if (filterTopic && t !== filterTopic) return [];
        return allRosterIds
            .filter(sid => !filterGroup || filterGroup === '全体表示' || state.roster[sid].group === filterGroup)
            .map(sid => state.studentStates[`${t}:${sid}`] || { topic: t, sid, status: 'OFFLINE', alertCount: 0 });
    });

    return (
        <div style={{ background: '#0f1117', color: '#e2e8f0', minHeight: '100vh', fontFamily: 'Segoe UI' }}>
            {/* Header */}
            <header style={{ background: '#1a1d27', borderBottom: '1px solid #2a2d3a', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 style={{ fontSize: '1.2rem', fontWeight: 900 }}>🛡️ Secure Admin</h1>
                <nav style={{ display: 'flex', gap: '5px' }}>
                    <TabButton active={activeTab==='page-dash'} onClick={() => setActiveTab('page-dash')}>ダッシュボード</TabButton>
                    <TabButton active={activeTab==='page-sessions'} onClick={() => setActiveTab('page-sessions')}>試験管理</TabButton>
                    <TabButton active={activeTab==='page-roster'} onClick={() => setActiveTab('page-roster')}>名簿マスタ</TabButton>
                </nav>
                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>● 同期完了 - {syncTime}</div>
            </header>

            <main style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
                {activeTab === 'page-dash' && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                            <StatBox val={filteredRows.length} label="監視人数" />
                            <StatBox val={filteredRows.filter((r:any)=>r.status==='ALERT').length} label="検知中" color="#ef4444" />
                            <StatBox val={filteredRows.filter((r:any)=>r.status==='FOCUS-LOST').length} label="離脱中" color="#f97316" />
                            <StatBox val={state.topics.length} label="セッション" />
                        </div>

                        <h2>1. フィルター：クラス</h2>
                        <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {groups.map(g => (
                                <Chip key={g} label={g} active={g === filterGroup || (g==='全体表示' && !filterGroup)} onClick={() => setFilterGroup(g==='全体表示' ? null : g)} />
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem' }}>
                            <div className="card" style={{ background: '#1a1d27', padding: '1.5rem', borderRadius: '16px' }}>
                                <h2>受験生状況一覧</h2>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead style={{ borderBottom: '1px solid #2a2d3a' }}>
                                        <tr>
                                            <th>クラス</th><th>学籍番号</th><th>状態</th><th>検知</th><th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredRows.sort((a:any,b:any)=>a.sid.localeCompare(b.sid)).map((r:any) => (
                                            <tr key={`${r.topic}:${r.sid}`} style={{ borderBottom: '1px solid #2a2d3a' }}>
                                                <td><small>{state.roster[r.sid]?.group || '---'}</small></td>
                                                <td><b>{r.sid}</b> ({r.topic})</td>
                                                <td><span style={{ 
                                                    background: r.status==='ALERT'?'#ef4444' : r.status==='SAFE'?'#22c55e' : '#0f1117',
                                                    color: r.status==='OFFLINE' ? '#64748b' : 'white',
                                                    padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem'
                                                }}>{r.status}</span></td>
                                                <td>{r.alertCount}</td>
                                                <td><button style={{ background: 'transparent', border: '1px solid #2a2d3a', color: '#64748b', fontSize: '0.7rem' }}>解除</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="alerts">
                                <h3>📈 検知トレンド</h3>
                                <div style={{ height: '120px' }}>
                                    <canvas ref={chartRef}></canvas>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

// Sub components
function TabButton({ children, active, onClick }: any) {
    return (
        <button onClick={onClick} style={{ 
            background: active ? '#1a1d27' : 'transparent', color: active ? '#3b82f6' : '#64748b',
            border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 
        }}>{children}</button>
    );
}

function StatBox({ val, label, color }: any) {
    return (
        <div style={{ background: '#1a1d27', border: '1px solid #2a2d3a', padding: '1.2rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: color || 'white' }}>{val}</div>
            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
        </div>
    );
}

function Chip({ label, active, onClick }: any) {
    return (
        <div onClick={onClick} style={{ 
            background: active ? 'rgba(59,130,246,0.1)' : '#1a1d27', border: active ? '1px solid #3b82f6' : '1px solid #2a2d3a',
            padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: active ? 800 : 500, whiteSpace: 'nowrap'
        }}>{label}</div>
    );
}
