import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ background: '#0f1117', color: '#e2e8f0', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '2rem' }}>
      <h1>🛡️ Secure Exam Proctoring</h1>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <Link href="/admin" style={{ background: '#3b82f6', color: 'white', padding: '12px 24px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700 }}>監督者ログイン</Link>
        <Link href="/client" style={{ background: '#1a1d27', color: '#e2e8f0', border: '1px solid #2a2d3a', padding: '12px 24px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700 }}>受験者ページ</Link>
      </div>
      <p style={{ color: '#64748b' }}>Vercel にデプロイして安全な試験環境を実現しましょう。</p>
    </div>
  );
}
