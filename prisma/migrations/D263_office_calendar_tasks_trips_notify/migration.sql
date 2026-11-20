/* D263 (v10.462 ~ 465 · docs/600 ~ 603) ㉜ 사무 2 — 사내 일정 캘린더 · 업무 요청 · 할 일 보드 · 출장 신청 → 여비 정산 · 브라우저 알림 */

/* ── ① 사내 일정 캘린더 (v10.462 · docs/600) ─────────────────────────────────────────
 *   직접 넣는 일정만 표 하나(ofc_events) — 개인(PERSONAL · 본인만 봄) · 회사(COMPANY · 운영자 모두 봄 · 넣기 · 고치기 ADMIN · SUPER)
 *   휴가 · 결재 기한(품의 쓸 날) · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한은 지금 있는 표에서 읽어 모음(사본 없음 · 표 없음)
 *   지우기 = removed_at 표시(지우는 문장은 DB 가 막음) · 지운 일정은 고치지 않음 */
CREATE TABLE IF NOT EXISTS public.ofc_events (
  id          bigserial PRIMARY KEY,
  scope       text NOT NULL CHECK (scope IN ('PERSONAL', 'COMPANY')),
  owner_id    uuid NOT NULL REFERENCES public.accounts(id),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  start_on    date NOT NULL,
  end_on      date NOT NULL,
  at_time     text CHECK (at_time IS NULL OR at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 400),
  removed_at  timestamptz,
  removed_by  uuid REFERENCES public.accounts(id),
  updated_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ofe_range CHECK (end_on >= start_on AND end_on - start_on <= 92),
  CONSTRAINT ck_ofe_removed CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_ofe_range ON public.ofc_events (start_on, end_on) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ofe_owner ON public.ofc_events (owner_id, start_on);
COMMENT ON TABLE public.ofc_events IS 'v10.462 (D263) 사내 일정 — 직접 넣은 일정만(개인 · 회사) · 나머지 일정은 지금 있는 표에서 읽어 모음 · 지우기는 removed_at';

CREATE OR REPLACE FUNCTION public.fn_ofc_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_EVENT: 일정은 지우지 않습니다(지움 표시만).'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'OFC_EVENT_REMOVED: 지운 일정은 고치지 않습니다.'; END IF;
  IF (NEW.scope, NEW.owner_id, NEW.created_at) IS DISTINCT FROM (OLD.scope, OLD.owner_id, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_EVENT: 일정 종류 · 넣은 사람은 바꾸지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_event_guard' AND tgrelid = 'public.ofc_events'::regclass) THEN
    CREATE TRIGGER trg_ofc_event_guard BEFORE UPDATE OR DELETE ON public.ofc_events FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_event_guard();
  END IF;
END $$;


/* ── ② 업무 요청 · 할 일 보드 (v10.463 · docs/601) ─────────────────────────────────────
 *   요청(REQUESTED) → 진행(DOING) → 완료(DONE) · 취소(CANCELED) — 칸반 세 칸
 *   보기: 요청한 사람 · 담당자(SUPER 는 모두) · 담당자가 진행 · 완료 · 요청한 사람이 담당 바꾸기 · 취소 · 다시 열기(완료 → 진행)
 *   댓글 · 상태 바뀜 기록(ofc_task_comments · 쌓기만) · 기한(due_on) — 기한 지난 업무 수를 매일 09:10 운영 알림 OFC_TASK_OVERDUE(제목은 넣지 않음)
 *   담당자 · 요청한 사람 개인 알림은 v10.465 브라우저 알림(나에게 온 업무 · 기한 임박 · 지남 · 끝남) */
CREATE TABLE IF NOT EXISTS public.ofc_tasks (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  body         text CHECK (body IS NULL OR char_length(body) <= 2000),
  requester    uuid NOT NULL REFERENCES public.accounts(id),
  assignee     uuid NOT NULL REFERENCES public.accounts(id),
  state        text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'DOING', 'DONE', 'CANCELED')),
  priority     text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH')),
  due_on       date,
  started_at   timestamptz,
  done_at      timestamptz,
  canceled_at  timestamptz,
  cancel_note  text CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_oft_done CHECK (state <> 'DONE' OR done_at IS NOT NULL),
  CONSTRAINT ck_oft_cancel CHECK (state <> 'CANCELED' OR (canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_oft_assignee ON public.ofc_tasks (assignee, state, due_on);
CREATE INDEX IF NOT EXISTS ix_oft_requester ON public.ofc_tasks (requester, state, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_oft_due ON public.ofc_tasks (due_on) WHERE state IN ('REQUESTED', 'DOING');
COMMENT ON TABLE public.ofc_tasks IS 'v10.463 (D263) 업무 요청 · 할 일 — 요청 → 진행 → 완료 · 취소 · 제목 · 내용 · 요청한 사람은 고치지 않음 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_ofc_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_TASK: 업무 요청은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.title, NEW.body, NEW.requester, NEW.created_at) IS DISTINCT FROM (OLD.title, OLD.body, OLD.requester, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_TASK: 제목 · 내용 · 요청한 사람은 고치지 않습니다(댓글로 덧붙이십시오).';
  END IF;
  IF OLD.state IN ('CANCELED') AND (NEW.state, NEW.assignee, NEW.due_on, NEW.priority) IS DISTINCT FROM (OLD.state, OLD.assignee, OLD.due_on, OLD.priority) THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 취소한 업무는 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'REQUESTED' AND NEW.state IN ('DOING', 'DONE', 'CANCELED'))
    OR (OLD.state = 'DOING' AND NEW.state IN ('REQUESTED', 'DONE', 'CANCELED'))
    OR (OLD.state = 'DONE' AND NEW.state = 'DOING')) THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  IF OLD.state = 'DONE' AND NEW.state = 'DONE' AND NEW.assignee IS DISTINCT FROM OLD.assignee THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 끝난 업무는 담당을 바꾸지 않습니다(다시 열고 바꾸십시오).';
  END IF;
  IF NEW.state <> 'DONE' THEN NEW.done_at := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_task_guard' AND tgrelid = 'public.ofc_tasks'::regclass) THEN
    CREATE TRIGGER trg_ofc_task_guard BEFORE UPDATE OR DELETE ON public.ofc_tasks FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_task_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ofc_task_comments (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES public.ofc_tasks(id),
  author      uuid REFERENCES public.accounts(id),
  kind        text NOT NULL DEFAULT 'COMMENT' CHECK (kind IN ('COMMENT', 'STATE', 'ASSIGN')),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oftc_task ON public.ofc_task_comments (task_id, id);
COMMENT ON TABLE public.ofc_task_comments IS 'v10.463 (D263) 업무 요청 댓글 · 상태 바뀜 · 담당 바뀜 기록 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_task_comments_ro' AND tgrelid = 'public.ofc_task_comments'::regclass) THEN
    CREATE TRIGGER trg_ofc_task_comments_ro BEFORE UPDATE OR DELETE ON public.ofc_task_comments FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ofc.task_due_alert', 'on', 'ADMIN', '업무 요청 기한 지남 운영 알림(v10.463 · D263) — on 이면 매일 09:10 기한 지난 업무 수를 OFC_TASK_OVERDUE 로(제목 없이 수만 · 하루 한 번 · 없으면 풀림)', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('ofc_task_due', 1440, 9, 10, NULL, true, '업무 요청 기한 지남 알림 — 매일 09:10 · 기한 지난 업무 수(ofc.task_due_alert on 일 때) · D263 · v10.463')
ON CONFLICT (job) DO NOTHING;


/* ── ③ 출장 신청 → 여비 정산 (v10.464 · docs/602) ───────────────────────────────────────
 *   출장 신청 = ⑯ 품의(acct_requisitions · 계정 EXP_TRAVEL 여비교통비) 하나를 함께 만듦 → 지금 결재선 · 결재함 · SUPER 결재 그대로
 *   예상 금액 = 일비 × 날수 + 식비 × 날수 + 숙박 상한(지역) × 박수 + 교통비 예상 — 일반 원칙 값(공무원 여비 규정 참고 · 확인 필요) · SUPER 가 고침
 *   다녀온 뒤 정산 = ⑫ 경비 청구(acct_expense_claims · requisition_id = 출장 품의) 하나를 만듦 → 경비 청구 승인 · 지급 · 전표 그대로
 *   두 번 청구 막기(DB): 정산 줄(ofc_trip_settlements) claim_id UNIQUE · 같은 출장에 살아 있는(REQUESTED · APPROVED · PAID) 청구가 있으면 새 정산 막음
 *   · 청구는 그 출장의 품의 · 출장 간 사람 것만 · 품의 금액(허용 비율 포함)을 넘으면 기존 가드(REQ_OVER)가 막음 */
CREATE TABLE IF NOT EXISTS public.ofc_trips (
  id              bigserial PRIMARY KEY,
  traveler        uuid NOT NULL REFERENCES public.accounts(id),
  destination     text NOT NULL CHECK (char_length(btrim(destination)) BETWEEN 2 AND 60),
  region          text NOT NULL CHECK (region IN ('SEOUL', 'METRO', 'OTHER')),
  purpose         text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 2 AND 300),
  depart_on       date NOT NULL,
  return_on       date NOT NULL,
  transport_est   bigint NOT NULL DEFAULT 0 CHECK (transport_est BETWEEN 0 AND 10000000),
  estimate        bigint NOT NULL CHECK (estimate BETWEEN 1 AND 100000000),
  basis           jsonb NOT NULL,
  requisition_id  bigint NOT NULL REFERENCES public.acct_requisitions(id),
  state           text NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'SETTLED', 'CANCELED')),
  claim_id        bigint REFERENCES public.acct_expense_claims(id),
  settled_at      timestamptz,
  canceled_at     timestamptz,
  cancel_note     text CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_otr_range CHECK (return_on >= depart_on AND return_on - depart_on <= 30),
  CONSTRAINT ck_otr_settled CHECK (state <> 'SETTLED' OR (claim_id IS NOT NULL AND settled_at IS NOT NULL)),
  CONSTRAINT ck_otr_cancel CHECK (state <> 'CANCELED' OR (canceled_at IS NOT NULL AND claim_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_otr_req ON public.ofc_trips (requisition_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_otr_claim ON public.ofc_trips (claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_otr_traveler ON public.ofc_trips (traveler, depart_on DESC);
CREATE INDEX IF NOT EXISTS ix_otr_range ON public.ofc_trips (depart_on, return_on) WHERE state <> 'CANCELED';
COMMENT ON TABLE public.ofc_trips IS 'v10.464 (D263) 출장 신청 — 품의(EXP_TRAVEL) 하나와 짝 · 다녀온 뒤 정산이 경비 청구 하나로 · 내용은 고치지 않음(취소하고 새로) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_ofc_trip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_TRIP: 출장 신청은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.traveler, NEW.destination, NEW.region, NEW.purpose, NEW.depart_on, NEW.return_on, NEW.transport_est, NEW.estimate, NEW.basis, NEW.requisition_id, NEW.created_at)
     IS DISTINCT FROM (OLD.traveler, OLD.destination, OLD.region, OLD.purpose, OLD.depart_on, OLD.return_on, OLD.transport_est, OLD.estimate, OLD.basis, OLD.requisition_id, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_TRIP: 출장 내용은 고치지 않습니다(취소하고 새로 신청하십시오).';
  END IF;
  IF OLD.state = 'CANCELED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 취소한 출장은 바꾸지 않습니다.'; END IF;
  IF OLD.state = 'SETTLED' AND NEW.state <> 'SETTLED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 정산한 출장은 취소하지 않습니다.'; END IF;
  IF NEW.claim_id IS DISTINCT FROM OLD.claim_id AND NOT EXISTS (SELECT 1 FROM public.ofc_trip_settlements s WHERE s.trip_id = NEW.id AND s.claim_id = NEW.claim_id) THEN
    RAISE EXCEPTION 'OFC_TRIP_CLAIM: 정산 줄이 없는 경비 청구는 붙이지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.ofc_trip_settlements (
  id          bigserial PRIMARY KEY,
  trip_id     bigint NOT NULL REFERENCES public.ofc_trips(id),
  claim_id    bigint NOT NULL REFERENCES public.acct_expense_claims(id),
  amount      bigint NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  detail      jsonb NOT NULL,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ots_claim ON public.ofc_trip_settlements (claim_id);
CREATE INDEX IF NOT EXISTS ix_ots_trip ON public.ofc_trip_settlements (trip_id, id);
COMMENT ON TABLE public.ofc_trip_settlements IS 'v10.464 (D263) 여비 정산 — 정산마다 경비 청구 하나(claim_id 고유) · 쌓기만 · 같은 출장에 살아 있는 청구가 있으면 새 정산 막음(두 번 청구 막기)';

CREATE OR REPLACE FUNCTION public.fn_ofc_trip_settle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record; c record;
BEGIN
  SELECT id, traveler, requisition_id, state INTO t FROM public.ofc_trips WHERE id = NEW.trip_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'OFC_TRIP: 없는 출장입니다.'; END IF;
  IF t.state = 'CANCELED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 취소한 출장은 정산하지 않습니다.'; END IF;
  SELECT id, claimant, requisition_id, state INTO c FROM public.acct_expense_claims WHERE id = NEW.claim_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'OFC_TRIP_CLAIM: 없는 경비 청구입니다.'; END IF;
  IF c.claimant <> t.traveler OR c.requisition_id IS DISTINCT FROM t.requisition_id THEN
    RAISE EXCEPTION 'OFC_TRIP_CLAIM: 출장 간 사람 · 출장 품의의 경비 청구만 정산에 붙입니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofc_trip_settlements s JOIN public.acct_expense_claims x ON x.id = s.claim_id
              WHERE s.trip_id = NEW.trip_id AND x.state IN ('REQUESTED', 'APPROVED', 'PAID')) THEN
    RAISE EXCEPTION 'OFC_TRIP_DOUBLE: 이 출장은 이미 여비를 청구했습니다(반려 · 취소된 뒤에만 다시 정산).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_trip_guard' AND tgrelid = 'public.ofc_trips'::regclass) THEN
    CREATE TRIGGER trg_ofc_trip_guard BEFORE UPDATE OR DELETE ON public.ofc_trips FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_trip_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_trip_settle_guard' AND tgrelid = 'public.ofc_trip_settlements'::regclass) THEN
    CREATE TRIGGER trg_ofc_trip_settle_guard BEFORE INSERT ON public.ofc_trip_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_trip_settle_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofc_trip_settlements_ro' AND tgrelid = 'public.ofc_trip_settlements'::regclass) THEN
    CREATE TRIGGER trg_ofc_trip_settlements_ro BEFORE UPDATE OR DELETE ON public.ofc_trip_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 여비 기준 — 일반 원칙 값(공무원 여비 규정 국내 여비 참고 · 실비변상 비과세 범위는 회사 여비 규정이 있어야 · 세무사 확인 필요) · SUPER 가 사무 › 출장 · 정책 › 전체 설정에서 고침 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ofc.trip_per_diem', '25000', 'ADMIN', '출장 일비(원 · 하루 · v10.464 · D263) — 일반 원칙 값 2만 5천 원(공무원 여비 규정 참고 · 확인 필요) · SUPER 가 고침', false, '^[0-9]{1,7}$', '25000'),
  ('ofc.trip_meal', '25000', 'ADMIN', '출장 식비(원 · 하루 · v10.464) — 일반 원칙 값 2만 5천 원(확인 필요) · SUPER 가 고침', false, '^[0-9]{1,7}$', '25000'),
  ('ofc.trip_lodging_caps', 'SEOUL:100000,METRO:80000,OTHER:70000', 'ADMIN', '출장 숙박 상한(원 · 1박 · 지역별 · v10.464) — 서울 10만 · 광역시 8만 · 그 밖 7만(일반 원칙 값 · 확인 필요) · 실제 숙박비가 적으면 실제 금액', false, '^SEOUL:[0-9]{1,7},METRO:[0-9]{1,7},OTHER:[0-9]{1,7}$', 'SEOUL:100000,METRO:80000,OTHER:70000')
ON CONFLICT (key) DO NOTHING;


/* ── ④ 브라우저 알림 (v10.465 · docs/603) ─────────────────────────────────────────────
 *   운영 화면을 열어 둔 동안만 브라우저 Notification API(서버 푸시 · 서비스 워커 · VAPID 키 없음)
 *   계정마다 켜고 끔(ofc_notify_prefs · 처음 꺼짐 · 사용자가 「켜기」를 누르고 브라우저가 허락할 때만) · 종류 OPS(급한 운영 알림) · APV(나에게 온 결재) · TASK(업무 요청)
 *   ofc.browser_notify 가 off 면 화면이 묻지 않음(전체 끄기) · ofc.notify_poll_sec 마다 「내 알림」 API 를 물음(처음 60초) */
CREATE TABLE IF NOT EXISTS public.ofc_notify_prefs (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id),
  enabled     boolean NOT NULL DEFAULT false,
  kinds       text[] NOT NULL DEFAULT ARRAY['OPS', 'APV', 'TASK']::text[] CHECK (kinds <@ ARRAY['OPS', 'APV', 'TASK']::text[]),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ofc_notify_prefs IS 'v10.465 (D263) 브라우저 알림 — 계정마다 켬 · 끔 · 종류(OPS · APV · TASK) · 없으면 꺼짐';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ofc.browser_notify', 'on', 'ADMIN', '운영 화면 브라우저 알림(v10.465 · D263) — off 면 모든 계정의 화면이 묻지 않음(서버 푸시 아님 · 화면을 열어 둔 동안만 · 계정마다 켜야 함)', false, '^(on|off)$', 'on'),
  ('ofc.notify_poll_sec', '60', 'ADMIN', '브라우저 알림 묻는 간격(초 · 30 ~ 300 · 처음 60 · v10.465)', false, '^([3-9][0-9]|[12][0-9]{2}|300)$', '60')
ON CONFLICT (key) DO NOTHING;


/* ── ⑤ ㉕ 권한(D258) 시드에 새 탭 4개 — gen_seed.py 와 같은 규칙(탭 역할 = 운영 역할 모두 · 세무사 빠짐)
 *   ofc-notify(내 브라우저 알림)는 본인 것만 보는 화면이라 주소 맵에 넣지 않음(my-hr 과 같음 · @Roles 만) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('ofc-calendar', '사내 일정', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2500),
  ('ofc-tasks', '업무 요청', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2510),
  ('ofc-trips', '출장', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2520),
  ('ofc-notify', '내 알림', 'admoff', ARRAY['VIEW','EDIT'], 2530)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
  CROSS JOIN (VALUES ('ofc-calendar'), ('ofc-tasks'), ('ofc-trips')) z(t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'ofc-notify', l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/office/calendar', 'ofc-calendar', 'VIEW'),
  ('POST', '/admin/office/events', 'ofc-calendar', 'EDIT'),
  ('PUT', '/admin/office/events/{id}', 'ofc-calendar', 'EDIT'),
  ('POST', '/admin/office/events/{id}/remove', 'ofc-calendar', 'EDIT'),
  ('GET', '/admin/office/tasks', 'ofc-tasks', 'VIEW'),
  ('GET', '/admin/office/tasks/{id}', 'ofc-tasks', 'VIEW'),
  ('POST', '/admin/office/tasks', 'ofc-tasks', 'EDIT'),
  ('POST', '/admin/office/tasks/{id}/move', 'ofc-tasks', 'EDIT'),
  ('POST', '/admin/office/tasks/{id}/assign', 'ofc-tasks', 'EDIT'),
  ('POST', '/admin/office/tasks/{id}/cancel', 'ofc-tasks', 'EDIT'),
  ('POST', '/admin/office/tasks/{id}/comments', 'ofc-tasks', 'EDIT'),
  ('GET', '/admin/office/trips', 'ofc-trips', 'VIEW'),
  ('GET', '/admin/office/trips/{id}', 'ofc-trips', 'VIEW'),
  ('POST', '/admin/office/trips', 'ofc-trips', 'EDIT'),
  ('POST', '/admin/office/trips/{id}/cancel', 'ofc-trips', 'EDIT'),
  ('POST', '/admin/office/trips/{id}/settle', 'ofc-trips', 'APPROVE'),
  ('PUT', '/admin/office/trip-standards', 'ofc-trips', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

