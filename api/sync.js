import { createClient } from '@supabase/supabase-js';

const VALID_STATUSES = ['LOGIN', 'SAFE', 'ALERT', 'FINISHED'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic_id, sid, status, alert_count, last_seen } = req.body;

  if (!topic_id || !sid || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const { error } = await sb.from('exam_status').upsert({
      topic_id,
      sid,
      status,
      alert_count: alert_count ?? 0,
      last_seen: last_seen || new Date().toISOString()
    }, { onConflict: 'topic_id,sid' });

    if (error) {
      console.error('Supabase error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('API error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
