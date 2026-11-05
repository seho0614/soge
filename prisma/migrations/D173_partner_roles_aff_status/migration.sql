-- =====================================================================
-- D173 (v10.194 · docs/304) — 안심 파트너 · 제휴 파트너 권한을 따로 관리
--
--   대표 「둘 다」 · 「ADMIN 은 둘 다 유지」(11/5).
--
--   ① 운영 역할 2개 — PARTNER_MAL(안심 파트너 담당) · PARTNER_AFF(제휴 파트너 담당)
--      ADMIN · SUPER 는 지금처럼 두 쪽 다. 새 역할은 그 쪽 운영 화면 · API 만(돈을 움직이는 API 는 ADMIN 그대로 — 서버 @Roles)
--      PAYOUT 과 함께 가질 수 없음(승인하는 사람과 돈을 보내는 사람을 나눔 · C710 · fn_duty_separation · v_duty_conflict)
--      권한 변경 기록(role_changes)에 새 역할과 그동안 빠져 있던 PAYOUT 도 남김(fn_role_audit) · 권한 보유자 목록(v_role_holders)
--      파일 열람 — PARTNER_MAL 은 중개 서류 · 파트너 사진(BROKER_DOC · PARTNER_MEDIA) · PARTNER_AFF 는 홍보 자료 · 안내(MARKETING_MATERIAL · PARTNER_GUIDE)
--
--   ② 회원 파트너 자격 — partners 한 줄을 안심소개 파트너센터(/partner)와 제휴 파트너센터(/partners)가 같이 써서
--      한쪽에서 승인하면 두 센터가 함께 열리던 것을 나눔
--      partners.status   = 안심소개 자격(그대로) · 새 값 NONE = 안심 신청 없음(제휴만 신청한 줄)
--      partners.aff_*    = 제휴 자격(신청 · 활동 · 정지 · 탈퇴 · 반려) · 신청일 · 승인일 · 승인자 · 사유
--      기존 줄은 지금 상태를 제휴 칸에 그대로 복사 — 누구도 접근이 끊기지 않음(규칙에 걸리는 줄은 건너뛰고 NOTICE)
--      제휴 활동(ACTIVE)은 승인자 · 승인 시각 · 활동 자격(사업자 인증 · 개인은 본인인증 · fn_actor_ok) · 정지 · 반려는 사유(fn_partner_aff_guard)
--
--   지우는 문장 없음(뷰 · 함수는 같은 칸으로 다시 정의). 재실행 안전.
-- =====================================================================

/* ── ① 운영 역할 ──────────────────────────────────────────────────── */
ALTER TABLE public.account_roles DROP CONSTRAINT IF EXISTS account_roles_role_check;
ALTER TABLE public.account_roles ADD CONSTRAINT account_roles_role_check
  CHECK (role = ANY (ARRAY['MEMBER','BIZ_OWNER','BIZ_STAFF','REVIEWER','ADMIN','PAYOUT','SUPER','PARTNER_MAL','PARTNER_AFF']));

CREATE OR REPLACE FUNCTION public.fn_duty_separation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE has_conflict boolean;
BEGIN
  IF NEW.role NOT IN ('ADMIN','PAYOUT','PARTNER_MAL','PARTNER_AFF') THEN RETURN NEW; END IF;

  /* SUPER 는 예외 — 사고 수습 때 열 사람이 하나는 있어야 합니다. */
  IF EXISTS (SELECT 1 FROM account_roles
              WHERE account_id = NEW.account_id AND role = 'SUPER') THEN
    RETURN NEW;
  END IF;

  /* v10.194 (D173) — 승인하는 역할(ADMIN · PARTNER_MAL · PARTNER_AFF)과 지급 실행(PAYOUT)은 한 사람이 함께 갖지 않음 */
  SELECT EXISTS (
    SELECT 1 FROM account_roles
     WHERE account_id = NEW.account_id
       AND CASE WHEN NEW.role = 'PAYOUT' THEN role IN ('ADMIN','PARTNER_MAL','PARTNER_AFF') ELSE role = 'PAYOUT' END
  ) INTO has_conflict;

  IF has_conflict THEN
    RAISE EXCEPTION
      'DUTY: 한 사람이 승인(ADMIN · 파트너 담당)과 지급 실행(PAYOUT)을 함께 가질 수 없습니다 — 사고가 나도 되돌릴 근거가 없어집니다';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW public.v_duty_conflict AS
 SELECT a.email,
    string_agg(r.role, '·'::text ORDER BY r.role) AS roles
   FROM (public.account_roles r
     JOIN public.accounts a ON ((a.id = r.account_id)))
  WHERE ((r.role = ANY (ARRAY['ADMIN'::text, 'PAYOUT'::text, 'PARTNER_MAL'::text, 'PARTNER_AFF'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.account_roles s
          WHERE ((s.account_id = r.account_id) AND (s.role = 'SUPER'::text))))))
  GROUP BY a.email
 HAVING (bool_or(r.role = 'PAYOUT'::text) AND bool_or(r.role <> 'PAYOUT'::text));

CREATE OR REPLACE FUNCTION public.fn_role_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  r text := nullif(btrim(coalesce(current_setting('app.role_reason', true), '')), '');
  a text := current_setting('app.actor_id', true);
  who uuid := CASE WHEN a ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a::uuid END;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (NEW.account_id, NEW.role, 'GRANT', r, who);
  ELSIF TG_OP = 'DELETE' AND OLD.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (OLD.account_id, OLD.role, 'REVOKE', r, who);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

COMMENT ON FUNCTION public.fn_role_audit() IS '운영 역할(ADMIN · SUPER · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF) 주기 · 빼기를 role_changes 에 남김 — 사유 · 처리자는 같은 거래의 app.role_reason · app.actor_id(D153 · v10.163 · 역할 넓힘 D173 · v10.194). 기록은 수정 · 삭제 금지(trg_role_change_ro)';

CREATE OR REPLACE VIEW public.v_role_holders AS
 SELECT a.id AS account_id,
    a.email,
    a.name,
    string_agg(r.role, ','::text ORDER BY r.role) AS roles,
    ( SELECT max(c.changed_at) AS max
           FROM public.role_changes c
          WHERE (c.account_id = a.id)) AS last_change
   FROM (public.accounts a
     JOIN public.account_roles r ON ((r.account_id = a.id)))
  WHERE (r.role = ANY (ARRAY['ADMIN'::text, 'SUPER'::text, 'REVIEWER'::text, 'PAYOUT'::text, 'PARTNER_MAL'::text, 'PARTNER_AFF'::text]))
  GROUP BY a.id, a.email, a.name;

COMMENT ON VIEW public.v_duty_conflict IS '승인(ADMIN · PARTNER_MAL · PARTNER_AFF)과 지급(PAYOUT)을 겸한 사람. **0이어야 합니다** — SUPER 는 예외(D173 · v10.194)';

/* ── ② 회원 파트너 자격 ─────────────────────────────────────────────── */
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_status_check
  CHECK (status = ANY (ARRAY['APPLIED','ACTIVE','SUSPENDED','WITHDRAWN','REJECTED','NONE']));
COMMENT ON COLUMN public.partners.status IS
  '안심소개 파트너 자격 — APPLIED(심사 대기) · ACTIVE · SUSPENDED · WITHDRAWN(본인 탈퇴) · REJECTED(입점 반려, 사유는 suspended_reason) · NONE(안심 신청 없음 · 제휴만 · D173)';

ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS aff_status text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS aff_applied_at timestamptz;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS aff_approved_at timestamptz;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS aff_approved_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS aff_reason text;
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS ck_partners_aff_status;
ALTER TABLE public.partners ADD CONSTRAINT ck_partners_aff_status
  CHECK (aff_status IS NULL OR aff_status = ANY (ARRAY['APPLIED','ACTIVE','SUSPENDED','WITHDRAWN','REJECTED']));
COMMENT ON COLUMN public.partners.aff_status IS
  '제휴 파트너 자격(D173 · v10.194) — NULL(신청 없음) · APPLIED · ACTIVE · SUSPENDED · WITHDRAWN · REJECTED(사유는 aff_reason). 안심소개 자격(status)과 따로';
CREATE INDEX IF NOT EXISTS idx_partners_aff_status ON public.partners(aff_status) WHERE aff_status IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_partner_aff_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.aff_status IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.aff_status END) THEN RETURN NEW; END IF;
  IF NEW.aff_status = 'ACTIVE' THEN
    IF NEW.aff_approved_by IS NULL OR NEW.aff_approved_at IS NULL THEN
      RAISE EXCEPTION 'PARTNER: 제휴 승인자와 승인 시각이 필요합니다 — 누가 들여보냈는지 남아야 합니다';
    END IF;
    IF NOT public.fn_actor_ok(NEW.business_id) THEN
      RAISE EXCEPTION 'PERM: 본인인증(개인) 또는 사업자 인증을 마친 계정만 제휴 파트너로 활동할 수 있습니다';
    END IF;
  END IF;
  IF NEW.aff_status IN ('SUSPENDED','REJECTED') AND coalesce(btrim(NEW.aff_reason), '') = '' THEN
    RAISE EXCEPTION 'PARTNER: 제휴 정지 · 반려에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_aff_guard ON public.partners;
CREATE TRIGGER trg_partner_aff_guard BEFORE INSERT OR UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.fn_partner_aff_guard();

/* 기존 줄 — 지금 상태를 제휴 칸에 복사(한 번만 · aff_status 가 빈 줄만). 규칙에 걸리는 줄은 건너뜀 */
DO $$
DECLARE p record; n int := 0; skipped int := 0;
BEGIN
  FOR p IN SELECT id FROM public.partners WHERE aff_status IS NULL AND status <> 'NONE' LOOP
    BEGIN
      UPDATE public.partners
         SET aff_status = status, aff_applied_at = applied_at,
             aff_approved_at = approved_at, aff_approved_by = approved_by, aff_reason = suspended_reason
       WHERE id = p.id;
      n := n + 1;
    EXCEPTION WHEN raise_exception OR check_violation THEN
      skipped := skipped + 1;
      RAISE NOTICE 'D173: 파트너 % 는 제휴 칸을 채우지 못해 비워 둠(%)', p.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'D173: 제휴 칸 복사 %줄 · 건너뜀 %줄', n, skipped;
END $$;

/* 파일 열람 — 제휴 홍보 자료 · 안내는 제휴 자격(aff_status)으로 · 파트너 담당 역할은 자기 쪽 서류만 */
CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
 RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE
  f public.files;
  v_partner boolean;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = p_file;
  IF f.id IS NULL OR f.status <> 'READY' OR p_account IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  IF f.owner_account_id = p_account THEN RETURN 'OK'; END IF;
  /* 심사 · 심의하는 사람 */
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN RETURN 'OK'; END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;

  IF f.purpose = 'MARKETING_MATERIAL'
     AND EXISTS (SELECT 1 FROM public.marketing_materials m WHERE m.file_id = f.id AND m.state = 'APPROVED')
  OR f.purpose = 'PARTNER_GUIDE'
     AND EXISTS (SELECT 1 FROM public.partner_guides g WHERE g.file_id = f.id AND g.is_active) THEN
    SELECT EXISTS (SELECT 1 FROM public.partners p JOIN public.businesses b ON b.id = p.business_id
                    WHERE b.account_id = p_account AND p.aff_status = 'ACTIVE') INTO v_partner;
    RETURN CASE WHEN v_partner THEN 'OK' ELSE 'PARTNER_ONLY' END;
  END IF;
  /* v10.31 — 공개된 매물 · 요청의 사진 */
  IF f.purpose = 'LISTING_IMAGE' AND EXISTS (
       SELECT 1 FROM public.listing_media m JOIN public.listings l ON l.id = m.listing_id
        WHERE m.file_id = f.id AND l.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  IF f.purpose = 'REQUEST_IMAGE' AND EXISTS (
       SELECT 1 FROM public.requests r WHERE r.photo_file_id = f.id AND r.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  /* 등기부 · 중개 서류는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $function$;

/* 제휴 링크 클릭 — 링크 주인의 제휴 자격(aff_status)으로 봄(전: 안심소개 자격 status · 함수 나머지는 D033 그대로) */
CREATE OR REPLACE FUNCTION public.fn_plink_click(p_code text, p_visitor_hash text)
 RETURNS TABLE(reason text, landing_url text, counted boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  v_url text;
  v_new int := 0;
BEGIN
  SELECT l.id, l.is_active, l.landing_url AS l_url,
         pt.aff_status AS partner_status, ap.status AS product_status, ap.landing_url AS p_url
    INTO r
    FROM partner_links l
    JOIN partners pt ON pt.id = l.partner_id
    LEFT JOIN affiliate_products ap ON ap.id = l.product_id
   WHERE l.code = p_code;

  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false; RETURN; END IF;
  IF NOT r.is_active THEN RETURN QUERY SELECT 'LINK_INACTIVE'::text, NULL::text, false; RETURN; END IF;
  IF r.partner_status IS DISTINCT FROM 'ACTIVE' THEN RETURN QUERY SELECT 'PARTNER_INACTIVE'::text, NULL::text, false; RETURN; END IF;
  IF r.product_status IS DISTINCT FROM 'ON_SALE' THEN
    RETURN QUERY SELECT 'PRODUCT_NOT_ON_SALE'::text, NULL::text, false; RETURN;
  END IF;
  v_url := coalesce(nullif(btrim(r.l_url), ''), r.p_url);
  IF NOT coalesce(fn_aff_safe_landing(v_url), false) THEN
    RETURN QUERY SELECT 'BAD_LANDING'::text, NULL::text, false; RETURN;
  END IF;

  IF p_visitor_hash IS NOT NULL THEN
    INSERT INTO partner_link_clicks (link_id, stat_date, visitor_hash)
    VALUES (r.id, (now() AT TIME ZONE 'Asia/Seoul')::date, p_visitor_hash)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO partner_link_stats (link_id, stat_date, clicks)
      VALUES (r.id, (now() AT TIME ZONE 'Asia/Seoul')::date, 1)
      ON CONFLICT (link_id, stat_date) DO UPDATE SET clicks = partner_link_stats.clicks + 1;
    END IF;
    /* 이틀 지난 해시는 쓸 데가 없습니다 — 이 링크 것만 지워 가볍게 */
    DELETE FROM partner_link_clicks WHERE link_id = r.id AND stat_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 1;
  END IF;

  RETURN QUERY SELECT 'OK'::text, v_url, v_new > 0;
END $function$;
