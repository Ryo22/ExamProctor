import { NextRequest, NextResponse } from 'next/server';

/**
 * 🛡️ 秘匿型プロキシ API (Server side only)
 * クライアントからは /api/notify として呼び出されます。
 * 核心となるトピック名は、環境変数から読み込まれるため、
 * ブラウザのソースコードから特定することは不可能です。
 */
export async function POST(req: NextRequest) {
  try {
    const { type, sid, note, topic } = await req.json();

    // 実際の宛先トピック（管理者の設定したトピック名）
    // 完全に隠蔽したい場合は、topic パラメータを受け取らずに
    // サーバー側の .env から特定の固定トピック名を参照させます
    const secretTopic = process.env.NTFY_TOPIC_SECRET || topic;

    if (!secretTopic) {
        return NextResponse.json({ error: 'Topic not found' }, { status: 400 });
    }

    const payload = `${type}:${sid}:${note}`;

    // サーバー内部から ntfy.sh へ送信
    const resp = await fetch(`https://ntfy.sh/${secretTopic}`, {
      method: 'POST',
      body: payload,
      headers: {
        'X-Priority': type === 'ALERT' ? '5' : '3',
        'Cache-Control': 'no-store'
      }
    });

    if (!resp.ok) {
        throw new Error('Upstream relay failed');
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
