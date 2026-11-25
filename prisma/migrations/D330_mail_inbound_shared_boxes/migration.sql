-- =====================================================================
-- D330 (v10.789 · docs/904) 사내 웹메일 W1 — 공용 메일함 받기(SES 받기 → SNS → 웹훅)
--
--   대표 11/25 「사내 웹메일 구축」 → B. AWS 직접 구축 → W0 · W1 · W2 모두 진행(docs/902 · decisions mail-ses #11).
--   ① mail_boxes          공용 주소(privacy · help · admin · dmarc @sogaebank.com) · 담당 역할
--   ② mail_messages       받은 · 보낸 메일(SES 메시지 번호 + 메일함마다 한 줄) · 판정(스팸 · 바이러스 · SPF · DKIM · DMARC) · 상태
--   ③ mail_attachments    첨부(받은 원본이 SNS 로 온 것만 · 150KB 안이라 DB 에)
--   ④ mail_inbound_events SNS 알림 번호 한 번만
--   ⑤ mail_access_log     누가 어떤 메일을 열고 · 답하고 · 넘기고 · 끝냈는지(개인정보 문의라 남김 · 쌓기만)
--   ⑥ 설정 mail.inbound(처음 off · SUPER) · mail.inbound_topic_arn(SNS 주제)
--   다시 돌려도 같음 · RAISE 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mail_boxes (
  id          serial PRIMARY KEY,
  address     text NOT NULL UNIQUE CHECK (address ~ '^[a-z0-9._-]{1,40}@sogaebank\.com$'),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  task_key    text NOT NULL CHECK (task_key ~ '^[a-z0-9-]{1,40}$'),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mail_boxes IS 'v10.789 (D330) 공용 메일함 주소 · 담당 업무 권한(task_key) — 받기 규칙(SES)에 같은 주소가 있어야 메일이 옴';
INSERT INTO public.mail_boxes (address, label, task_key) VALUES
  ('privacy@sogaebank.com', '개인정보 문의', 'mailbox-privacy'),
  ('help@sogaebank.com', '고객센터', 'mailbox-help'),
  ('admin@sogaebank.com', '운영', 'mailbox-admin'),
  ('dmarc@sogaebank.com', 'DMARC 보고', 'mailbox-admin')
ON CONFLICT (address) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mail_messages (
  id              bigserial PRIMARY KEY,
  box_id          integer NOT NULL REFERENCES public.mail_boxes(id),
  direction       text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  ses_message_id  text CHECK (ses_message_id IS NULL OR char_length(ses_message_id) <= 200),
  header_msgid    text CHECK (header_msgid IS NULL OR char_length(header_msgid) <= 500),
  in_reply_to     text CHECK (in_reply_to IS NULL OR char_length(in_reply_to) <= 500),
  thread_key      text CHECK (thread_key IS NULL OR char_length(thread_key) <= 500),
  from_addr       text CHECK (from_addr IS NULL OR char_length(from_addr) <= 320),
  from_name       text CHECK (from_name IS NULL OR char_length(from_name) <= 200),
  to_addrs        text[] NOT NULL DEFAULT '{}',
  cc_addrs        text[] NOT NULL DEFAULT '{}',
  subject         text CHECK (subject IS NULL OR char_length(subject) <= 1000),
  sent_at         timestamptz,
  received_at     timestamptz NOT NULL DEFAULT now(),
  text_body       text,
  html_body       text,
  size_bytes      integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  has_content     boolean NOT NULL DEFAULT false,
  s3_bucket       text CHECK (s3_bucket IS NULL OR s3_bucket ~ '^[a-z0-9.-]{3,63}$'),
  s3_key          text CHECK (s3_key IS NULL OR char_length(s3_key) <= 1024),
  spam            text CHECK (spam IS NULL OR spam IN ('PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED')),
  virus           text CHECK (virus IS NULL OR virus IN ('PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED')),
  spf             text CHECK (spf IS NULL OR spf IN ('PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED')),
  dkim            text CHECK (dkim IS NULL OR dkim IN ('PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED')),
  dmarc           text CHECK (dmarc IS NULL OR dmarc IN ('PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED')),
  state           text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW', 'ASSIGNED', 'DONE', 'SPAM', 'SENT')),
  assignee        uuid REFERENCES public.accounts(id),
  done_at         timestamptz,
  done_by         uuid REFERENCES public.accounts(id),
  sent_by         uuid REFERENCES public.accounts(id),
  reply_to_id     bigint REFERENCES public.mail_messages(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_messages_out_sent CHECK (direction = 'IN' OR (state = 'SENT' AND sent_by IS NOT NULL)),
  CONSTRAINT mail_messages_done CHECK ((state = 'DONE') = (done_at IS NOT NULL) OR state = 'SENT')
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_ses_box ON public.mail_messages (ses_message_id, box_id) WHERE ses_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_messages_box_recv ON public.mail_messages (box_id, received_at DESC);
CREATE INDEX IF NOT EXISTS mail_messages_thread ON public.mail_messages (thread_key);
COMMENT ON TABLE public.mail_messages IS 'v10.789 (D330) 공용 메일함 받은 · 보낸 메일 — SES 메시지 번호 + 메일함마다 한 줄(여러 공용 주소로 온 메일은 메일함마다) · S3 원본 위치 · 본문은 SNS 로 온 것만(has_content)';
COMMENT ON COLUMN public.mail_messages.has_content IS 'SNS 알림에 원본이 들어 있어 본문 · 첨부를 풀었으면 true — 큰 메일(150KB 넘음)은 S3 원본만(false)';

CREATE TABLE IF NOT EXISTS public.mail_attachments (
  id            bigserial PRIMARY KEY,
  message_id    bigint NOT NULL REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  filename      text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type  text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 200),
  size_bytes    integer NOT NULL CHECK (size_bytes >= 0),
  content_id    text CHECK (content_id IS NULL OR char_length(content_id) <= 300),
  is_inline     boolean NOT NULL DEFAULT false,
  data          bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_attachments_msg ON public.mail_attachments (message_id);
COMMENT ON TABLE public.mail_attachments IS 'v10.789 (D330) 공용 메일함 첨부 — 바이러스 판정 FAIL 인 메일의 첨부는 내려받기 막음(서버)';

CREATE TABLE IF NOT EXISTS public.mail_inbound_events (
  sns_message_id  text PRIMARY KEY CHECK (char_length(sns_message_id) <= 200),
  kind            text NOT NULL CHECK (kind IN ('S3', 'SNS', 'OTHER')),
  ses_message_id  text CHECK (ses_message_id IS NULL OR char_length(ses_message_id) <= 200),
  boxes           integer NOT NULL DEFAULT 0 CHECK (boxes >= 0),
  received_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mail_inbound_events IS 'v10.789 (D330) SES 받기 SNS 알림 번호 — 같은 알림은 한 번만(쌓기만)';

CREATE TABLE IF NOT EXISTS public.mail_access_log (
  id          bigserial PRIMARY KEY,
  message_id  bigint NOT NULL REFERENCES public.mail_messages(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  action      text NOT NULL CHECK (action IN ('VIEW', 'REPLY', 'ASSIGN', 'DONE', 'REOPEN', 'SPAM', 'DOWNLOAD')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_access_log_msg ON public.mail_access_log (message_id, at DESC);
COMMENT ON TABLE public.mail_access_log IS 'v10.789 (D330) 공용 메일함 열람 · 처리 기록(개인정보 문의 · 쌓기만 — 고치기 · 지우기 막음)';

CREATE OR REPLACE FUNCTION public.fn_mail_access_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'MAIL_LOG_APPEND_ONLY: 공용 메일함 열람 기록은 고치거나 지울 수 없습니다';
END $fn$;
DROP TRIGGER IF EXISTS trg_mail_access_log_append_only ON public.mail_access_log;
CREATE TRIGGER trg_mail_access_log_append_only BEFORE UPDATE OR DELETE ON public.mail_access_log FOR EACH ROW EXECUTE FUNCTION public.fn_mail_access_log_append_only();

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mail.inbound', 'off', 'SUPER', '공용 메일함 받기(v10.789 · docs/904) — on 이면 SES 받기 SNS 알림(POST /api/v1/webhooks/ses/inbound)을 받아 공용 메일함에 넣음 · 주제는 mail.inbound_topic_arn 하나만 · 처음 off', false, '^(on|off)$', 'on'),
  ('mail.inbound_topic_arn', NULL, 'SUPER', '공용 메일함 받기 SNS 주제(v10.789) — SES 받기 규칙의 SNS 주제 ARN · 다른 주제의 알림은 403', false, '^arn:aws:sns:[a-z0-9-]{4,30}:[0-9]{12}:[A-Za-z0-9_-]{1,200}$', 'arn:aws:sns:ap-northeast-2:123456789012:sgb-mail-inbound')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('mail.inbound', 'off', 'W0(SES 받기 규칙 · S3 · SNS 주제) 를 만든 뒤 · mail.inbound_topic_arn 을 넣고 켬', 'docs/904', 'SUPER')
ON CONFLICT (key) DO NOTHING;

-- ── 업무 권한 · 주소 표(직원 · 권한 › 업무별 권한) — 주소 표는 세 업무 중 하나 · 메일함마다 거르기는 서버(mailbox-admin.ts) ──
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('mailbox-privacy', '공용 메일함 · 개인정보 문의', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 151),
  ('mailbox-help', '공용 메일함 · 고객센터', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 152),
  ('mailbox-admin', '공용 메일함 · 운영 · DMARC', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 153)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN', 'mailbox-privacy'), ('R_ADMIN', 'mailbox-help'), ('R_ADMIN', 'mailbox-admin')) x(g, t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/mailbox/state', 'mailbox-privacy', 'VIEW'), ('GET', '/admin/mailbox/state', 'mailbox-help', 'VIEW'), ('GET', '/admin/mailbox/state', 'mailbox-admin', 'VIEW'),
  ('GET', '/admin/mailbox/messages', 'mailbox-privacy', 'VIEW'), ('GET', '/admin/mailbox/messages', 'mailbox-help', 'VIEW'), ('GET', '/admin/mailbox/messages', 'mailbox-admin', 'VIEW'),
  ('GET', '/admin/mailbox/messages/{id}', 'mailbox-privacy', 'VIEW'), ('GET', '/admin/mailbox/messages/{id}', 'mailbox-help', 'VIEW'), ('GET', '/admin/mailbox/messages/{id}', 'mailbox-admin', 'VIEW'),
  ('POST', '/admin/mailbox/messages/{id}/assign', 'mailbox-privacy', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/assign', 'mailbox-help', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/assign', 'mailbox-admin', 'EDIT'),
  ('POST', '/admin/mailbox/messages/{id}/state', 'mailbox-privacy', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/state', 'mailbox-help', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/state', 'mailbox-admin', 'EDIT'),
  ('POST', '/admin/mailbox/messages/{id}/reply', 'mailbox-privacy', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/reply', 'mailbox-help', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/reply', 'mailbox-admin', 'EDIT'),
  ('POST', '/admin/mailbox/messages/{id}/fetch', 'mailbox-privacy', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/fetch', 'mailbox-help', 'EDIT'), ('POST', '/admin/mailbox/messages/{id}/fetch', 'mailbox-admin', 'EDIT'),
  ('GET', '/admin/mailbox/attachments/{id}', 'mailbox-privacy', 'VIEW'), ('GET', '/admin/mailbox/attachments/{id}', 'mailbox-help', 'VIEW'), ('GET', '/admin/mailbox/attachments/{id}', 'mailbox-admin', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- hdx_ · v10.791 (docs/906) 운영 화면 「?」 도움말에 새 탭 「공용 메일함 [mailbox]」 절 — D305 · D321 과 같은 방식(지금 판 끝에 붙인 새 판 · 쌓기만 · 4만 자 안 · 이미 있으면 건너뜀) · 탭 → 절 잇기
WITH add_rows(ord, grp, tab_key, heading, body) AS (VALUES
  (1, '18. 회원 — 공용 메일함(v10.789 ~ 791)', 'mailbox', '공용 메일함 [mailbox]', $hdx$- privacy@ · help@ · admin@ · dmarc@sogaebank.com 으로 온 메일을 읽고 · 맡고 · 답하고 · 끝냅니다(SES 받기 · 스위치 mail.inbound 처음 off).
- 메일함마다 업무 권한(공용 메일함 · 개인정보 문의 / 고객센터 / 운영 · DMARC)이 있는 것만 보이고, 열면 열람 기록이 남습니다. 받은 HTML 은 격리된 틀에서만 보이고 바깥 그림은 「그림 보기」를 눌러야 나옵니다.
- 보는 역할: ADMIN · SUPER(업무 권한이 있는 메일함만).$hdx$)
),
cur AS (
  SELECT version, title, body FROM public.v_help_doc_current WHERE code = 'ADMIN_GUIDE'
),
fit AS (
  SELECT a.* FROM add_rows a, cur c
   WHERE position('[' || a.tab_key || ']' IN c.body) = 0
     AND char_length(rtrim(c.body, E'\n')) + char_length(a.grp) + char_length(a.heading) + char_length(a.body) + 20 <= 40000
),
add_text AS (
  SELECT string_agg('## ' || grp || E'\n\n### ' || heading || E'\n' || body, E'\n\n' ORDER BY ord) AS t FROM fit
)
INSERT INTO public.help_docs (code, version, title, body, note)
SELECT 'ADMIN_GUIDE', (SELECT max(version) + 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE'), c.title,
       rtrim(c.body, E'\n') || E'\n\n' || a.t || E'\n', '공용 메일함 탭 설명 더함(v10.791 · docs/906)'
  FROM cur c, add_text a
 WHERE a.t IS NOT NULL;

INSERT INTO public.sec2_tab_help (tab_key, doc_code, heading)
SELECT DISTINCT ON (x.k) x.k, 'ADMIN_GUIDE', x.h
  FROM (
    SELECT l.n, (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[1] AS h,
                (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[2] AS k
      FROM public.v_help_doc_current c,
           LATERAL regexp_split_to_table(c.body, E'\n') WITH ORDINALITY AS l(line, n)
     WHERE c.code = 'ADMIN_GUIDE'
  ) x
 WHERE x.k = 'mailbox' AND char_length(x.h) <= 120
 ORDER BY x.k, x.n
ON CONFLICT (tab_key) DO NOTHING;
