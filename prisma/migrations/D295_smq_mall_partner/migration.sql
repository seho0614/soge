-- 12차 소개몰 · 파트너 (v10.577 ~ 580 · docs/719 ~ 722) — 대표 11/21 「16개 모두 동시에」 승인
--   v10.577 ① 상품 문의 Q&A 2차 — 기존 hlt_qna(D036 · v10.28) 넓힘: 입점 상품은 판매자가 판매자센터에서 답 · 답 기한(due_at) · 기한 알림 · 금칙어(문의 · 판매자 답) · 운영 보이기 · 가리기
--   v10.578 ② 입점 열기 2차 점검 — 표 없음(읽기만) · 권한 주소 한 줄
--   v10.579 ③ 판매자 평가 · 패널티 — 달마다 배송 지연 · 판매자 사정 취소 · 문의 답 늦음 · 등급 · 경고 → 노출 제한(운영 승인 · 스위치 따로)
--   v10.580 ④ 파트너 정산 예측 — 표 없음(파트너센터 읽기만)
--   스위치는 모두 처음 off(smq.qna · smq.penalty · smq.penalty_exposure) · 기준 값은 일반 초안 · SUPER 만 바꿈(admin.service 패치 · PUT /admin/smq/rules)
--   다시 돌려도 같음(ADD COLUMN IF NOT EXISTS · CREATE OR REPLACE · IF NOT EXISTS · ON CONFLICT DO NOTHING · DROP CONSTRAINT IF EXISTS 뒤 바로 ADD)
--   지우는 문장 없음(검사를 넓히려고 옛 검사를 바꾸는 것뿐) · RAISE 글자에 퍼센트 기호 없음 · 트리거 이름 smq_ 앞머리 · 운영 알림은 정기 작업이 clock_timestamp()
--   INV-9 · INV-11 감시 낱말 칸 없음(deduct · commission · platform_fee · withhold · take_rate · account_no · bank_code · pg_ · escrow · vaccount · card_no)

/* ── ① v10.577 상품 문의 2차 ───────────────────────────────────────────────
 *   상태 PENDING 더함(스위치 on 때 문의 글이 금칙어에 걸리면 운영 확인 뒤 보임) · 답 쪽(answer_kind STAFF · SELLER) · 답 상태(answer_state)
 *   due_at = 쓴 때 + smq.qna_due_hours(처음 48시간) — 쓸 때 박아 둠(기준을 바꿔도 옛 문의 기한은 그대로) */
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS hold_word text;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS due_alerted_at timestamptz;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS answer_kind text;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS answer_state text NOT NULL DEFAULT 'VISIBLE';
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS answer_hold_word text;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS answer_hidden_reason text;
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.hlt_qna ADD COLUMN IF NOT EXISTS decided_at timestamptz;

/* 옛 상태 검사(이름 없이 만든 hlt_qna_state_check)를 넓힌 것으로 바꿈 */
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.hlt_qna'::regclass AND contype = 'c'
              AND conname NOT IN ('ck_hlt_qna_answer', 'ck_hlt_qna_hidden', 'ck_smq_qna_state', 'ck_smq_qna_answer_kind', 'ck_smq_qna_answer_state', 'ck_smq_qna_answer_hidden')
              AND pg_get_constraintdef(oid) LIKE '%state%VISIBLE%HIDDEN%' AND pg_get_constraintdef(oid) NOT LIKE '%answer_state%'
  LOOP
    EXECUTE format('ALTER TABLE public.hlt_qna DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.hlt_qna DROP CONSTRAINT IF EXISTS ck_smq_qna_state;
ALTER TABLE public.hlt_qna ADD CONSTRAINT ck_smq_qna_state CHECK (state IN ('VISIBLE', 'PENDING', 'HIDDEN'));
ALTER TABLE public.hlt_qna DROP CONSTRAINT IF EXISTS ck_smq_qna_answer_kind;
ALTER TABLE public.hlt_qna ADD CONSTRAINT ck_smq_qna_answer_kind CHECK (answer_kind IS NULL OR answer_kind IN ('STAFF', 'SELLER'));
ALTER TABLE public.hlt_qna DROP CONSTRAINT IF EXISTS ck_smq_qna_answer_state;
ALTER TABLE public.hlt_qna ADD CONSTRAINT ck_smq_qna_answer_state CHECK (answer_state IN ('VISIBLE', 'PENDING', 'HIDDEN'));
ALTER TABLE public.hlt_qna DROP CONSTRAINT IF EXISTS ck_smq_qna_answer_hidden;
ALTER TABLE public.hlt_qna ADD CONSTRAINT ck_smq_qna_answer_hidden CHECK (answer_state <> 'HIDDEN' OR btrim(coalesce(answer_hidden_reason, '')) <> '');

/* 옛 문의 — 기한 · 답 쪽 채움(한 번 · 비어 있는 것만) */
UPDATE public.hlt_qna SET due_at = created_at + interval '48 hours' WHERE due_at IS NULL;
UPDATE public.hlt_qna SET answer_kind = 'STAFF' WHERE answer IS NOT NULL AND answer_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_smq_qna_due ON public.hlt_qna (due_at) WHERE answer IS NULL AND state = 'VISIBLE';
CREATE INDEX IF NOT EXISTS idx_smq_qna_pending ON public.hlt_qna (created_at) WHERE state = 'PENDING' OR answer_state = 'PENDING';
COMMENT ON COLUMN public.hlt_qna.due_at IS 'v10.577 답 기한 — 쓴 때 + smq.qna_due_hours(처음 48) · 쓸 때 박아 둠 · 판매자 평가(문의 답 늦음)가 씀';
COMMENT ON COLUMN public.hlt_qna.answer_kind IS 'v10.577 답 쪽 — STAFF 운영(직판 · 입점 모두 답할 수 있음) · SELLER 그 상품의 입점 판매자(판매자센터)';
COMMENT ON COLUMN public.hlt_qna.answer_state IS 'v10.577 답 상태 — VISIBLE · PENDING(판매자 답이 금칙어에 걸림 · 운영 확인 뒤 보임) · HIDDEN(운영이 가림 · 사유)';

/* 문의 지킴 — 기한 박기 · 문의 금칙어(스위치 on) · 답 쪽 정하기 · 판매자 답 금칙어(스위치 on) · 가린 답은 판매자가 못 고침 */
CREATE OR REPLACE FUNCTION public.fn_smq_qna_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_on boolean; v_hours int; hit record; v_seller_acct uuid; v_seller_type text;
BEGIN
  v_on := coalesce((SELECT lower(btrim(value)) FROM public.site_settings WHERE key = 'smq.qna'), 'off') = 'on';
  IF TG_OP = 'INSERT' THEN
    v_hours := coalesce(nullif((SELECT btrim(value) FROM public.site_settings WHERE key = 'smq.qna_due_hours'), '')::int, 48);
    NEW.due_at := coalesce(NEW.created_at, now()) + make_interval(hours => v_hours);
    IF v_on THEN
      SELECT * INTO hit FROM public.fn_check_banned_words(NEW.body, 'HLT') LIMIT 1;
      IF hit.word IS NOT NULL THEN
        NEW.state := 'PENDING'; NEW.hold_word := hit.word;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.due_at IS NOT NULL AND NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    RAISE EXCEPTION 'SMQ_QNA: 답 기한은 바꿀 수 없습니다.';
  END IF;

  IF NEW.answer IS DISTINCT FROM OLD.answer AND NEW.answer IS NOT NULL THEN
    SELECT s.account_id, s.type INTO v_seller_acct, v_seller_type
      FROM public.hlt_products p LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id
     WHERE p.id = NEW.product_id;
    IF v_seller_type IN ('TENANT', 'BRAND') AND v_seller_acct IS NOT NULL AND v_seller_acct = NEW.answered_by THEN
      NEW.answer_kind := 'SELLER';
      IF NEW.state <> 'VISIBLE' THEN RAISE EXCEPTION 'SMQ_QNA: 보이는 문의에만 답할 수 있습니다.'; END IF;
      IF OLD.answer_state = 'HIDDEN' AND OLD.answer IS NOT NULL THEN RAISE EXCEPTION 'SMQ_QNA: 운영이 가린 답은 고칠 수 없습니다.'; END IF;
      NEW.answer_state := 'VISIBLE'; NEW.answer_hold_word := NULL; NEW.answer_hidden_reason := NULL;
      IF v_on THEN
        SELECT * INTO hit FROM public.fn_check_banned_words(NEW.answer, 'HLT') LIMIT 1;
        IF hit.word IS NOT NULL THEN NEW.answer_state := 'PENDING'; NEW.answer_hold_word := hit.word; END IF;
      END IF;
    ELSE
      NEW.answer_kind := 'STAFF';
      NEW.answer_state := 'VISIBLE'; NEW.answer_hold_word := NULL; NEW.answer_hidden_reason := NULL;
    END IF;
  ELSIF NEW.answer IS NULL THEN
    NEW.answer_kind := NULL; NEW.answer_state := 'VISIBLE'; NEW.answer_hold_word := NULL; NEW.answer_hidden_reason := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smq_qna_guard ON public.hlt_qna;
CREATE TRIGGER trg_smq_qna_guard BEFORE INSERT OR UPDATE ON public.hlt_qna
  FOR EACH ROW EXECUTE FUNCTION public.fn_smq_qna_guard();

/* ── ③ v10.579 판매자 평가 · 패널티 ─────────────────────────────────────────
 *   달마다 입점 판매자(TENANT · BRAND · 판매 중 · 정지) 한 줄 — 셈은 fn_smq_grade_calc(읽기만) · 등급 · 경고는 서버가 그때 기준(rules)으로 정해 박아 둠
 *   알린 뒤(notified_at)에는 숫자를 다시 쓰지 않음(정기 작업 · 다시 셈 모두 ON CONFLICT … WHERE notified_at IS NULL) */
CREATE TABLE IF NOT EXISTS public.smq_seller_grades (
  id              bigserial PRIMARY KEY,
  seller_id       uuid NOT NULL REFERENCES public.hlt_sellers(id) ON DELETE CASCADE,
  ym              text NOT NULL CONSTRAINT ck_smq_grade_ym CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  orders          integer NOT NULL DEFAULT 0 CONSTRAINT ck_smq_grade_orders CHECK (orders >= 0),
  late_ship       integer NOT NULL DEFAULT 0 CONSTRAINT ck_smq_grade_late CHECK (late_ship >= 0 AND late_ship <= orders),
  seller_cancels  integer NOT NULL DEFAULT 0 CONSTRAINT ck_smq_grade_cancel CHECK (seller_cancels >= 0 AND seller_cancels <= orders),
  qna_total       integer NOT NULL DEFAULT 0 CONSTRAINT ck_smq_grade_qna CHECK (qna_total >= 0),
  qna_late        integer NOT NULL DEFAULT 0 CONSTRAINT ck_smq_grade_qna_late CHECK (qna_late >= 0 AND qna_late <= qna_total),
  late_pct        numeric(5,1),
  cancel_pct      numeric(5,1),
  qna_pct         numeric(5,1),
  grade           text NOT NULL CONSTRAINT ck_smq_grade_grade CHECK (grade IN ('A', 'B', 'C', 'D', 'N')),
  level           text NOT NULL CONSTRAINT ck_smq_grade_level CHECK (level IN ('OK', 'WARN', 'LIMIT')),
  over_keys       text[] NOT NULL DEFAULT '{}',
  rules           jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  UNIQUE (seller_id, ym)
);
CREATE INDEX IF NOT EXISTS idx_smq_grade_ym ON public.smq_seller_grades (ym, level);
COMMENT ON TABLE public.smq_seller_grades IS 'v10.579 판매자 달 평가 — 배송 지연 · 판매자 사정 취소 · 반품 · 문의 답 늦음 · 등급(A · B · C · D · N 표본 부족) · 경고(WARN) · 노출 제한 제안(LIMIT) · 그때 기준을 rules 에 박아 둠 · 알린 뒤 숫자 고정';

CREATE TABLE IF NOT EXISTS public.smq_seller_limits (
  id           bigserial PRIMARY KEY,
  seller_id    uuid NOT NULL REFERENCES public.hlt_sellers(id) ON DELETE CASCADE,
  grade_id     bigint REFERENCES public.smq_seller_grades(id) ON DELETE SET NULL,
  state        text NOT NULL DEFAULT 'PROPOSED' CONSTRAINT ck_smq_limit_state CHECK (state IN ('PROPOSED', 'ACTIVE', 'REJECTED', 'LIFTED')),
  reason       text NOT NULL CONSTRAINT ck_smq_limit_reason CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300),
  from_on      date,
  until_on     date,
  proposed_at  timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CONSTRAINT ck_smq_limit_dnote CHECK (decide_note IS NULL OR char_length(decide_note) <= 300),
  lifted_by    uuid REFERENCES public.accounts(id),
  lifted_at    timestamptz,
  lift_note    text CONSTRAINT ck_smq_limit_lnote CHECK (lift_note IS NULL OR char_length(lift_note) <= 300),
  CONSTRAINT ck_smq_limit_dates CHECK (state NOT IN ('ACTIVE', 'LIFTED') OR (from_on IS NOT NULL AND until_on IS NOT NULL AND until_on >= from_on))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_smq_limit_open ON public.smq_seller_limits (seller_id) WHERE state IN ('PROPOSED', 'ACTIVE');
CREATE UNIQUE INDEX IF NOT EXISTS ux_smq_limit_grade ON public.smq_seller_limits (grade_id) WHERE grade_id IS NOT NULL;
COMMENT ON TABLE public.smq_seller_limits IS 'v10.579 노출 제한 — 정기 작업이 제안(PROPOSED) · 운영 승인(ACTIVE · 기간) · 반려 · 풀기(LIFTED · 기간 끝나면 저절로) · 실제로 목록에서 빠지는 것은 smq.penalty_exposure on 일 때만(v_smq_exposure_limited)';

/* 노출 제한 상태 지킴 — 제안 → 승인 · 반려 / 승인 → 풀기 만 · 판매자 · 평가는 못 바꿈 */
CREATE OR REPLACE FUNCTION public.fn_smq_limit_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seller_id <> OLD.seller_id OR (NEW.grade_id IS DISTINCT FROM OLD.grade_id AND NEW.grade_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SMQ_LIMIT: 노출 제한의 판매자 · 평가는 바꿀 수 없습니다.';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PROPOSED' AND NEW.state IN ('ACTIVE', 'REJECTED'))
    OR (OLD.state = 'ACTIVE' AND NEW.state = 'LIFTED')) THEN
    RAISE EXCEPTION 'SMQ_LIMIT: 이 상태에서는 그렇게 바꿀 수 없습니다.';
  END IF;
  IF OLD.state IN ('REJECTED', 'LIFTED') AND (NEW.from_on IS DISTINCT FROM OLD.from_on OR NEW.until_on IS DISTINCT FROM OLD.until_on OR NEW.reason <> OLD.reason) THEN
    RAISE EXCEPTION 'SMQ_LIMIT: 끝난 노출 제한은 고칠 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smq_limit_guard ON public.smq_seller_limits;
CREATE TRIGGER trg_smq_limit_guard BEFORE UPDATE ON public.smq_seller_limits
  FOR EACH ROW EXECUTE FUNCTION public.fn_smq_limit_guard();

/* 노출 엔진이 보는 한 곳 — 승인된(ACTIVE) 제한 · 오늘(한국)이 기간 안 · smq.penalty_exposure on 일 때만 줄이 나옴
 *   목록 · 검색 · 고민별 · 순위(오늘의 건강상품)에서 그 판매자 상품을 뺌 — 상품 상세 · 장바구니 · 이미 받은 주문은 그대로(INV-H10 자격 만료와 같은 모양)
 *   대가(광고비 · 구독)에 따른 순위 가중이 아니라 품질 기준에 따른 제외 — INV-11(기본 정렬에 대가 가중치 없음 · 광고 · 일반 목록 분리)과 부딪히지 않음(docs/721 3절) */
CREATE OR REPLACE VIEW public.v_smq_exposure_limited AS
  SELECT DISTINCT l.seller_id
    FROM public.smq_seller_limits l
   WHERE l.state = 'ACTIVE'
     AND (now() AT TIME ZONE 'Asia/Seoul')::date BETWEEN l.from_on AND l.until_on
     AND coalesce((SELECT lower(btrim(s.value)) FROM public.site_settings s WHERE s.key = 'smq.penalty_exposure'), 'off') = 'on';
COMMENT ON VIEW public.v_smq_exposure_limited IS 'v10.579 지금 노출 제한 중인 판매자 — smq.penalty_exposure on · 승인 · 기간 안일 때만 · 소개몰 목록 SQL 이 NOT EXISTS 로 씀';

/* 달 셈(읽기만) — 한국 달 · 결제한 주문 기준
 *   배송 지연 = 결제 뒤 p_ship_days 일 안에 발송하지 않음(늦게 발송 · 아직 안 보냄 모두 · 영업일이 아니라 달력 날)
 *   판매자 사정 취소 · 반품 = 사유 DEFECT · WRONG_ITEM · MISMATCH · DELAY 인 취소 · 반품 · 교환 신청(반려 뺌)이 있는 주문 수 — 회원 사정(CHANGE_MIND · WRONG_ORDER)은 빼고
 *   문의 = 그 판매자 상품에 그달 쓰인 보이는 문의 · 늦음 = 기한 지나도 답 없음 또는 기한 뒤 답 */
CREATE OR REPLACE FUNCTION public.fn_smq_grade_calc(p_ym text, p_ship_days integer)
RETURNS TABLE (seller_id uuid, orders integer, late_ship integer, seller_cancels integer, qna_total integer, qna_late integer)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v_lo timestamptz; v_hi timestamptz;
BEGIN
  IF p_ym IS NULL OR p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'SMQ_GRADE: 달은 YYYY-MM 으로 주십시오.'; END IF;
  IF p_ship_days IS NULL OR p_ship_days < 1 OR p_ship_days > 14 THEN RAISE EXCEPTION 'SMQ_GRADE: 발송 기한은 1 ~ 14일입니다.'; END IF;
  v_lo := (p_ym || '-01')::date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_hi := ((p_ym || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';
  RETURN QUERY
  WITH s AS (
    SELECT h.id FROM public.hlt_sellers h WHERE h.type IN ('TENANT', 'BRAND') AND h.status IN ('ACTIVE', 'PAUSED')
  ), o AS (
    SELECT x.seller_id, count(*)::int AS n,
           count(*) FILTER (WHERE (x.shipped_at IS NOT NULL AND x.shipped_at > x.paid_at + make_interval(days => p_ship_days))
                               OR (x.shipped_at IS NULL AND x.status IN ('PAID', 'PREPARING') AND now() > x.paid_at + make_interval(days => p_ship_days)))::int AS late,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.hlt_returns r WHERE r.order_id = x.id AND r.state <> 'REJECTED'
                                            AND r.reason IN ('DEFECT', 'WRONG_ITEM', 'MISMATCH', 'DELAY')))::int AS cancels
      FROM public.hlt_orders x
     WHERE x.seller_id IN (SELECT id FROM s) AND x.paid_at >= v_lo AND x.paid_at < v_hi
     GROUP BY x.seller_id
  ), q AS (
    SELECT p.seller_id, count(*)::int AS n,
           count(*) FILTER (WHERE (q1.answer IS NULL AND coalesce(q1.due_at, q1.created_at + interval '48 hours') < now())
                               OR (q1.answered_at IS NOT NULL AND q1.answered_at > coalesce(q1.due_at, q1.created_at + interval '48 hours')))::int AS late
      FROM public.hlt_qna q1 JOIN public.hlt_products p ON p.id = q1.product_id
     WHERE p.seller_id IN (SELECT id FROM s) AND q1.state = 'VISIBLE' AND q1.created_at >= v_lo AND q1.created_at < v_hi
     GROUP BY p.seller_id
  )
  SELECT s.id, coalesce(o.n, 0), coalesce(o.late, 0), coalesce(o.cancels, 0), coalesce(q.n, 0), coalesce(q.late, 0)
    FROM s LEFT JOIN o ON o.seller_id = s.id LEFT JOIN q ON q.seller_id = s.id
   ORDER BY s.id;
END $$;
COMMENT ON FUNCTION public.fn_smq_grade_calc(text, integer) IS 'v10.579 판매자 달 셈(읽기만) — 결제 주문 수 · 배송 지연 · 판매자 사정 취소 · 반품 · 문의 · 문의 답 늦음 · 한국 달 · 등급 · 경고는 서버(smq/grades.ts)가 기준으로 정함';

/* ── ④ 설정 · 정기 작업 · ㉕ 권한(D258) 시드 ──────────────────────────────────
 *   스위치 셋 처음 off(규칙 9) · 기준 값은 일반 초안(대표 · 법무 확인 전 · SUPER 만 바꿈) · 값 무늬는 서버 검사(smq/common.ts)와 같은 범위 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('smq.qna', 'off', 'ADMIN', '상품 문의 2차(v10.577) — 처음 off · on 이면 입점 상품 문의는 판매자센터에서 그 판매자가 답함(운영도 답할 수 있음) · 문의 · 판매자 답이 금칙어에 걸리면 운영 확인 뒤 보임 · 답 기한 지나면 판매자 알림 · 운영 알림', false, '^(on|off)$', 'off'),
  ('smq.qna_due_hours', '48', 'ADMIN', '상품 문의 답 기한(시간 · 1 ~ 168 · 처음 48 · v10.577) — 문의를 쓸 때 기한을 박아 둠(바꿔도 옛 문의는 그대로) · 판매자 평가 「문의 답 늦음」이 씀', false, '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$', '48'),
  ('smq.penalty', 'off', 'ADMIN', '판매자 평가 · 패널티(v10.579) — 처음 off · on 이면 매달 1일부터 지난달 평가를 셈하고 3일부터 경고(WARN) 알림 · 노출 제한 제안(운영 승인) · 기준 값 smq.penalty_* 는 SUPER 만', false, '^(on|off)$', 'off'),
  ('smq.penalty_exposure', 'off', 'ADMIN', '노출 제한 실제 적용(v10.579 · SUPER 만) — 처음 off · on 이면 승인된 노출 제한 기간 동안 그 판매자 상품을 소개몰 목록 · 검색 · 고민별 · 순위에서 뺌(상세 · 주문은 그대로) · 입점 약관에 기준을 적은 뒤 켜기(법무 확인)', false, '^(on|off)$', 'off'),
  ('smq.penalty_late_pct', '10', 'ADMIN', '배송 지연 기준(퍼센트 · 1 ~ 100 · 처음 10 · v10.579 · SUPER 만) — 결제 주문 가운데 발송 기한을 넘긴 비율이 이보다 크면 기준 넘음', false, '^([1-9]|[1-9][0-9]|100)$', '10'),
  ('smq.penalty_cancel_pct', '5', 'ADMIN', '판매자 사정 취소 · 반품 기준(퍼센트 · 1 ~ 100 · 처음 5 · v10.579 · SUPER 만) — 불량 · 오배송 · 상품 정보 다름 · 배송 지연 사유 신청이 있는 주문 비율', false, '^([1-9]|[1-9][0-9]|100)$', '5'),
  ('smq.penalty_qna_pct', '20', 'ADMIN', '문의 답 늦음 기준(퍼센트 · 1 ~ 100 · 처음 20 · v10.579 · SUPER 만) — 그달 문의 가운데 답 기한을 넘긴 비율', false, '^([1-9]|[1-9][0-9]|100)$', '20'),
  ('smq.penalty_min_orders', '10', 'ADMIN', '평가 표본(주문 수 · 1 ~ 1000 · 처음 10 · v10.579 · SUPER 만) — 이보다 적으면 배송 지연 · 취소 기준은 판정하지 않음(문의는 5건부터)', false, '^([1-9]|[1-9][0-9]{1,2}|1000)$', '10'),
  ('smq.penalty_ship_days', '3', 'ADMIN', '발송 기한(일 · 1 ~ 14 · 처음 3 · v10.579 · SUPER 만) — 결제 뒤 이 날 수 안에 발송하지 않으면 배송 지연(달력 날)', false, '^([1-9]|1[0-4])$', '3'),
  ('smq.penalty_limit_months', '2', 'ADMIN', '노출 제한 제안 기준(달 · 2 ~ 6 · 처음 2 · v10.579 · SUPER 만) — 이 달 수만큼 잇달아 경고면 노출 제한을 제안(운영 승인 뒤 적용)', false, '^[2-6]$', '2'),
  ('smq.penalty_limit_days', '30', 'ADMIN', '노출 제한 기간(일 · 1 ~ 90 · 처음 30 · v10.579 · SUPER 만) — 승인한 날부터', false, '^([1-9]|[1-8][0-9]|90)$', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('smq_daily', 1440, 9, 20, NULL, true, '소개몰 · 파트너 12차 — 매일 09:20 · 상품 문의 답 기한 넘김(smq.qna on · 판매자 알림 SMQ_QNA_DUE 한 번 · 운영 알림 SMQ_QNA_OVERDUE 하루 한 번) · 판매자 평가(smq.penalty on · 1일부터 지난달 셈 · 3일부터 경고 알림 · 노출 제한 제안 SMQ_LIMIT_PROPOSED) · 기간 끝난 노출 제한 풀기 · v10.577 · 579')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 2개(소개몰 묶음 admhlt · TAB_ROLES 따로 없음 = ADMIN · SUPER) · gen_seed 규칙(GET = VIEW · 보이기 · 가리기 · 승인 = APPROVE · 그 밖 변경 = EDIT)
 *   입점 열기 2차 점검(v10.578)은 「소개몰 판매자」 탭(hlt-sellers) 안 · 기준 값 고치기(PUT /admin/smq/rules)는 SUPER 전용(@Roles('SUPER') — R_ 그룹에 넣지 않음 · 주소만 연결)
 *   직판 문의 답은 기존 주소(POST /admin/health/qna/{id}/answer)를 이 탭에서도 씀 — 주소 하나가 두 업무(hlt-reviews · smq-qna)에 · 하나라도 있으면 통과 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('smq-qna', '상품 문의 답 관리', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3240),
  ('smq-grades', '판매자 평가 · 패널티', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3250)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'smq-qna', 'VIEW'), ('R_ADMIN', 'smq-qna', 'EDIT'), ('R_ADMIN', 'smq-qna', 'APPROVE'), ('R_ADMIN', 'smq-qna', 'EXPORT'),
  ('R_ADMIN', 'smq-grades', 'VIEW'), ('R_ADMIN', 'smq-grades', 'EDIT'), ('R_ADMIN', 'smq-grades', 'APPROVE'), ('R_ADMIN', 'smq-grades', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/smq/qna', 'smq-qna', 'VIEW'),
  ('POST', '/admin/smq/qna/{id}/decide', 'smq-qna', 'APPROVE'),
  ('POST', '/admin/health/qna/{id}/answer', 'smq-qna', 'EDIT'),
  ('GET', '/admin/smq/tenant-ready2', 'hlt-sellers', 'VIEW'),
  ('GET', '/admin/smq/grades', 'smq-grades', 'VIEW'),
  ('POST', '/admin/smq/grades/recalc', 'smq-grades', 'EDIT'),
  ('POST', '/admin/smq/limits/{id}/decide', 'smq-grades', 'APPROVE'),
  ('GET', '/admin/smq/rules', 'smq-grades', 'VIEW'),
  ('PUT', '/admin/smq/rules', 'smq-grades', 'EDIT')
ON CONFLICT DO NOTHING;
