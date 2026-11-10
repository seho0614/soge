-- =====================================================================
-- D193 — 소개몰 판매자 관리: 정지 · 다시 열기 · 이용 제한 · 폐점(탈퇴) · 정보 변경 요청 · 수수료율 바꾸기 · 허가증 만료 알림 · 신청 스위치 나누기
--        (v10.223 · 2026-11-10)
--
--   대표 「안심파트너 · 제휴파트너 · 판매자 등록 및 관리 절차 점검」 → 「1 · 2 · 3 모두」 · 판매자 권한 「ADMIN · SUPER 만」 · 허가증 만료 「알림만」(11/9).
--
--   ① hlt_sellers 상태 CLOSED(폐점 — 본인 탈퇴 또는 운영) 더함 · 상태 사유 · 바꾼 사람 · 시각.
--      PAUSED · BLOCKED · CLOSED 로 바꿀 때 사유 필수(DB). ACTIVE 에서 벗어나면 판매 중 상품을 내림(STOPPED · off_by_seller_at 표시) ·
--      PAUSED → ACTIVE 로 돌아오면 그때 내린 상품만 다시 판매(판매 조건 — 입점 판매 열림 · 하위가맹점 · 검수 통과 — 이 맞는 것만).
--   ② hlt_seller_change_requests — 승인된 판매자의 정보 변경은 요청 → 운영 승인(상호 · 대표 · 사업자번호 · 통신판매업 · 전화 · 반품지 · 주소 · 서류).
--   ③ hlt_seller_rate_changes — 수수료율 바꾼 기록(사유 · 누가). 수수료는 주문 때 박히므로(fn_hlt_item_* · B075) 바꾼 값은 새 주문부터.
--   ④ 허가증 만료 — 만료 30일 · 7일 전 판매자에게 알림 · 만료일(지난 것 포함)에 운영 알림 한 번. 자동 정지는 하지 않음(대표 「알림만」).
--      정기 작업 seller_license_watch 매일 09:00(한국).
--   ⑤ 설정 mall.tenant_apply(입점 신청 받기) 새로 · mall.tenant 는 입점 판매 열기로만. 지금 값을 그대로 옮김(바뀌는 것 없음).
-- =====================================================================

/* ① 상태 · 사유 */
ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS status_at timestamptz;
ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS status_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.hlt_sellers DROP CONSTRAINT IF EXISTS hlt_sellers_status_check;
ALTER TABLE public.hlt_sellers ADD CONSTRAINT hlt_sellers_status_check
  CHECK (status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'PAUSED'::text, 'BLOCKED'::text, 'REJECTED'::text, 'CLOSED'::text]));
COMMENT ON COLUMN public.hlt_sellers.status IS
  '판매자 상태 — PENDING 심사 · ACTIVE 판매 · PAUSED 일시 정지 · BLOCKED 이용 제한(다시 신청 불가) · REJECTED 반려 · CLOSED 폐점(본인 탈퇴 또는 운영 · 다시 신청 가능 · D193)';
COMMENT ON COLUMN public.hlt_sellers.status_reason IS '정지 · 이용 제한 · 폐점 · 다시 열기 사유(D193) — 판매자에게 보임';

ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS off_by_seller_at timestamptz;
COMMENT ON COLUMN public.hlt_products.off_by_seller_at IS '판매자가 정지 · 이용 제한 · 폐점되어 내린 상품(D193) — 다시 열리면 이 표시가 있는 것만 판매로 되돌림';

CREATE OR REPLACE FUNCTION public.fn_hlt_seller_status_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('PAUSED', 'BLOCKED', 'CLOSED') AND length(btrim(coalesce(NEW.status_reason, ''))) < 2 THEN
    RAISE EXCEPTION 'HLTS: 판매자 정지 · 이용 제한 · 폐점에는 사유가 필요합니다';
  END IF;
  NEW.status_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_seller_status_guard ON public.hlt_sellers;
CREATE TRIGGER trg_hlt_seller_status_guard BEFORE UPDATE OF status ON public.hlt_sellers
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_seller_status_guard();

CREATE OR REPLACE FUNCTION public.fn_hlt_seller_products_follow() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.type = 'DIRECT' THEN RETURN NEW; END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status IN ('PAUSED', 'BLOCKED', 'CLOSED') THEN
    UPDATE public.hlt_products SET status = 'STOPPED', off_by_seller_at = now()
     WHERE seller_id = NEW.id AND status = 'ON_SALE';
  ELSIF OLD.status = 'PAUSED' AND NEW.status = 'ACTIVE' THEN
    /* 판매 조건(판매 문 · 옵션 · 업종 등 상품 트리거)이 맞는 것만 되돌림 — 하나씩 해 보고 막히면 내린 채로(판매자가 고쳐서 다시 올림).
     * 상품 하나가 막혀도 판매자 다시 열기 전체가 실패하지 않게 합니다. */
    FOR p IN SELECT id FROM public.hlt_products WHERE seller_id = NEW.id AND status = 'STOPPED' AND off_by_seller_at IS NOT NULL LOOP
      BEGIN
        UPDATE public.hlt_products SET status = 'ON_SALE' WHERE id = p.id;
      EXCEPTION WHEN raise_exception OR check_violation THEN
        NULL;
      END;
    END LOOP;
    UPDATE public.hlt_products SET off_by_seller_at = NULL WHERE seller_id = NEW.id AND off_by_seller_at IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_seller_products_follow ON public.hlt_sellers;
CREATE TRIGGER trg_hlt_seller_products_follow AFTER UPDATE OF status ON public.hlt_sellers
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_seller_products_follow();

/* ② 정보 변경 요청 */
CREATE TABLE IF NOT EXISTS public.hlt_seller_change_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.hlt_sellers(id) ON DELETE CASCADE,
  fields       jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object' AND fields <> '{}'::jsonb),
  note         text CHECK (note IS NULL OR length(note) <= 500),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason       text,
  requested_by uuid REFERENCES public.accounts(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  CONSTRAINT ck_hlt_change_reject_reason CHECK (state <> 'REJECTED' OR length(btrim(coalesce(reason, ''))) >= 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hlt_change_pending ON public.hlt_seller_change_requests(seller_id) WHERE state = 'PENDING';
COMMENT ON TABLE public.hlt_seller_change_requests IS
  '승인된 판매자의 정보 변경 요청(D193 · v10.223) — 판매자센터에서 요청 → 운영(ADMIN · SUPER) 승인 때 hlt_sellers · 서류에 반영 · 반려 사유는 판매자에게 보임 · 판매자당 대기 1건';

/* ③ 수수료율 기록 */
CREATE TABLE IF NOT EXISTS public.hlt_seller_rate_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  uuid NOT NULL REFERENCES public.hlt_sellers(id) ON DELETE CASCADE,
  from_rate  numeric(5,2),
  to_rate    numeric(5,2),
  reason     text NOT NULL CHECK (length(btrim(reason)) >= 2),
  changed_by uuid REFERENCES public.accounts(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hlt_rate_changes_seller ON public.hlt_seller_rate_changes(seller_id, changed_at DESC);
COMMENT ON TABLE public.hlt_seller_rate_changes IS
  '판매자 수수료율 바꾼 기록(D193) — NULL 은 갈래 기본값(fn_hlt_rate_for). 수수료는 주문 때 박히므로 새 주문부터 적용';

/* ④ 허가증 만료 알림 */
CREATE TABLE IF NOT EXISTS public.hlt_seller_license_notices (
  license_id uuid NOT NULL REFERENCES public.hlt_seller_licenses(id) ON DELETE CASCADE,
  stage      text NOT NULL CHECK (stage IN ('D30', 'D7', 'D0')),
  expires_at date NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (license_id, stage, expires_at)
);
COMMENT ON TABLE public.hlt_seller_license_notices IS
  '허가증 만료 알림을 보낸 기록(D193) — 같은 서류 · 같은 만료일 · 같은 단계는 한 번. 만료일을 고쳐 내면 새로 셈';

CREATE OR REPLACE FUNCTION public.fn_hlt_license_watch() RETURNS TABLE(notified int, expired int)
    LANGUAGE plpgsql AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  r record; v_stage text; v_n int := 0; v_x int := 0; v_list jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT l.id, l.kind, l.license_no, l.expires_at, s.id AS seller_id, s.code, s.name, s.account_id
      FROM hlt_seller_licenses l JOIN hlt_sellers s ON s.id = l.seller_id
     WHERE s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED')
       AND l.expires_at IS NOT NULL AND l.expires_at <= v_today + 30
  LOOP
    v_stage := CASE WHEN r.expires_at <= v_today THEN 'D0' WHEN r.expires_at <= v_today + 7 THEN 'D7' ELSE 'D30' END;
    INSERT INTO hlt_seller_license_notices (license_id, stage, expires_at) VALUES (r.id, v_stage, r.expires_at)
      ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF r.account_id IS NOT NULL THEN
      INSERT INTO notifications (account_id, event_code, title, body, link_url)
      VALUES (r.account_id, 'SELLER_LICENSE_EXPIRING',
              CASE WHEN v_stage = 'D0' THEN '입점 서류 유효기간이 지났습니다' ELSE '입점 서류 유효기간이 다가옵니다' END,
              format('%s 서류(번호 %s)의 유효기간이 %s 입니다. 새 서류를 판매자센터 「정보 변경 요청」으로 내 주십시오.',
                     CASE r.kind WHEN 'BIZ_REG' THEN '사업자등록' WHEN 'ECOM_REG' THEN '통신판매업' WHEN 'FOOD_SALE' THEN '식품 판매'
                                 WHEN 'HEALTH_FUNC' THEN '건강기능식품' WHEN 'MED_DEVICE' THEN '의료기기' WHEN 'COSMETIC' THEN '화장품책임판매업'
                                 WHEN 'BRAND_RIGHT' THEN '브랜드 권리' ELSE r.kind END,
                     r.license_no, to_char(r.expires_at, 'YYYY-MM-DD')),
              '/health/seller/center');
      v_n := v_n + 1;
    END IF;
    IF v_stage = 'D0' THEN
      v_x := v_x + 1;
      v_list := v_list || jsonb_build_object('seller', r.code, 'name', r.name, 'kind', r.kind, 'expiresAt', r.expires_at);
    END IF;
  END LOOP;
  IF v_x > 0 THEN
    INSERT INTO ops_alerts (alert_code, severity, title, detail)
    VALUES ('SELLER_LICENSE_EXPIRED', 'WARN', format('입점 판매자 서류 유효기간 지남 %s건 — 판매를 계속할지 확인하십시오', v_x),
            jsonb_build_object('items', v_list))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN QUERY SELECT v_n, v_x;
END $$;
COMMENT ON FUNCTION public.fn_hlt_license_watch() IS
  '입점 서류 만료 — 30일 · 7일 전 판매자 알림 · 만료일(지난 것 포함) 판매자 알림 + 운영 알림 SELLER_LICENSE_EXPIRED 한 번(D193). 자동 정지 없음';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('seller_license_watch', 1440, 9, 0, NULL, true,
        '입점 서류 만료 알림(D193) — 매일 09:00 · 만료 30일 · 7일 전 판매자에게 · 만료일에 운영 알림 · 자동 정지는 하지 않음')
ON CONFLICT (job) DO NOTHING;

/* ⑤ 신청 스위치 나누기 — 지금 mall.tenant 값을 그대로 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
SELECT 'mall.tenant_apply', coalesce((SELECT value FROM public.site_settings WHERE key = 'mall.tenant'), 'off'), 'GLOBAL',
       '소개몰 입점 신청 받기(v10.223 · D193) — on 이면 회원이 입점을 신청하고 운영이 심사합니다. 켜기는 SUPER · 입점 약관(HLT_SELLER) 게시 뒤에만. 판매는 mall.tenant 가 따로 엽니다.',
       false, '^(on|off)$', 'off'
ON CONFLICT (key) DO NOTHING;
UPDATE public.site_settings
   SET description = '소개몰 입점 판매 열기(v10.165 · v10.223 D193 에서 판매만으로 나눔) — on 이면 승인된 입점 판매자 상품을 판매할 수 있습니다. 결제대행사 하위가맹점 · 지급대행 계약 뒤에만 켜십시오(decisions/mall-return-refund #14 · #15). 신청 받기는 mall.tenant_apply.'
 WHERE key = 'mall.tenant';

CREATE OR REPLACE FUNCTION public.fn_setting_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_old text := OLD.value;
  v_by  uuid;
BEGIN
  IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.key IN ('mall.order_open', 'signup.open', 'admin.mfa_required', 'mall.tenant', 'mall.tenant_apply')
          OR NEW.key LIKE 'assume.%' OR NEW.key LIKE 'feature.%') THEN
    RETURN NEW;
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    v_by := NEW.updated_by;
  END IF;
  /* raised_at 은 clock_timestamp — (alert_code, raised_at) 가 유일이라 한 문장으로 두 키를 바꿀 때 now() 로 겹치지 않게(D179 와 같음) */
  INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
  VALUES ('SETTING_CHANGED', 'WARN', clock_timestamp(),
          format('중요 설정 바뀜 — %s: %s → %s', NEW.key, coalesce(nullif(v_old, ''), '(빈 값)'), coalesce(nullif(NEW.value, ''), '(빈 값)')),
          jsonb_build_object('key', NEW.key, 'from', v_old, 'to', NEW.value,
                             'by', v_by, 'via', CASE WHEN v_by IS NULL THEN 'DB' ELSE 'APP' END,
                             'dbUser', current_user,
                             'reason', nullif(current_setting('app.setting_reason', true), '')));
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_setting_watch() IS '중요 설정(주문 받기 · 입점 판매 · 입점 신청 · 가입 · 2단계 인증 · 간주 · 기능 스위치)이 바뀌면 운영 알림 SETTING_CHANGED(WARN) — D174 · D180 · D193';

/* 알림 종류 */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('SELLER_PAUSED',          '소개몰 판매 일시 정지',    false, false, '자격 상태 — 정지 중에는 상품이 판매되지 않습니다', 'warn'),
  ('SELLER_RESUMED',         '소개몰 판매 다시 열림',    false, false, '자격 상태', 'ok'),
  ('SELLER_BLOCKED',         '소개몰 판매자 이용 제한',  false, false, '자격 상태', 'warn'),
  ('SELLER_CLOSED',          '소개몰 폐점',             false, false, '자격 상태', 'info'),
  ('SELLER_CHANGE_APPROVED', '판매자 정보 변경 승인',    false, false, '판매자 정보', 'ok'),
  ('SELLER_CHANGE_REJECTED', '판매자 정보 변경 반려',    false, false, '판매자 정보', 'warn'),
  ('SELLER_RATE_CHANGED',    '판매 수수료율 바뀜',      false, false, '거래 조건 — 새 주문부터 적용', 'info'),
  ('SELLER_LICENSE_EXPIRING','입점 서류 유효기간',      false, false, '판매 자격 — 서류가 만료되면 판매를 계속할 수 없을 수 있습니다', 'warn')
ON CONFLICT (event_code) DO NOTHING;
