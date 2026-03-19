'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

const NTFY_BASE = 'https://ntfy.sh';
const CHECK_INTERVAL = 3000;
const CONNECT_CHECK_URL = 'https://www.google.com/favicon.ico';

export default function ClientPage() {
    const searchParams = useSearchParams();
    const [topic, setTopic] = useState('');
    const [sid, setSid] = useState('');
    const [status, setStatus] = useState('STANDBY'); // STANDBY, MONITORING, ALERT, FINISHED
    const [isAlertOverlay, setIsAlertOverlay] = useState(false);
    const [lastMsgId, setLastMsgId] = useState('all');
    const startTime = useRef(0);
    const timerRef = useRef<any>(null);

    // 初期化: URLからtopicを取得
    useEffect(() => {
        const t = searchParams.get('topic');
        if (t) setTopic(t);
    }, [searchParams]);

    const beginMonitoring = () => {
        if (!topic || !sid) {
            alert('セッションコードと学籍番号を入力してください');
            return;
        }
        startTime.current = Math.floor(Date.now() / 1000);
        setStatus('MONITORING');
        sendSecureEvent('REGISTER', '開始');

        // 監視ループ開始
        timerRef.current = setInterval(checkConnection, CHECK_INTERVAL);

        // ウィンドウフォーカス検知
        window.onblur = () => sendSecureEvent('FOCUS_LOST', '離脱');
        window.onfocus = () => sendSecureEvent('FOCUS_GAINED', '復帰');
    };

    const checkConnection = async () => {
        let online = false;
        try {
            await fetch(`${CONNECT_CHECK_URL}?t=${Date.now()}`, { 
                mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2000) 
            });
            online = true;
        } catch(e) { online = false; }

        if (online) {
            // 管理者の指示を先に確認 (終了信号があればアラートを出さない)
            const isFinished = await pollAdmin();
            if (!isFinished && status !== 'ALERT') onInternetDetected();
        } else {
            if (status === 'ALERT') { /* 戻った場合の処理 */ }
        }
    };

    const pollAdmin = async () => {
        try {
            const resp = await fetch(`${NTFY_BASE}/${topic}/json?poll=1&since=${lastMsgId}`, { cache: 'no-store' });
            if (!resp.ok) return false;
            const text = await resp.text();
            let finished = false;
            text.trim().split('\n').filter(Boolean).forEach(line => {
                const msg = JSON.parse(line);
                if (msg.event === 'message') {
                    setLastMsgId(msg.id);
                    if (msg.message === 'FINISH_ALL' && msg.time >= (startTime.current - 10)) {
                        finished = true;
                    }
                }
            });
            if (finished) finishExam();
            return finished;
        } catch(e) { return false; }
    };

    const onInternetDetected = () => {
        setStatus('ALERT');
        setIsAlertOverlay(true);
        sendSecureEvent('ALERT', '検知');
        if (Notification.permission === 'granted') {
            new Notification('🚨 ネット接続検知！', { body: '直ちにネットワークを切断してください。' });
        }
    };

    const sendSecureEvent = async (type: string, note: string) => {
        // 🛡️ 重要: ここで /api/notify を通すことで、トピック名を隠蔽する
        try {
            await fetch('/api/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, sid, note, topic })
            });
        } catch(e) {}
    };

    const finishExam = () => {
        clearInterval(timerRef.current);
        setStatus('FINISHED');
        setIsAlertOverlay(false);
    };

    const dismissAlert = () => {
        setIsAlertOverlay(false);
        setStatus('MONITORING');
        sendSecureEvent('DISMISS', '了解');
    };

    // --- View Components ---
    if (status === 'FINISHED') return (
        <div style={{ background: 'radial-gradient(circle, #1e293b, #0f172a)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: '6rem' }}>🎊</div>
            <h1 style={{ color: '#22c55e' }}>試験終了</h1>
            <p>お疲れ様でした。ブラウザを閉じてください。</p>
        </div>
    );

    return (
        <div style={{ background: '#0f1117', color: '#e2e8f0', minHeight: '100vh', fontFamily: 'Segoe UI' }}>
            {status === 'STANDBY' ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                    <div style={{ background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '20px', padding: '2.5rem', width: '100%', maxWidth: '440px', textAlign: 'center' }}>
                        <h1>接続監視システム</h1>
                        <input type="text" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="セッションコード" style={{ width: '100%', margin: '1rem 0', background: '#0f1117', border: '1px solid #2a2d3a', color: 'white', padding: '12px', borderRadius: '10px' }} />
                        <input type="text" value={sid} onChange={e=>setSid(e.target.value)} placeholder="学籍番号" style={{ width: '100%', margin: '1rem 0', background: '#0f1117', border: '1px solid #2a2d3a', color: 'white', padding: '12px', borderRadius: '10px' }} />
                        <button onClick={beginMonitoring} style={{ width: '100%', background: '#22c55e', color: 'black', padding: '14px', borderRadius: '10px', fontWeight: 800, border: 'none' }}>監視開始</button>
                    </div>
                </div>
            ) : (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                    <div style={{ 
                        width: '160px', height: '160px', borderRadius: '50%', margin: '0 auto 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4rem',
                        background: status === 'ALERT' ? '#450a0a' : '#052e16',
                        border: `4px solid ${status === 'ALERT' ? '#ef4444' : '#22c55e'}`
                    }}>
                        {status === 'ALERT' ? '⚠️' : '🔒'}
                    </div>
                    <h2 style={{ fontSize: '2rem', color: status === 'ALERT' ? '#ef4444' : '#22c55e' }}>
                        {status === 'ALERT' ? '接続検知！' : '監視中'}
                    </h2>
                    <p style={{ color: '#64748b' }}>
                        {status === 'ALERT' ? '直ちにネットワークを切断してください' : 'オフラインのまま試験を続けてください'}
                    </p>
                </div>
            )}

            {isAlertOverlay && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: '#1a1d27', border: '2px solid #ef4444', borderRadius: '24px', padding: '2.5rem', textAlign: 'center', width: '90%', maxWidth: '400px' }}>
                        <h2>🚨 接続を検知</h2>
                        <p>ネットワークを切断してください！</p>
                        <button onClick={dismissAlert} style={{ background: '#3b82f6', color: 'white', width: '100%', marginTop: '2rem', padding: '12px', border: 'none', borderRadius: '10px' }}>了解しました</button>
                    </div>
                </div>
            )}
        </div>
    );
}
