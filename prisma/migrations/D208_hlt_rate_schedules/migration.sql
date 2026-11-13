-- =====================================================================
-- D208 (v10.275 · docs/406) — 소개몰 판매수수료율 인상 예약(입점 약관 제17조 4항)
--
--   약관: 「회사가 요율을 올릴 때에는 시행일 30일 전에 공지하고 개별 통지하며, 시행일 이후 접수된 주문부터 적용」.
--   지금까지는 저장하는 순간 적용 → 약관 게시 뒤 어긋남. 대표 「다음개발」 A · 계획 승인(11/13).
--   ① hlt_rate_schedules — 예약(범위 SELLER · TYPE · CATEGORY · 대상 · 지금 → 새 · 시행 시각 · 사유)
--        시행일은 예약한 날(한국) + 31일 0시 이후 — 예약한 날을 빼고 꼬박 30일(DB 가 막음)
--        상태 SCHEDULED → APPLIED(시행 시각 뒤) · CANCELED(시행 전 · 사유 2자) — 내용은 고칠 수 없고 지울 수 없음
--        대상마다 예약은 하나만(SCHEDULED)
--   ② fn_hlt_rate_sched_sellers — 이 범위 · 대상 요율이 실제로 쓰이는 판매 중 · 정지 입점 판매자(알림 · 영향 수)
--   ③ fn_hlt_rate_notice — 바꾸면 어느 갈래에서라도 오르는지 · 영향받는 판매자 수(앱 · 미리보기가 같이 씀)
--   ④ fn_hlt_rate_for — 같은 이름 · 같은 인자. 칸마다 시행 시각이 지난 예약이 있으면 그 값을 먼저(0시 주문부터 정확히)
--   ⑤ fn_hlt_rate_sched_apply — 시행 시각이 지난 예약을 기본 표로 옮김 · 바꾼 기록 · 판매자 알림 · APPLIED
--        정기 작업 hlt_rate_schedule 매일 00:05(한국) · 요율을 바꿀 때마다 앱도 먼저 부름
--   내리는 것 · 영향받는 판매자가 없는 바꿈은 지금처럼 바로 적용(앱). 지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hlt_rate_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('SELLER', 'TYPE', 'CATEGORY')),
  target        text NOT NULL,
  from_rate     numeric(5,2),
  to_rate       numeric(5,2) CHECK (to_rate IS NULL OR (to_rate >= 0 AND to_rate <= 50)),
  effective_at  timestamptz NOT NULL,
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 2),
  notified      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'APPLIED', 'CANCELED')),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  applied_at    timestamptz,
  canceled_by   uuid REFERENCES public.accounts(id),
  canceled_at   timestamptz,
  cancel_reason text,
  CONSTRAINT hlt_rate_sched_category_rate CHECK (scope <> 'CATEGORY' OR to_rate IS NOT NULL),
  CONSTRAINT hlt_rate_sched_notice_31d CHECK (
    effective_at >= (((created_at AT TIME ZONE 'Asia/Seoul')::date + 31)::timestamp AT TIME ZONE 'Asia/Seoul'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hlt_rate_sched_open ON public.hlt_rate_schedules(scope, target) WHERE status = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS idx_hlt_rate_sched_due ON public.hlt_rate_schedules(effective_at) WHERE status = 'SCHEDULED';
COMMENT ON TABLE public.hlt_rate_schedules IS
  'v10.275 (D208) 판매수수료율 인상 예약 — 입점 약관 제17조 4항(30일 전 공지 · 개별 통지 · 시행일 이후 주문부터). 시행일 = 예약한 날 + 31일 0시(한국) 이후. 고칠 수 없음 · 지울 수 없음';

CREATE OR REPLACE FUNCTION public.fn_hlt_rate_sched_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HLTS: 요율 예약 기록은 지울 수 없습니다';
  END IF;
  IF (NEW.scope, NEW.target, NEW.from_rate, NEW.to_rate, NEW.effective_at, NEW.reason, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.scope, OLD.target, OLD.from_rate, OLD.to_rate, OLD.effective_at, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HLTS: 요율 예약 내용은 고칠 수 없습니다 — 취소하고 새로 예약하십시오';
  END IF;
  IF OLD.status <> 'SCHEDULED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'HLTS: 끝난 예약(%)은 바꿀 수 없습니다', OLD.status;
  END IF;
  IF NEW.status = 'CANCELED' AND OLD.status = 'SCHEDULED' THEN
    IF OLD.effective_at <= now() THEN
      RAISE EXCEPTION 'HLTS: 시행 시각이 지난 예약은 취소할 수 없습니다';
    END IF;
    IF length(btrim(coalesce(NEW.cancel_reason, ''))) < 2 THEN
      RAISE EXCEPTION 'HLTS: 예약 취소 사유(2자 이상)가 필요합니다';
    END IF;
  END IF;
  IF NEW.status = 'APPLIED' AND OLD.status = 'SCHEDULED' AND OLD.effective_at > now() THEN
    RAISE EXCEPTION 'HLTS: 시행 시각 전에는 적용할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hlt_rate_sched_guard ON public.hlt_rate_schedules;
CREATE TRIGGER trg_hlt_rate_sched_guard BEFORE UPDATE OR DELETE ON public.hlt_rate_schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_sched_guard();

-- ② 이 범위 · 대상 요율이 실제로 쓰이는 판매 중 · 정지 입점 판매자
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_sched_sellers(p_scope text, p_target text) RETURNS SETOF uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT s.id FROM hlt_sellers s
   WHERE s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED')
     AND CASE p_scope
           WHEN 'SELLER' THEN s.id::text = p_target
           WHEN 'TYPE'   THEN s.type = p_target AND s.commission_rate IS NULL
           WHEN 'CATEGORY' THEN s.commission_rate IS NULL
                AND NOT EXISTS (SELECT 1 FROM hlt_seller_type_rates t WHERE t.seller_type = s.type AND t.rate IS NOT NULL)
                AND EXISTS (SELECT 1 FROM hlt_products p JOIN categories c ON c.id = p.category_id
                             WHERE p.seller_id = s.id AND c.code = p_target)
           ELSE false
         END;
$$;
COMMENT ON FUNCTION public.fn_hlt_rate_sched_sellers(text, text) IS
  'v10.275 (D208) 범위(SELLER · TYPE · CATEGORY) · 대상 요율이 실제로 쓰이는 판매 중 · 정지 입점 판매자 — 순서 판매자 → 유형 → 갈래(갈래는 그 갈래 상품이 있는 곳)';

-- ③ 바꾸면 오르는지(어느 갈래에서라도) · 영향받는 판매자 수 · 지금 값
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_notice(p_scope text, p_target text, p_rate numeric)
    RETURNS TABLE(o_increase boolean, o_affected integer, o_from numeric)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE v_from numeric; v_type text; v_trate numeric; v_drate numeric; v_up boolean;
BEGIN
  v_drate := coalesce((SELECT rate FROM hlt_commission_rates WHERE category_code = '*'), 10.00);
  IF p_scope = 'SELLER' THEN
    SELECT s.commission_rate, s.type INTO v_from, v_type FROM hlt_sellers s WHERE s.id::text = p_target;
    SELECT t.rate INTO v_trate FROM hlt_seller_type_rates t WHERE t.seller_type = v_type;
    SELECT coalesce(bool_or(coalesce(p_rate, x.nx) > coalesce(v_from, x.nx)), false) INTO v_up
      FROM (SELECT coalesce(v_trate, cr.rate, v_drate) AS nx
              FROM (SELECT code FROM categories WHERE gwan_code = 'HLT' UNION ALL SELECT NULL::text) c
              LEFT JOIN hlt_commission_rates cr ON cr.category_code = c.code) x;
  ELSIF p_scope = 'TYPE' THEN
    SELECT t.rate INTO v_from FROM hlt_seller_type_rates t WHERE t.seller_type = p_target;
    SELECT coalesce(bool_or(coalesce(p_rate, x.nx) > coalesce(v_from, x.nx)), false) INTO v_up
      FROM (SELECT coalesce(cr.rate, v_drate) AS nx
              FROM (SELECT code FROM categories WHERE gwan_code = 'HLT' UNION ALL SELECT NULL::text) c
              LEFT JOIN hlt_commission_rates cr ON cr.category_code = c.code) x;
  ELSIF p_scope = 'CATEGORY' THEN
    SELECT cr.rate INTO v_from FROM hlt_commission_rates cr WHERE cr.category_code = p_target;
    v_up := coalesce(p_rate > coalesce(v_from, v_drate), false);
  ELSE
    v_up := false;
  END IF;
  RETURN QUERY SELECT v_up, (SELECT count(*)::int FROM fn_hlt_rate_sched_sellers(p_scope, p_target)), v_from;
END $$;
COMMENT ON FUNCTION public.fn_hlt_rate_notice(text, text, numeric) IS
  'v10.275 (D208) 요율을 바꾸면 어느 갈래에서라도 오르는지 · 영향받는 판매자 수 · 지금 값. 오르고 영향받는 판매자가 있으면 예약(30일 전 공지)이 필요';

-- 칸 하나 — 시행 시각이 지난 예약이 있으면 그 값(비움 예약이면 NULL) · 없으면 기본 표 값
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_layer(p_scope text, p_target text, p_base numeric) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM hlt_rate_schedules r
                            WHERE r.scope = p_scope AND r.target = p_target AND r.status = 'SCHEDULED' AND r.effective_at <= now())
              THEN (SELECT r.to_rate FROM hlt_rate_schedules r
                     WHERE r.scope = p_scope AND r.target = p_target AND r.status = 'SCHEDULED' AND r.effective_at <= now()
                     ORDER BY r.effective_at DESC LIMIT 1)
              ELSE p_base END;
$$;

-- ④ 요율 고르기 — 같은 이름 · 같은 인자 · 순서 그대로(판매자 → 유형 → 갈래 → * → 10%) · 칸마다 시행된 예약 먼저
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(
    (SELECT fn_hlt_rate_layer('SELLER', s.id::text, s.commission_rate) FROM hlt_sellers s WHERE s.id = p_seller),
    (SELECT fn_hlt_rate_layer('TYPE', t.seller_type, t.rate) FROM hlt_seller_type_rates t JOIN hlt_sellers s ON s.type = t.seller_type
      WHERE s.id = p_seller),
    fn_hlt_rate_layer('CATEGORY', p_category_code, (SELECT rate FROM hlt_commission_rates WHERE category_code = p_category_code)),
    (SELECT rate FROM hlt_commission_rates WHERE category_code = '*'),
    10.00);
$$;
COMMENT ON FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) IS
  '이 판매자·이 카테고리에 적용할 수수료율. **한 곳에서만 정합니다** — 앱이 따로 계산하면 화면과 정산이 갈립니다. v10.272 (D206) 순서: 판매자 지정 → 입점 유형(비어 있으면 건너뜀) → 갈래 → * → 10%. v10.275 (D208) 칸마다 시행 시각이 지난 예약(hlt_rate_schedules)이 먼저';

-- ⑤ 시행 시각이 지난 예약 → 기본 표 · 바꾼 기록 · 판매자 알림 · APPLIED
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_sched_apply() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE r record; v_from numeric; v_n integer := 0; v_show text;
BEGIN
  FOR r IN SELECT * FROM hlt_rate_schedules WHERE status = 'SCHEDULED' AND effective_at <= now()
            ORDER BY effective_at FOR UPDATE SKIP LOCKED LOOP
    IF r.scope = 'SELLER' THEN
      SELECT commission_rate INTO v_from FROM hlt_sellers WHERE id::text = r.target FOR UPDATE;
      UPDATE hlt_sellers SET commission_rate = r.to_rate, updated_at = now() WHERE id::text = r.target;
      IF FOUND AND v_from IS DISTINCT FROM r.to_rate THEN
        INSERT INTO hlt_seller_rate_changes (seller_id, from_rate, to_rate, reason, changed_by)
        VALUES (r.target::uuid, v_from, r.to_rate, '예약 시행 — ' || r.reason, r.created_by);
      END IF;
    ELSIF r.scope = 'TYPE' THEN
      SELECT rate INTO v_from FROM hlt_seller_type_rates WHERE seller_type = r.target FOR UPDATE;
      UPDATE hlt_seller_type_rates SET rate = r.to_rate, updated_by = r.created_by, updated_at = now() WHERE seller_type = r.target;
      IF FOUND AND v_from IS DISTINCT FROM r.to_rate THEN
        INSERT INTO hlt_type_rate_changes (seller_type, from_rate, to_rate, reason, changed_by)
        VALUES (r.target, v_from, r.to_rate, '예약 시행 — ' || r.reason, r.created_by);
      END IF;
    ELSE
      INSERT INTO hlt_commission_rates (category_code, rate, note, updated_by, updated_at)
      VALUES (r.target, r.to_rate, '예약 시행 — ' || r.reason, r.created_by, now())
      ON CONFLICT (category_code) DO UPDATE SET rate = EXCLUDED.rate, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now(),
             referral_pct = least(hlt_commission_rates.referral_pct, EXCLUDED.rate);
    END IF;
    v_show := CASE WHEN r.to_rate IS NULL THEN '다음 순서 요율' ELSE r.to_rate::text || '%' END;
    INSERT INTO notifications (account_id, event_code, title, body, link_url)
    SELECT s.account_id, 'SELLER_RATE_CHANGED', '판매 수수료율 변경이 시행되었습니다',
           '예고한 대로 오늘부터 들어오는 주문에 ' || v_show || ' 를 적용합니다(이미 받은 주문은 그대로) · 사유: ' || r.reason,
           '/health/seller/center'
      FROM hlt_sellers s
     WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target)) AND s.account_id IS NOT NULL;
    UPDATE hlt_rate_schedules SET status = 'APPLIED', applied_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.fn_hlt_rate_sched_apply() IS
  'v10.275 (D208) 시행 시각이 지난 요율 예약을 기본 표로 옮김(바꾼 기록 · 판매자 알림 · APPLIED). 요율 계산은 fn_hlt_rate_for 가 시행 시각부터 이미 예약 값을 씀 — 이 함수는 표를 맞추는 일';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hlt_rate_schedule', 1440, 0, 5, NULL, true,
        '소개몰 수수료율 예약 시행(D208) — 매일 00:05 · 시행 시각이 지난 예약을 기본 표로 옮기고 판매자에게 알림(요율 계산은 시행 시각부터 이미 새 값)')
ON CONFLICT (job) DO NOTHING;
