/* ── v10.609 (docs/751) ㉕ 파트너 계약 갱신 알림 · 재서명 — 18차 bzx_ ──────────────────────────
 *   bzx_partner_contracts — 안심소개 파트너(partners)와 맺은 계약 한 줄 · 갱신은 새 줄(prev_id)로 다시 서명
 *     종이 계약(PAPER)은 적기만(이미 서명) · 간주(ASSUME) · STUB · MOCK · HTTP 는 본문 + SHA-256 지문 고정(서명 뒤 못 고침)
 *     상태: SENT(서명 기다림) → SIGNED → EXPIRED(갱신 없이 만기 지남) · ENDED(갱신 계약으로 넘어감) / SENT → CANCELED
 *   회원 알림 종류 BZX_PARTNER_CONTRACT(파트너 대표 · 끌 수 없음 — 계약 이행 안내)
 *   설정 bzx.partner_esign(off) · bzx.partner_notice(off) · 정기 작업 bzx_daily(매일 09:35)
 *   ㉕ 권한(D258) 시드 — 탭 bzx-ptn-contract(파트너사 admptn) · R_ADMIN 넷 · R_PARTNER_MAL 보기
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_partner_contracts (
  id                bigserial PRIMARY KEY,
  partner_id        uuid NOT NULL REFERENCES public.partners(id),
  prev_id           bigint REFERENCES public.bzx_partner_contracts(id),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 100),
  start_on          date NOT NULL,
  end_on            date NOT NULL,
  notice_days       integer NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 1 AND 180),
  auto_renew        boolean NOT NULL DEFAULT false,
  body              text CHECK (body IS NULL OR char_length(body) <= 30000),
  doc_hash          text CHECK (doc_hash IS NULL OR doc_hash ~ '^[0-9a-f]{64}$'),
  template_version  text CHECK (template_version IS NULL OR char_length(template_version) <= 20),
  state             text NOT NULL CHECK (state IN ('SENT', 'SIGNED', 'EXPIRED', 'ENDED', 'CANCELED')),
  sign_mode         text NOT NULL CHECK (sign_mode IN ('PAPER', 'ASSUME', 'STUB', 'MOCK', 'HTTP')),
  vendor_doc_id     text CHECK (vendor_doc_id IS NULL OR char_length(vendor_doc_id) <= 200),
  sign_url          text CHECK (sign_url IS NULL OR char_length(sign_url) <= 1000),
  sent_at           timestamptz,
  sent_by           uuid REFERENCES public.accounts(id),
  signed_at         timestamptz,
  signer_name       text CHECK (signer_name IS NULL OR char_length(signer_name) <= 60),
  sign_evidence     jsonb,
  cancel_reason     text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  created_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bzx_pc_period CHECK (end_on > start_on),
  CONSTRAINT ck_bzx_pc_body CHECK (sign_mode = 'PAPER' OR (body IS NOT NULL AND doc_hash IS NOT NULL)),
  CONSTRAINT ck_bzx_pc_signed CHECK (state NOT IN ('SIGNED', 'EXPIRED', 'ENDED') OR signed_at IS NOT NULL),
  CONSTRAINT ck_bzx_pc_paper CHECK (sign_mode <> 'PAPER' OR (state <> 'SENT' AND prev_id IS NULL)),
  CONSTRAINT ck_bzx_pc_cancel CHECK (state <> 'CANCELED' OR char_length(coalesce(cancel_reason, '')) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_bzx_pc_partner ON public.bzx_partner_contracts (partner_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_bzx_pc_due ON public.bzx_partner_contracts (state, end_on);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bzx_pc_one_renewal ON public.bzx_partner_contracts (prev_id) WHERE prev_id IS NOT NULL AND state IN ('SENT', 'SIGNED');
COMMENT ON TABLE public.bzx_partner_contracts IS
  'v10.609 (docs/751) 파트너 계약 — 만기 notice_days 일 전부터 운영 알림 BZX_PARTNER_RENEW · 갱신은 새 줄(prev_id)로 다시 서명 · 본문 · 지문은 서명 뒤 못 고침 · 지우지 않음';

/* 바꿀 수 있는 것: 상태(정한 길로만) · 서명 칸 · 업체 문서 번호(보낸 동안) — 나머지는 넣은 뒤 그대로 · 지우기 막음 */
CREATE OR REPLACE FUNCTION public.fn_bzx_pc_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BZX_PC: 파트너 계약 줄은 지우지 않습니다(취소 · 만기로 남김).'; END IF;
  IF (NEW.partner_id, NEW.prev_id, NEW.title, NEW.start_on, NEW.end_on, NEW.notice_days, NEW.auto_renew, NEW.body, NEW.doc_hash, NEW.sign_mode, NEW.created_at)
     IS DISTINCT FROM (OLD.partner_id, OLD.prev_id, OLD.title, OLD.start_on, OLD.end_on, OLD.notice_days, OLD.auto_renew, OLD.body, OLD.doc_hash, OLD.sign_mode, OLD.created_at) THEN
    RAISE EXCEPTION 'BZX_PC: 계약 내용은 고치지 않습니다 — 새 계약(갱신)으로 보내십시오.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'SENT' AND NEW.state IN ('SIGNED', 'CANCELED'))
    OR (OLD.state = 'SIGNED' AND NEW.state IN ('EXPIRED', 'ENDED'))) THEN
    RAISE EXCEPTION 'BZX_PC_STATE: 계약 상태를 그렇게 바꿀 수 없습니다.';
  END IF;
  IF OLD.state <> 'SENT' AND (NEW.signed_at, NEW.signer_name, NEW.sign_evidence, NEW.vendor_doc_id, NEW.sign_url)
       IS DISTINCT FROM (OLD.signed_at, OLD.signer_name, OLD.sign_evidence, OLD.vendor_doc_id, OLD.sign_url) THEN
    RAISE EXCEPTION 'BZX_PC: 서명이 끝난 계약의 서명 기록은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_pc_guard' AND tgrelid = 'public.bzx_partner_contracts'::regclass) THEN
    CREATE TRIGGER trg_bzx_pc_guard BEFORE UPDATE OR DELETE ON public.bzx_partner_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_pc_guard();
  END IF;
END $$;

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('BZX_PARTNER_CONTRACT', '파트너 계약 만기 · 서명 요청', false, false, '파트너 계약 이행 안내 — 만기 전 알림 · 갱신 계약 서명 요청(v10.609 · bzx.partner_notice on 일 때만)', 'info')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('bzx.partner_esign', 'off', 'ADMIN', '파트너 계약 서명 길(v10.609) — 처음 off = 간주 서명(파트너 대표가 파트너센터 › 계약에서 이름을 적음 · 법적 전자서명 아님) · on = 전자계약 방식(esign.provider · HTTP 는 ESIGN 키 필요) · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('bzx.partner_notice', 'off', 'ADMIN', '파트너에게 계약 만기 · 서명 요청 회원 알림(v10.609) — 처음 off(운영 알림은 늘) · 켜기 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('bzx_daily', 1440, 9, 35, NULL, true, '18차 하루 작업 — 매일 09:35 · 파트너 계약 만기 알림(BZX_PARTNER_RENEW) · 만기 지남 정리(EXPIRED · ENDED · BZX_PARTNER_EXPIRED) · 14일 넘게 서명 없음(BZX_PARTNER_UNSIGNED) · v10.609')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 탭 bzx-ptn-contract · TAB_ROLES ADMIN · SUPER · PARTNER_MAL(보기) → R_ADMIN 넷 · R_PARTNER_MAL VIEW
 *   주소 규칙: GET = VIEW · 그 밖 변경 = EDIT · 스위치(PUT /admin/bzx/switch)는 SUPER 만이라 연결하지 않아도 됨 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bzx-ptn-contract', '파트너 계약 갱신', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3610)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'bzx-ptn-contract', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PARTNER_MAL', 'bzx-ptn-contract', 'VIEW' WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PARTNER_MAL')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/switches', 'bzx-ptn-contract', 'VIEW'),
  ('GET', '/admin/bzx/partner-contracts', 'bzx-ptn-contract', 'VIEW'),
  ('GET', '/admin/bzx/partner-contracts/{id}', 'bzx-ptn-contract', 'VIEW'),
  ('POST', '/admin/bzx/partner-contracts', 'bzx-ptn-contract', 'EDIT'),
  ('POST', '/admin/bzx/partner-contracts/{id}/check', 'bzx-ptn-contract', 'EDIT'),
  ('POST', '/admin/bzx/partner-contracts/{id}/cancel', 'bzx-ptn-contract', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* ── v10.610 (docs/752) ㉖ 광고 예산 소진 알림 · 자동 정지 — 18차 bzx_ ──────────────────────────
 *   bzx_ad_budgets — 광고 소재(ad_placements)마다 예산 한 줄 · 노출(IMPRESSION) 또는 클릭(CLICK) 상한 · 기간 전체(TOTAL) · 하루(DAY)
 *     셈은 기존 ad_events 만 읽음(새 추적 없음) · state ON · PAUSED_BY_BUDGET(우리가 멈춤) · OFF
 *   bzx_ad_budget_events — 넣음 · 기준 넘음 · 다 씀 · 멈춤 · 다시 노출 · 다시 채움 · 끔 (쌓기만)
 *   설정 bzx.ad_autopause(off) · 정기 작업 bzx_frequent(10분마다 · ㉙ 카드 알림과 같이)
 *   ㉕ 권한(D258) 시드 — 탭 bzx-ad-budget(광고 admad) · R_ADMIN 넷
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_ad_budgets (
  id               bigserial PRIMARY KEY,
  creative_id      uuid NOT NULL UNIQUE REFERENCES public.ad_placements(id),
  cap_kind         text NOT NULL CHECK (cap_kind IN ('IMPRESSION', 'CLICK')),
  cap_value        integer NOT NULL CHECK (cap_value BETWEEN 1 AND 1000000000),
  period           text NOT NULL DEFAULT 'TOTAL' CHECK (period IN ('TOTAL', 'DAY')),
  counted_from     timestamptz NOT NULL DEFAULT now(),
  alert_pct        integer NOT NULL DEFAULT 80 CHECK (alert_pct BETWEEN 50 AND 99),
  auto_pause       boolean NOT NULL DEFAULT false,
  state            text NOT NULL DEFAULT 'ON' CHECK (state IN ('ON', 'PAUSED_BY_BUDGET', 'OFF')),
  window_key       text CHECK (window_key IS NULL OR window_key ~ '^(TOTAL|\d{4}-\d{2}-\d{2})$'),
  near_at          timestamptz,
  spent_at         timestamptz,
  paused_at        timestamptz,
  last_used        integer NOT NULL DEFAULT 0 CHECK (last_used >= 0),
  last_checked_at  timestamptz,
  note             text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bzx_ad_paused CHECK (state <> 'PAUSED_BY_BUDGET' OR paused_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_bzx_ad_budgets_state ON public.bzx_ad_budgets (state);
COMMENT ON TABLE public.bzx_ad_budgets IS
  'v10.610 (docs/752) 광고 소재 예산 — 노출 · 클릭 상한(기간 전체 · 하루) · 알림 기준 % · 자동 정지(bzx.ad_autopause on 일 때만) · 셈은 ad_events 를 읽기만';

CREATE TABLE IF NOT EXISTS public.bzx_ad_budget_events (
  id          bigserial PRIMARY KEY,
  budget_id   bigint NOT NULL REFERENCES public.bzx_ad_budgets(id),
  kind        text NOT NULL CHECK (kind IN ('SET', 'NEAR', 'SPENT', 'PAUSED', 'RESUMED', 'RESET', 'OFF')),
  used        integer CHECK (used IS NULL OR used >= 0),
  cap         integer CHECK (cap IS NULL OR cap > 0),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bzx_ad_budget_events ON public.bzx_ad_budget_events (budget_id, id DESC);
COMMENT ON TABLE public.bzx_ad_budget_events IS 'v10.610 (docs/752) 광고 예산 기록 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_ad_budget_events_ro' AND tgrelid = 'public.bzx_ad_budget_events'::regclass) THEN
    CREATE TRIGGER trg_bzx_ad_budget_events_ro BEFORE UPDATE OR DELETE ON public.bzx_ad_budget_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('bzx.ad_autopause', 'off', 'ADMIN', '광고 예산을 다 쓰면 소재 자동 정지(v10.610) — 처음 off(알림만) · on 이면 예산 줄에 「자동 정지」를 고른 소재만 PAUSED · 하루 예산은 다음 날 다시 노출 · 켜기 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('bzx_frequent', 10, NULL, NULL, NULL, true, '18차 10분 작업 — 광고 예산 알림 · 자동 정지(BZX_AD_BUDGET · bzx.ad_autopause) · 법인카드 사용 알림(BZX_CARD_USE · bzx.card_notify) · v10.610 · 613')
ON CONFLICT (job) DO NOTHING;

INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bzx-ad-budget', '광고 예산', 'admad', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3620)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'bzx-ad-budget', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/switches', 'bzx-ad-budget', 'VIEW'),
  ('GET', '/admin/bzx/ad-budgets', 'bzx-ad-budget', 'VIEW'),
  ('POST', '/admin/bzx/ad-budgets/run', 'bzx-ad-budget', 'APPROVE'),
  ('PUT', '/admin/bzx/ad-budgets/{creativeId}', 'bzx-ad-budget', 'EDIT'),
  ('POST', '/admin/bzx/ad-budgets/{id}/reset', 'bzx-ad-budget', 'EDIT'),
  ('POST', '/admin/bzx/ad-budgets/{id}/off', 'bzx-ad-budget', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* ── v10.611 (docs/753) ㉗ 1:1 문의 사진 첨부 — 18차 bzx_ ──────────────────────────
 *   bzx_inquiry_files — 접수 뒤 더한 사진(MEMBER · 문의한 회원) · 답변 사진(STAFF · 운영) · 문의마다 쪽마다 6장
 *     파일은 기존 파일 용도 INQUIRY_ATTACHMENT(D049 · JPG · PNG · PDF 10MB) 중 그림(JPG · PNG)만 · 올린 사람 = 붙인 사람 · READY
 *     접수 때 첨부(inquiries.attachment_keys · 3개)는 그대로 · 새 파일 용도 없음(ck_files_purpose · fn_file_can_read 안 고침)
 *     문의가 지워지면(개인정보 파기) 같이 지워짐 · 그 밖 고치기 막음
 *   설정 bzx.inquiry_photos(off) · 권한: 운영 주소는 기존 업무 inquiries(1:1 문의)에 연결
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_inquiry_files (
  id           bigserial PRIMARY KEY,
  inquiry_id   uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES public.files(id),
  side         text NOT NULL CHECK (side IN ('MEMBER', 'STAFF')),
  added_by     uuid NOT NULL REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bzx_inquiry_files UNIQUE (inquiry_id, file_id)
);
CREATE INDEX IF NOT EXISTS ix_bzx_inquiry_files ON public.bzx_inquiry_files (inquiry_id, side);
COMMENT ON TABLE public.bzx_inquiry_files IS
  'v10.611 (docs/753) 1:1 문의에 더한 사진(MEMBER) · 답변 사진(STAFF) — INQUIRY_ATTACHMENT 그림 · 쪽마다 6장 · 회원은 GET /me/bzx/inquiries/{id}/photos/{fileId} 로 봄';

CREATE OR REPLACE FUNCTION public.fn_bzx_inquiry_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_n integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'BZX_INQ_PHOTO: 붙인 사진 줄은 고치지 않습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = NEW.file_id AND f.purpose = 'INQUIRY_ATTACHMENT' AND f.status = 'READY'
                   AND f.owner_account_id = NEW.added_by AND f.content_type IN ('image/jpeg', 'image/png')) THEN
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 붙인 사람이 올린 문의 첨부 그림(JPG · PNG · READY)만 붙입니다.';
  END IF;
  SELECT account_id INTO v_owner FROM public.inquiries WHERE id = NEW.inquiry_id;
  IF NEW.side = 'MEMBER' AND v_owner IS DISTINCT FROM NEW.added_by THEN
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 문의한 회원만 사진을 더 붙입니다.';
  END IF;
  IF NEW.side = 'STAFF' AND NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.added_by AND r.role IN ('ADMIN', 'SUPER')) THEN
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 답변 사진은 운영(ADMIN · SUPER)만 붙입니다.';
  END IF;
  SELECT count(*) INTO v_n FROM public.bzx_inquiry_files WHERE inquiry_id = NEW.inquiry_id AND side = NEW.side;
  IF v_n >= 6 THEN RAISE EXCEPTION 'BZX_INQ_PHOTO_FULL: 사진은 문의마다 6장까지입니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_inquiry_file_guard' AND tgrelid = 'public.bzx_inquiry_files'::regclass) THEN
    CREATE TRIGGER trg_bzx_inquiry_file_guard BEFORE INSERT OR UPDATE ON public.bzx_inquiry_files FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_inquiry_file_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('bzx.inquiry_photos', 'off', 'ADMIN', '1:1 문의 사진 더 붙이기 · 답변 사진(v10.611) — 처음 off(접수 때 첨부 3개는 늘 됨 · 운영 미리 보기는 늘) · 켜기 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/inquiries/{id}/photos', 'inquiries', 'VIEW'),
  ('POST', '/admin/bzx/inquiries/{id}/photos', 'inquiries', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* ── v10.612 (docs/754) ㉘ 상담원별 답변 품질 — 18차 bzx_ ──────────────────────────
 *   지표는 새 표 없이 기존 inquiries · 감사 기록 INQUIRY_ANSWER 를 셈(v10.337 처리 지표와 같은 근거)
 *   bzx_answer_reviews — 표본 점검(다른 운영자가 정확 · 친절 · 충분 1 ~ 5점 + 메모) · 자기 답 점검 막음 · 같은 사람 같은 문의 한 번 · 고치기 막음
 *     문의가 지워지면(개인정보 파기) 같이 지워짐
 *   ㉕ 권한(D258) 시드 — 탭 bzx-cs-quality(회원 admusr) · R_ADMIN 넷
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_answer_reviews (
  id            bigserial PRIMARY KEY,
  inquiry_id    uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES public.accounts(id),
  reviewer_id   uuid NOT NULL REFERENCES public.accounts(id),
  accuracy      smallint NOT NULL CHECK (accuracy BETWEEN 1 AND 5),
  kindness      smallint NOT NULL CHECK (kindness BETWEEN 1 AND 5),
  completeness  smallint NOT NULL CHECK (completeness BETWEEN 1 AND 5),
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bzx_answer_reviews UNIQUE (inquiry_id, reviewer_id),
  CONSTRAINT ck_bzx_answer_reviews_self CHECK (agent_id <> reviewer_id)
);
CREATE INDEX IF NOT EXISTS ix_bzx_answer_reviews_agent ON public.bzx_answer_reviews (agent_id, created_at);
COMMENT ON TABLE public.bzx_answer_reviews IS 'v10.612 (docs/754) 1:1 문의 답변 표본 점검 — 상담원(처음 답한 운영자) · 점검한 운영자 · 세 점수 · 메모 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_bzx_answer_review_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BZX_CSQ: 남긴 점검은 고치지 않습니다.';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_answer_review_ro' AND tgrelid = 'public.bzx_answer_reviews'::regclass) THEN
    CREATE TRIGGER trg_bzx_answer_review_ro BEFORE UPDATE ON public.bzx_answer_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_answer_review_ro();
  END IF;
END $$;

INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bzx-cs-quality', '답변 품질', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3630)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'bzx-cs-quality', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/switches', 'bzx-cs-quality', 'VIEW'),
  ('GET', '/admin/bzx/cs-quality', 'bzx-cs-quality', 'VIEW'),
  ('GET', '/admin/bzx/cs-quality/samples', 'bzx-cs-quality', 'VIEW'),
  ('POST', '/admin/bzx/cs-quality/reviews', 'bzx-cs-quality', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* ── v10.613 (docs/755) ㉙ 법인카드 사용 즉시 알림 — 18차 bzx_ ──────────────────────────
 *   bzx_card_notices — 카드 이용 줄(acct_card_txns)이 들어오는 순간 트리거가 대기 한 줄(같은 줄은 한 번)
 *     정기 작업 bzx_frequent(10분마다)가 bzx.card_notify on 일 때 쓰는 사람(D261 acct_card_limits.holder_id)에게 회원 알림 BZX_CARD_USE ·
 *     규칙(큰 금액 · 주말 · 공휴일 · 한도 없는 카드 · 한도 넘김)에 걸린 줄은 운영 알림 BZX_CARD_USE · 꺼진 동안 쌓인 줄은 사흘 뒤 SKIPPED
 *     카드 끝 4자리 · 날짜 · 가맹점 · 금액만(승인번호 · 카드 번호 전체 없음)
 *   트리거는 카드 CSV 올리기를 절대 막지 않음(실패하면 WARNING 만)
 *   설정 bzx.card_notify(off) · bzx.card_big_amount(500000 · 10,000 ~ 100,000,000 · 서버 검사와 같은 범위)
 *   ㉕ 권한(D258) 시드 — 탭 bzx-card-notice(회계 admacc) · R_PAYOUT 넷(카드 한도 탭과 같음 · 세무사 · 운영 관리자 안 넣음)
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_card_notices (
  id          bigserial PRIMARY KEY,
  txn_id      bigint NOT NULL UNIQUE REFERENCES public.acct_card_txns(id),
  card_tail   text CHECK (card_tail IS NULL OR card_tail ~ '^[0-9*]{1,4}$'),
  used_on     date NOT NULL,
  merchant    text CHECK (merchant IS NULL OR char_length(merchant) <= 120),
  amount      bigint NOT NULL,
  holder_id   uuid REFERENCES public.accounts(id),
  rules       text[] NOT NULL DEFAULT '{}',
  state       text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'SENT', 'SKIPPED')),
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bzx_card_rules CHECK (rules <@ ARRAY['BIG', 'HOLIDAY', 'NO_LIMIT', 'NEAR', 'OVER', 'CANCEL']::text[]),
  CONSTRAINT ck_bzx_card_sent CHECK (state <> 'SENT' OR sent_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_bzx_card_notices_pending ON public.bzx_card_notices (state, id) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_bzx_card_notices_day ON public.bzx_card_notices (used_on, id);
COMMENT ON TABLE public.bzx_card_notices IS
  'v10.613 (docs/755) 법인카드 사용 알림 대기 · 보낸 기록 — 카드 이용 줄마다 한 번 · 쓰는 사람 회원 알림 BZX_CARD_USE · 규칙에 걸리면 운영 알림 · 끝 4자리만';

CREATE OR REPLACE FUNCTION public.fn_bzx_card_txn_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.bzx_card_notices (txn_id, card_tail, used_on, merchant, amount, holder_id)
    VALUES (NEW.id, NEW.card_tail, NEW.used_on, NEW.merchant, NEW.amount,
            (SELECT l.holder_id FROM public.acct_card_limits l WHERE l.card_tail = NEW.card_tail AND l.active))
    ON CONFLICT (txn_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'BZX_CARD_NOTICE: 알림 대기에 넣지 못함(카드 줄은 그대로)';
  END;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_card_txn_notice' AND tgrelid = 'public.acct_card_txns'::regclass) THEN
    CREATE TRIGGER trg_bzx_card_txn_notice AFTER INSERT ON public.acct_card_txns FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_card_txn_notice();
  END IF;
END $$;

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('BZX_CARD_USE', '법인카드 사용 알림', true, false, '회사 법인카드를 쓰는 사람에게 사용 · 취소 한 건마다(v10.613 · bzx.card_notify on 일 때만)', 'info')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('bzx.card_notify', 'off', 'ADMIN', '법인카드 사용 즉시 알림(v10.613) — 처음 off · on 이면 카드 이용 줄이 들어오고 10분 안에 쓰는 사람(카드 한도에 정한 사람)에게 알림 · 규칙에 걸린 줄은 운영 알림 · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('bzx.card_big_amount', '500000', 'ADMIN', '법인카드 한 건 이 금액 이상이면 운영 알림(v10.613 · 원 · 10,000 ~ 100,000,000 · 처음 500,000) · 바꾸기 SUPER', false, '^([1-9][0-9]{4,7}|100000000)$', '500000')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('bzx_frequent', 10, NULL, NULL, NULL, true, '18차 10분 작업 — 광고 예산 알림 · 자동 정지(BZX_AD_BUDGET · bzx.ad_autopause) · 법인카드 사용 알림(BZX_CARD_USE · bzx.card_notify) · v10.610 · 613')
ON CONFLICT (job) DO NOTHING;

INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bzx-card-notice', '카드 사용 알림', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3640)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', 'bzx-card-notice', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PAYOUT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/switches', 'bzx-card-notice', 'VIEW'),
  ('GET', '/admin/bzx/card-notices', 'bzx-card-notice', 'VIEW'),
  ('POST', '/admin/bzx/card-notices/run', 'bzx-card-notice', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* ── v10.614 (docs/756) ㉚ 인건비 시뮬레이션 — 18차 bzx_ ──────────────────────────
 *   bzx_hc_plans — 채용 계획(이름 · 시작 달 · 기간 1 ~ 36개월 · 해마다 인상률 · 지금 직원 포함 · 채용 줄 30개까지)
 *     셈은 서버가 그때그때(급여 요율표 acct_payroll_rates · 일반 원칙 값 docs/555) — 결과는 저장하지 않음(요율이 바뀌면 다시 셈)
 *     실제 급여 · 장부에는 아무것도 쓰지 않음 · 보관(ARCHIVED)은 목록에서만 빠짐 · 지우지 않음
 *   ㉕ 권한(D258) 시드 — 탭 bzx-hc-sim(회계 admacc · 인사) · R_PAYOUT 넷(급여 탭과 같음 · 세무사 안 넣음)
 *   다시 돌려도 같음 */
CREATE TABLE IF NOT EXISTS public.bzx_hc_plans (
  id               bigserial PRIMARY KEY,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  start_ym         text NOT NULL CHECK (start_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  months           integer NOT NULL CHECK (months BETWEEN 1 AND 36),
  raise_pct        numeric(5,2) NOT NULL DEFAULT 0 CHECK (raise_pct BETWEEN 0 AND 30),
  include_current  boolean NOT NULL DEFAULT true,
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) <= 30),
  state            text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  created_by       uuid REFERENCES public.accounts(id),
  updated_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bzx_hc_plans_state ON public.bzx_hc_plans (state, updated_at DESC);
COMMENT ON TABLE public.bzx_hc_plans IS
  'v10.614 (docs/756) 인건비 계획 — 채용 줄(자리 · 인원 · 월 기본급 · 비과세 · 입사 · 퇴사 달) · 셈은 급여 요율표로 그때그때 · 합계만 · 실제 급여 · 장부와 무관';

CREATE OR REPLACE FUNCTION public.fn_bzx_hc_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BZX_HC: 인건비 계획은 지우지 않습니다(보관).'; END IF;
  IF OLD.state = 'ARCHIVED' THEN RAISE EXCEPTION 'BZX_HC_STATE: 보관한 계획은 고치지 않습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bzx_hc_plan_guard' AND tgrelid = 'public.bzx_hc_plans'::regclass) THEN
    CREATE TRIGGER trg_bzx_hc_plan_guard BEFORE UPDATE OR DELETE ON public.bzx_hc_plans FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_hc_plan_guard();
  END IF;
END $$;

INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bzx-hc-sim', '인건비 시뮬레이션', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3650)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', 'bzx-hc-sim', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PAYOUT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bzx/hc-plans', 'bzx-hc-sim', 'VIEW'),
  ('GET', '/admin/bzx/hc-plans/{id}', 'bzx-hc-sim', 'VIEW'),
  ('POST', '/admin/bzx/hc-sim', 'bzx-hc-sim', 'VIEW'),
  ('POST', '/admin/bzx/hc-plans', 'bzx-hc-sim', 'EDIT'),
  ('PUT', '/admin/bzx/hc-plans/{id}', 'bzx-hc-sim', 'EDIT'),
  ('POST', '/admin/bzx/hc-plans/{id}/archive', 'bzx-hc-sim', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
