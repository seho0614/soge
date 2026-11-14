-- =====================================================================
-- D216 (v10.290 · docs/414) — 공지 알림 받은 사람 기록 1년 뒤 파기
--
--   대표 승인(11/14 묶음 1 ★1): notice_notified(공지 · 받은 사람 · v10.285 D212)는 나눠 보낼 때 같은 사람에게
--   두 번 가지 않게 하려는 기록 — 다 보낸 뒤에는 쓸 곳이 없고 「누가 어떤 공지 알림을 받았는지」가 남음.
--   ① privacy.notice_notified_days(처음 365 · 30 ~ 1825) 지나면 매일 03:00 개인정보 파기 작업(pii_purge)이 지움
--   ② 알림을 다 보낸 공지(notified_at 있음)만 — 아직 나눠 보내는 중인 공지 기록은 남김(두 번 가지 않게)
--   ③ 공지를 펼쳐 본 기록(notice_reads · 입점 약관 제17조 4항 「공지를 봤다」 증거)은 그대로
--   지우는 문장 없음(표 · 기록). 재실행 안전.
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('privacy.notice_notified_days', '365', 'ADMIN',
        '공지 알림 받은 사람 기록 보관 일수(v10.290 · D216) — 알림을 다 보낸 공지는 받은 지 이 일수가 지나면 매일 03:00 파기. 30 ~ 1825.',
        false, '^[0-9]{2,4}$', '365')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_notice_notified_at ON public.notice_notified (at);

CREATE OR REPLACE FUNCTION public.fn_purge_notice_notified() RETURNS integer
    LANGUAGE plpgsql AS $$
DECLARE d int; n int;
BEGIN
  d := coalesce((SELECT nullif(btrim(value), '')::int FROM site_settings WHERE key = 'privacy.notice_notified_days'), 365);
  d := least(greatest(d, 30), 1825);
  DELETE FROM notice_notified z
   USING notices n
   WHERE n.id = z.notice_id AND n.notified_at IS NOT NULL
     AND z.at < now() - make_interval(days => d);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION public.fn_purge_notice_notified() IS
  'v10.290 (D216) 다 보낸 공지의 알림 받은 사람 기록 — privacy.notice_notified_days(365) 지나면 지움 · pii_purge 가 부름';
