-- =====================================================================
-- D309 (v10.646 · docs/791) 새 관을 끝까지 — 운영 화면에서 만든 관을 열 수 있게
--
--   대표 11/23 「신규로 추가된 관에 대한 반영을 할 수 없다 · 업종을 관에 배정할 수 없다」 → 「A + B 모두」.
--   ① gwans.intro_target — 새 관 만들기에서 고른 소개 대상(GOODS 상품 · 서비스 / ASSET 자산 · 매물 / BIZ 사업 기회)을 칸으로 둠
--      (전에는 설명 앞 글자로만 붙었음) · 처음 관 6개는 비워 둠(NULL = 정하지 않음)
--   ② fn_gwan_open_guard — 처음 여는 opened_at 은 일괄 오픈(app.opening_phase) 때만 되던 것을,
--      다른 관이 이미 운영 중(is_active)이면(오픈 뒤 새로 만든 관) 하나씩 열 수 있게 함. 나머지(폼 문구 · 승인 업종 · 리드관 법무 · 연 관 닫기 막음)는 그대로
--   ③ fn_gwan_parent_guard — 상위 관(parent_code)은 허브 관(is_hub)만 · 자기 자신 · 허브 관 자신은 상위 관을 갖지 않음
--   표 하나에 칸 하나 더함 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

ALTER TABLE public.gwans ADD COLUMN IF NOT EXISTS intro_target text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwans_intro_target_check') THEN
    ALTER TABLE public.gwans ADD CONSTRAINT gwans_intro_target_check
      CHECK (intro_target IS NULL OR intro_target IN ('GOODS', 'ASSET', 'BIZ'));
  END IF;
END $$;
COMMENT ON COLUMN public.gwans.intro_target IS 'v10.646 (D309) 소개 대상 — GOODS 상품 · 서비스 · ASSET 자산 · 매물 · BIZ 사업 기회 · 만든 뒤 바꾸지 않음(서버) · 처음 관은 NULL';

CREATE OR REPLACE FUNCTION public.fn_gwan_open_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_lead  boolean := NEW.code = 'LED';
  v_legal boolean := coalesce((SELECT value FROM public.site_settings WHERE key = 'lead.legal_ok'), 'off') = 'on';
  v_after boolean;
BEGIN
  IF NEW.is_active AND NOT coalesce(OLD.is_active, false) THEN
    IF v_lead AND NOT v_legal THEN
      RAISE EXCEPTION 'SETTING: 리드관(소개리드)은 법무 재확인 회신을 받은 뒤(설정 lead.legal_ok = on) 켤 수 있습니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.gwan_form_copy WHERE gwan_code = NEW.code) THEN
      RAISE EXCEPTION
        'NO_FORM_COPY: 등록 폼 문구가 없어 관을 열 수 없습니다. gwan_form_copy 를 먼저 채우십시오.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.categories c
       WHERE c.status = 'APPROVED'
         AND (c.gwan_code = NEW.code OR (v_lead AND c.gwan_code = 'MAL' AND c.axis = 'CONSULT'))
    ) THEN
      RAISE EXCEPTION
        'NO_APPROVED_CATEGORY: 승인된 업종이 없어 관을 열 수 없습니다.';
    END IF;
  END IF;

  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
    /* v10.646 (D309) 오픈 뒤 새로 만든 관 — 다른 관이 이미 운영 중이면 하나씩 엶(일괄 오픈은 처음 한 번뿐) */
    v_after := EXISTS (SELECT 1 FROM public.gwans o WHERE o.code <> NEW.code AND o.is_active AND NOT o.is_hub);
    IF coalesce(current_setting('app.opening_phase', true), '') <> 'on' AND NOT (v_lead AND v_legal) AND NOT v_after THEN
      RAISE EXCEPTION
        'GWAN: 관은 fn_open_phase() 로만 엽니다 — 하나씩 열면 순차가 됩니다';
    END IF;
  END IF;

  IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS NULL THEN
    RAISE EXCEPTION 'GWAN: 연 관은 닫을 수 없습니다 — 멈추시려면 is_active 를 쓰십시오';
  END IF;

  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_gwan_open_guard() IS 'v10.646 (D309) 관 방어 — is_active 켤 때 폼 문구 · 승인 업종(리드관 LED 는 안심소개 상담 축 MAL · CONSULT 업종을 셈 · lead.legal_ok = on 이어야 함) · opened_at 은 일괄 오픈 · 리드관 법무 · 다른 관이 운영 중일 때(오픈 뒤 새 관). 연 관은 닫지 않음.';

CREATE OR REPLACE FUNCTION public.fn_gwan_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_code IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_code IS DISTINCT FROM OLD.parent_code) THEN
    IF NEW.parent_code = NEW.code THEN
      RAISE EXCEPTION 'GWAN_PARENT: 관은 자기 자신을 상위 관으로 둘 수 없습니다.';
    END IF;
    IF coalesce(NEW.is_hub, false) THEN
      RAISE EXCEPTION 'GWAN_PARENT: 허브 관은 상위 관을 두지 않습니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.gwans h WHERE h.code = NEW.parent_code AND h.is_hub) THEN
      RAISE EXCEPTION 'GWAN_PARENT: 상위 관은 허브 관만 고를 수 있습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gwan_parent_guard ON public.gwans;
CREATE TRIGGER trg_gwan_parent_guard BEFORE INSERT OR UPDATE ON public.gwans
  FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_parent_guard();

-- ④ 권한 주소 표(perm_route_map) — 새 주소 · D308 에서 빠진 POST /admin/categories(GROUPS 전환 「연결 안 된 /admin 주소 0」 조건)
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('POST', '/admin/categories', 'category', 'EDIT'),
  ('POST', '/admin/categories/copy', 'category', 'EDIT'),
  ('GET', '/admin/gwans/{code}/form-copy', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwans/{code}/form-copy', 'gwans', 'VIEW'),
  ('PUT', '/admin/gwans/{code}/form-copy/{role}', 'gwan-ux', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- ⑤ 4관 고정 풀기 — 새 관도 저장한 검색 · 로그인 뒤 첫 화면에 쓸 수 있게(관 코드 무늬 = gwans_code_check 와 같은 3 ~ 4자 · 있는 관인지는 서버가 봄)
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.lsx_saved_searches'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%MNY|MAL|BIZ|HLT%' LOOP
    EXECUTE format('ALTER TABLE public.lsx_saved_searches DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lsx_saved_searches_gwan_code_fmt') THEN
    ALTER TABLE public.lsx_saved_searches ADD CONSTRAINT lsx_saved_searches_gwan_code_fmt
      CHECK (gwan_code IS NULL OR gwan_code ~ '^[A-Z]{3,4}$');
  END IF;
END $$;

UPDATE public.site_settings SET value_pattern = '^$|^[A-Z]{3,4}$'
 WHERE key = 'site.landing_after_login' AND value_pattern IS DISTINCT FROM '^$|^[A-Z]{3,4}$';
UPDATE public.site_settings SET value_pattern = '^(HERO|[A-Z]{3,4})?$'
 WHERE key = 'site.landing_new_member' AND value_pattern IS DISTINCT FROM '^(HERO|[A-Z]{3,4})?$';
