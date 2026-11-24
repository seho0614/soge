-- =====================================================================
-- D328 (v10.754 ~ 773 · docs/862 ~ 881) 페이지 · 관 운영 더하기 20(3)
--
--   대표 11/24 「다음개발 후보 모두 제시」 → 「모두 개발 · 점검 뒤에」 → 「동시작업 가능한 경우 동시에」.
--   ① 꾸밀 페이지 열쇠 더함 — COMM 소개광장 메인 · HELP 고객센터 홈 · PARTNER 파트너센터 첫 화면 · MALL_ITEM 소개몰 상품 상세(v10.755 · 757 ~ 759)
--   ② 정기 작업 page_feedback_purge(매일 04:40) — 손님 한 줄 의견 1년 지난 줄 파기(v10.756)
--   ③ site_layout_ab · site_layout_ab_views — 꾸밀 페이지 A/B 비교(v10.760)
--   ④ notices.notify_code · 알림 종류 GWAN_MAINT(회원이 끌 수 있음) · fn_notice_notify 가 그 종류로 보내고 끈 회원은 뺌(v10.765)
--   ⑤ inquiry_templates.gwan_code — 관별 답변 틀(v10.766)
--   ⑥ 설정 ops.digest_hour — 운영 하루 요약(launch_digest) 보내는 시각 · 바꾸면 정기 작업 시각도 같이(트리거 · v10.768)
--   ⑦ 설정 site.publish_two_person · page_publish_requests.first_approved_* — 메인(HOME) 게시 요청은 SUPER 두 사람 승인(처음 off · v10.772)
--   ⑧ 운영 화면 「?」 도움말 페이지 목록 더 보기 절(v10.773 까지 · v10.770) · 권한 주소 표
--   지우는 문장은 옛 CHECK 를 바꾸는 ALTER 만 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_layouts_key_check' AND pg_get_constraintdef(oid) NOT LIKE '%MALL_ITEM%') THEN
    ALTER TABLE public.site_layouts DROP CONSTRAINT site_layouts_key_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_layouts_key_check') THEN
    ALTER TABLE public.site_layouts ADD CONSTRAINT site_layouts_key_check CHECK (key IN ('HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN', 'COMM', 'HELP', 'PARTNER', 'MALL_ITEM'));
  END IF;
END $$;
INSERT INTO public.site_layouts (key) VALUES ('COMM'), ('HELP'), ('PARTNER'), ('MALL_ITEM') ON CONFLICT (key) DO NOTHING;
COMMENT ON COLUMN public.site_layouts.key IS 'v10.696 (D321) 꾸밀 페이지 열쇠 · v10.702 EARN · v10.755 · 757 ~ 759 (D328) COMM · HELP · PARTNER · MALL_ITEM';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('page_feedback_purge', 1440, 4, 40, NULL, true, '손님 한 줄 의견 1년 지난 줄 파기 — page_feedback(기기 지문 해시 · 한 줄) · D328 · v10.756')
ON CONFLICT (job) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.site_layout_ab (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL REFERENCES public.site_layouts(key),
  layout_b    jsonb NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'ENDED')),
  winner      text CHECK (winner IS NULL OR winner IN ('A', 'B')),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_by    uuid REFERENCES public.accounts(id),
  ended_at    timestamptz,
  CONSTRAINT site_layout_ab_window CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '31 days'),
  CONSTRAINT site_layout_ab_end CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS site_layout_ab_running_uq ON public.site_layout_ab (key) WHERE status = 'RUNNING';
COMMENT ON TABLE public.site_layout_ab IS 'v10.760 (D328) 꾸밀 페이지 A/B 비교 — A = 게시된 판 · B = 시작할 때 떠 둔 초안 · 방문자 쿠키 sgb_ab(a · b)로 반반 · 31일까지 · 끝낼 때 B 를 고르면 B 를 새 판으로 게시';
CREATE TABLE IF NOT EXISTS public.site_layout_ab_views (
  ab_id    bigint NOT NULL REFERENCES public.site_layout_ab(id),
  variant  text NOT NULL CHECK (variant IN ('A', 'B')),
  day      date NOT NULL,
  views    integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (ab_id, variant, day)
);
COMMENT ON TABLE public.site_layout_ab_views IS 'v10.760 (D328) A/B 방문 수 — 비교마다 · 판(A · B)마다 · 날(서울)마다 · 개인 정보 없음';

ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS notify_code text NOT NULL DEFAULT 'NOTICE_PUBLISHED';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notices_notify_code_chk') THEN
    ALTER TABLE public.notices ADD CONSTRAINT notices_notify_code_chk CHECK (notify_code IN ('NOTICE_PUBLISHED', 'GWAN_MAINT'));
  END IF;
END $$;
COMMENT ON COLUMN public.notices.notify_code IS 'v10.765 (D328) 회원 알림 종류 — 관 점검 미리 알림 공지는 GWAN_MAINT(내 알림 › 수신 설정에서 끌 수 있음)';
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis)
VALUES ('GWAN_MAINT', '관 점검 안내', true, false, NULL)
ON CONFLICT (event_code) DO NOTHING;

/* fn_notice_notify — D223 판 그대로 + v10.765: 알림 종류 = notices.notify_code · 그 종류 인앱을 끈 회원은 알림 줄을 만들지 않음(받은 사람 표 notice_notified 에는 남겨 다시 보내지 않음) */
CREATE OR REPLACE FUNCTION public.fn_notice_notify(p_id uuid) RETURNS int
    LANGUAGE plpgsql AS $$
DECLARE n public.notices; c int; total int; batch int; cmin int; picked int;
BEGIN
  SELECT * INTO n FROM notices WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT n.notify OR n.notified_at IS NOT NULL OR n.published_at IS NULL OR n.published_at > now()
     OR (n.ends_at IS NOT NULL AND n.ends_at <= now()) THEN
    RETURN 0;
  END IF;
  batch := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_batch'), 2000);
  cmin  := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_confirm_min'), 1000);
  WITH pick AS (
    INSERT INTO notice_notified (notice_id, account_id)
    SELECT n.id, x FROM fn_notice_audience(n.grades) x
     WHERE NOT EXISTS (SELECT 1 FROM notice_notified z WHERE z.notice_id = n.id AND z.account_id = x)
     LIMIT batch
    ON CONFLICT DO NOTHING
    RETURNING account_id
  ), sent AS (
    INSERT INTO notifications (account_id, event_code, title, body, link_url)
    SELECT account_id, coalesce(n.notify_code, 'NOTICE_PUBLISHED'), '새 공지 — ' || left(n.title, 80), left(n.body, 200), CASE WHEN n.gwan_code = 'HLT' AND EXISTS (SELECT 1 FROM hlt_sellers s WHERE s.account_id = pick.account_id AND s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED'))
                THEN '/health/seller/center/notices#n-' ELSE '/community?board=NOTICE#n-' END || n.id::text FROM pick
     WHERE NOT EXISTS (SELECT 1 FROM notification_preferences np
                         JOIN notification_event_policies ep ON ep.event_code = np.event_code AND ep.optout_allowed
                        WHERE np.account_id = pick.account_id AND np.event_code = coalesce(n.notify_code, 'NOTICE_PUBLISHED') AND np.channel = 'INAPP' AND NOT np.enabled)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM pick), (SELECT count(*) FROM sent) INTO picked, c;
  total := coalesce(n.notified_count, 0) + c;
  IF picked < batch THEN
    UPDATE notices SET notified_at = now(), notified_count = total WHERE id = p_id;
    IF total >= cmin THEN
      INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
      VALUES ('NOTICE_NOTIFY_DONE', 'INFO', '공지 알림 ' || total || '명 보냄 — 「' || left(n.title, 60) || '」',
              jsonb_build_object('noticeId', n.id, 'sent', total, 'grades', n.grades), clock_timestamp());
    END IF;
  ELSE
    UPDATE notices SET notified_count = total WHERE id = p_id;   -- 남은 사람은 정기 작업 notice_schedule 이 이어 보냄
  END IF;
  RETURN c;
END $$;

ALTER TABLE public.inquiry_templates ADD COLUMN IF NOT EXISTS gwan_code text REFERENCES public.gwans(code);
COMMENT ON COLUMN public.inquiry_templates.gwan_code IS 'v10.766 (D328) 관별 답변 틀 — 비우면 모든 문의 · 관을 고르면 그 관 페이지에서 온 문의에 먼저 보임';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ops.digest_hour', '9', 'ADMIN', '운영 하루 요약 보내는 시각(v10.768 · docs/876) — 한국 시각 0 ~ 23시 · 바꾸면 정기 작업 launch_digest 시각도 같이 바뀜(분은 00) · 처음 9', false, '^([0-9]|1[0-9]|2[0-3])$', '8'),
  ('site.publish_two_person', 'off', 'SUPER', '메인 게시 두 사람 승인(v10.772 · docs/880) — on 이면 메인(HOME) 게시 요청은 SUPER 한 사람이 1차 승인 · 다른 SUPER 가 2차 승인해야 게시 · 처음 off', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('site.publish_two_person', 'off', 'SUPER 가 두 사람 이상일 때만 켬 — 켜면 메인(HOME) 게시 요청은 다른 SUPER 의 2차 승인이 있어야 게시', 'docs/880', 'SUPER')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_digest_hour_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.key = 'ops.digest_hour' AND NEW.value ~ '^([0-9]|1[0-9]|2[0-3])$' THEN
    UPDATE public.job_schedules SET at_hour = NEW.value::int, at_minute = 0 WHERE job = 'launch_digest' AND at_hour IS DISTINCT FROM NEW.value::int;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_digest_hour_sync ON public.site_settings;
CREATE TRIGGER trg_digest_hour_sync AFTER INSERT OR UPDATE OF value ON public.site_settings FOR EACH ROW WHEN (NEW.key = 'ops.digest_hour') EXECUTE FUNCTION public.fn_digest_hour_sync();
COMMENT ON FUNCTION public.fn_digest_hour_sync() IS 'v10.768 (D328) ops.digest_hour 를 바꾸면 job_schedules.launch_digest 시각도 같이';

ALTER TABLE public.page_publish_requests ADD COLUMN IF NOT EXISTS first_approved_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.page_publish_requests ADD COLUMN IF NOT EXISTS first_approved_at timestamptz;
COMMENT ON COLUMN public.page_publish_requests.first_approved_by IS 'v10.772 (D328) 두 사람 승인 — 1차 승인한 SUPER(2차는 다른 SUPER · 같은 사람이면 422)';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/site-layouts/{key}/ab', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-layouts/{key}/ab', 'gwans', 'VIEW'),
  ('POST', '/admin/site-layouts/{key}/ab', 'gwan-ux', 'APPROVE'), ('POST', '/admin/site-layouts/{key}/ab', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/ab/end', 'gwan-ux', 'APPROVE'), ('POST', '/admin/site-layouts/{key}/ab/end', 'gwans', 'EDIT'),
  ('GET', '/admin/site-pages/publish-log.csv', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-pages/publish-log.csv', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- hdx_ · v10.770 (docs/878) 운영 화면 「?」 도움말 — 페이지 목록에 v10.701 ~ 773 에서 더한 것(지금 판 끝에 붙인 새 판 · 쌓기만 · 4만 자 안 · 이미 있으면 건너뜀)
WITH add_rows(ord, grp, tab_key, heading, body) AS (VALUES
  (1, '17-2. 관 관리 — 페이지 운영(v10.701 ~ 773)', 'site-pages', '페이지 목록 — 더 한 것(v10.701 ~ 773)', $hdx2$- 수정 가능 스위치(SUPER) · 관이 열려 있으면 고칠 수 없음(관을 닫고 고친 뒤 다시 엶) · 메인은 스위치만.
- 관 점검 시간(예약 · 반복 · 미리 알림 공지 · 공지 올리는 때) · 게시 요청 · 승인(메인은 설정에 따라 두 사람) · 예약 달력 · 내 할 일.
- 꾸밀 페이지: 메인 · 관 메인 · 소개몰 메인 · 허브 · 소개광장 · 고객센터 · 파트너센터 · 소개몰 상품 상세 — 블록 복제 · 다른 자리로 옮기기 · 임시 저장(이 브라우저) · 기간 밖 표시 · 언어별 글자(다시 번역 필요 표시) · 검색 결과 미리 보기 · A/B 비교.
- 손님 한 줄 의견(확인함 · 1년 지나면 자동 파기) · 깨진 링크 매일 점검 · 게시 기록 CSV(달마다).
- 게시 · 예약 · 되돌리기: SUPER 또는 업무 권한 「관 UI/UX · 승인」을 사람마다 따로 받은 운영자(직원 · 권한 › 개별 더하기).$hdx2$)
),
cur AS (
  SELECT version, title, body FROM public.v_help_doc_current WHERE code = 'ADMIN_GUIDE'
),
fit AS (
  SELECT a.* FROM add_rows a, cur c
   WHERE position(a.heading IN c.body) = 0
     AND char_length(rtrim(c.body, E'\n')) + char_length(a.grp) + char_length(a.heading) + char_length(a.body) + 20 <= 40000
),
add_text AS (
  SELECT string_agg('## ' || grp || E'\n\n### ' || heading || E'\n' || body, E'\n\n' ORDER BY ord) AS t FROM fit
)
INSERT INTO public.help_docs (code, version, title, body, note)
SELECT 'ADMIN_GUIDE', (SELECT max(version) + 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE'), c.title,
       rtrim(c.body, E'\n') || E'\n\n' || a.t || E'\n', '페이지 목록 더 한 것(v10.770 · docs/878)'
  FROM cur c, add_text a
 WHERE a.t IS NOT NULL;
