-- client.html で未登録の学生がログインした際、自動的に students テーブルに登録を行うための設定

-- 1. 未登録学生を自動登録する関数
CREATE OR REPLACE FUNCTION auto_register_unlisted_student()
RETURNS TRIGGER AS $$
BEGIN
  -- students テーブルにその学籍番号(sid)が存在しない場合のみ、新規に行(レコード)を追加する
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE sid = NEW.sid) THEN
    INSERT INTO public.students (sid, name, class_group, topic_id)
    VALUES (NEW.sid, '未登録学生（自動登録）', '未分類', NEW.topic_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. exam_status テーブルに INSERT または UPDATE される前に上記の関数を呼び出すトリガー
DROP TRIGGER IF EXISTS auto_register_student_trigger ON public.exam_status;
CREATE TRIGGER auto_register_student_trigger
  BEFORE INSERT OR UPDATE ON public.exam_status
  FOR EACH ROW EXECUTE FUNCTION auto_register_unlisted_student();
