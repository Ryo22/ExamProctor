-- 各テーブルに deleted_at カラムを追加（既にある場合はスキップ）
ALTER TABLE public.exam_status         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.exam_status_history ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.students            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- トリガー更新: deleted_at 変更時はログしない（論理削除・復元はステータス変更ではない）
CREATE OR REPLACE FUNCTION log_exam_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 論理削除・復元のみの変更はスキップ
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.exam_status_history (topic_id, sid, status, alert_count)
    VALUES (NEW.topic_id, NEW.sid, NEW.status, NEW.alert_count);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
