-- ステータス履歴テーブル
CREATE TABLE IF NOT EXISTS public.exam_status_history (
  id BIGSERIAL PRIMARY KEY,
  topic_id TEXT NOT NULL,
  sid TEXT NOT NULL,
  status TEXT NOT NULL,
  alert_count INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exam_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_all" ON public.exam_status_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.exam_status_history TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.exam_status_history_id_seq TO anon;

-- exam_status の INSERT / UPDATE 時に自動ログを記録するトリガー
CREATE OR REPLACE FUNCTION log_exam_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT 時、または status が変わった UPDATE 時のみ記録
  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.exam_status_history (topic_id, sid, status, alert_count)
    VALUES (NEW.topic_id, NEW.sid, NEW.status, NEW.alert_count);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS exam_status_change_trigger ON public.exam_status;
CREATE TRIGGER exam_status_change_trigger
  AFTER INSERT OR UPDATE ON public.exam_status
  FOR EACH ROW EXECUTE FUNCTION log_exam_status_change();
