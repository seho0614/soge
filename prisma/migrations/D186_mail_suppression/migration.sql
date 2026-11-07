-- =====================================================================
-- D186 — 메일 반송 · 수신 거부 주소(보내지 않을 주소) (v10.209 · 2026-11-07)
--
--   대표 「메일 반송 표시(A-6)」 · 「꺼진 채로 미리」(11/7). 전에는 SES 억제 목록에만 있고 앱 기록은 「보냄」이었음(docs/167 4절).
--
--   ① mail_suppressions — 영구 반송(Permanent) · 수신 거부(Complaint)가 온 주소. 알림 메일을 보내지 않고 「SUPPRESSED」로 닫음.
--      운영 화면에서 SUPER 가 사유를 적고 풀 수 있음(다시 반송이 오면 다시 막힘). 지우지 않음.
--   ② mail_feedback_events — SES → SNS 알림을 받은 기록(같은 알림 번호는 한 번만 · 받는 주소는 남기지 않고 수만).
--   ③ 스위치 notify.ses_feedback(처음 off) · 받을 SNS 주제 notify.ses_topic_arn(처음 비어 있음 — 이 주제의 알림만 받음).
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mail_suppressions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('BOUNCE', 'COMPLAINT')),
  detail        text CHECK (detail IS NULL OR length(detail) <= 200),
  hits          int  NOT NULL DEFAULT 1 CHECK (hits > 0),
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  released_by   uuid,
  release_note  text CHECK (release_note IS NULL OR length(release_note) <= 300),
  CONSTRAINT ux_mail_suppressions_email UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS ix_mail_suppressions_active ON public.mail_suppressions (last_at DESC) WHERE released_at IS NULL;
COMMENT ON TABLE public.mail_suppressions IS
  '보내지 않을 메일 주소(D186) — SES 영구 반송 · 수신 거부. released_at 이 비어 있으면 알림 메일을 보내지 않음. 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_mail_suppressions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MAILSUP: 반송 주소 기록은 지울 수 없습니다 — 풀기를 쓰십시오.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mail_suppressions_guard ON public.mail_suppressions;
CREATE TRIGGER trg_mail_suppressions_guard BEFORE DELETE ON public.mail_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.fn_mail_suppressions_guard();

-- 반송 · 수신 거부 한 건 — 처음이면 넣고, 있으면 수를 올리고 다시 막음(풀어 둔 것도)
CREATE OR REPLACE FUNCTION public.fn_mail_suppress(p_email text, p_reason text, p_detail text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.mail_suppressions (email, reason, detail)
  VALUES (lower(trim(p_email)), p_reason, left(p_detail, 200))
  ON CONFLICT (email) DO UPDATE
     SET hits = public.mail_suppressions.hits + 1, last_at = now(), reason = EXCLUDED.reason, detail = EXCLUDED.detail,
         released_at = NULL, released_by = NULL, release_note = NULL
  RETURNING id;
$$;

CREATE TABLE IF NOT EXISTS public.mail_feedback_events (
  id              bigserial PRIMARY KEY,
  sns_message_id  text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('BOUNCE', 'COMPLAINT', 'DELIVERY', 'OTHER')),
  sub             text CHECK (sub IS NULL OR length(sub) <= 100),
  recipients      int  NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  suppressed      int  NOT NULL DEFAULT 0 CHECK (suppressed >= 0),
  received_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mail_feedback_msg UNIQUE (sns_message_id)
);
CREATE INDEX IF NOT EXISTS ix_mail_feedback_at ON public.mail_feedback_events (received_at DESC);
COMMENT ON TABLE public.mail_feedback_events IS 'SES → SNS 반송 · 수신 거부 알림 받은 기록(D186) — 받는 주소는 남기지 않음(수만) · 같은 알림은 한 번';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('notify.ses_feedback', 'off', 'GLOBAL',
        '메일 반송 · 수신 거부 받기(v10.209 · D186 · docs/334) — on 이면 SES → SNS 알림(POST /api/v1/webhooks/ses)을 받아 영구 반송 · 수신 거부 주소에 알림 메일을 보내지 않음. SNS 주제를 만들고 notify.ses_topic_arn 을 넣은 뒤 켜십시오.',
        false, '^(on|off)$', 'off'),
       ('notify.ses_topic_arn', NULL, 'GLOBAL',
        'SES 반송 · 수신 거부 알림 SNS 주제 ARN(v10.209 · D186) — 이 주제에서 온 알림만 받음. 비어 있으면 받지 않음.',
        false, '^arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+$', 'arn:aws:sns:ap-northeast-2:123456789012:sgb-ses-feedback')
ON CONFLICT (key) DO NOTHING;
