-- =====================================================================
-- D329 (v10.774 ~ 783 · docs/882 ~ 891) 묶음 5 — 오픈 준비 · 페이지 더하기
--
--   대표 11/24 「목록 승인」 → 묶음 5 후보 10개 「모두 개발」.
--   ① 설정 admin.mfa_from — 운영자 2단계 인증 「이날부터 필수」(한국 날짜 · 처음 비움 = 예약 없음 · SUPER · v10.775)
--   ② 처리방침 1.2 초안 — 가장 높은 판(초안 포함) 본문에 「사이트 이용 기록」 절(A/B 쿠키 · 페이지 의견 1년 파기 · 방문 · 누름 수)을 더한 새 초안(DRAFT)
--      게시된 판은 그대로 · 이미 sgb_ab 가 든 처리방침이 있으면 건너뜀 · 1.1 초안이 게시 전이면 1.2 가 1.1 내용을 품음(v10.776)
--   ③ page_feedback.variant — 손님 한 줄 의견이 A/B 비교의 어느 판이었는지(A · B · 없음 · v10.781)
--   ④ site_layout_ab_clicks — A/B 비교 블록 누름 수(비교마다 · 판마다 · 날마다 · 개인 정보 없음 · v10.781)
--   ⑤ mall_item_layouts — 소개몰 상품 상세 분류마다 · 상품마다 덮어쓰기(초안 · 게시 · v10.780)
--   ⑥ 권한 주소 표 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('admin.mfa_from', '', 'SUPER', '운영자 2단계 인증 「이날부터 필수」(v10.775 · docs/883) — 그날(한국 날짜)부터 admin.mfa_required 가 off 여도 운영 역할 모두(ALL) · 비우면 예약 없음 · 넣는 사람이 먼저 등록해야 함', false, '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$', '2026-12-15')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.page_feedback ADD COLUMN IF NOT EXISTS variant text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_feedback_variant_check') THEN
    ALTER TABLE public.page_feedback ADD CONSTRAINT page_feedback_variant_check CHECK (variant IS NULL OR variant IN ('A', 'B'));
  END IF;
END $$;
COMMENT ON COLUMN public.page_feedback.variant IS 'v10.781 (D329) A/B 비교 판(꾸밀 페이지 · 방문자 쿠키 sgb_ab) — 없으면 비교 밖';

CREATE TABLE IF NOT EXISTS public.site_layout_ab_clicks (
  ab_id    bigint NOT NULL REFERENCES public.site_layout_ab(id),
  variant  text NOT NULL CHECK (variant IN ('A', 'B')),
  day      date NOT NULL,
  clicks   integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (ab_id, variant, day)
);
COMMENT ON TABLE public.site_layout_ab_clicks IS 'v10.781 (D329) A/B 비교 블록 누름 — 끼운 블록 안 링크 · 단추 · 같은 기기 같은 날 페이지마다 20번까지(서버 기억) · 개인 정보 없음';

CREATE TABLE IF NOT EXISTS public.mall_item_layouts (
  scope         text NOT NULL CHECK (scope IN ('CATEGORY', 'PRODUCT')),
  ref           text NOT NULL CHECK (ref ~ '^[A-Za-z0-9_.\-]{1,60}$'),
  draft         jsonb NOT NULL,
  published     jsonb,
  published_at  timestamptz,
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, ref),
  CONSTRAINT mall_item_layouts_pub CHECK ((published IS NULL) = (published_at IS NULL))
);
COMMENT ON TABLE public.mall_item_layouts IS 'v10.780 (D329) 소개몰 상품 상세 덮어쓰기 — 분류(categories.code · HLT) · 상품(hlt_products.code) · 꾸밀 페이지 MALL_ITEM 과 같은 모양 · 사용자 웹은 상품 > 분류 > 모든 상품 차례로 하나';

-- ── 처리방침 1.2 초안(v10.776 · docs/884) ───────────────────────────────
DO $$
DECLARE
  v_add text := $D329P$
## 사이트 이용 기록 (1.2 더함)

1. **화면 비교(A/B) 쿠키** — 페이지 배치를 두 가지로 비교할 때 방문하신 브라우저에 「sgb_ab」 쿠키(값 a 또는 b)를 **90일** 동안 둡니다. 어떤 화면을 보여 드릴지 고르는 데만 쓰며, 이름 · 연락처 · 계정 등 개인을 알아볼 수 있는 정보는 담지 않습니다. 브라우저 설정에서 쿠키를 지우거나 막을 수 있고, 막아도 서비스 이용에는 지장이 없습니다.
2. **페이지 의견** — 「이 안내가 도움이 됐나요?」에 답하시면 답(도움됨 · 아님), 한 줄 의견(200자까지), 같은 기기의 거듭된 답을 막기 위한 기기 구분 값(접속 주소 · 브라우저 정보 · 날짜를 한 방향으로 바꾼 16자리 값 — 원래 값으로 되돌릴 수 없음)을 저장합니다. **1년이 지나면 자동으로 파기**합니다. 한 줄 의견에는 개인정보를 적지 말아 주십시오.
3. **페이지 방문 수 · 누름 수** — 페이지별 · 날짜별 방문 수와 안내 블록 누름 수를 셉니다. 개인을 알아볼 수 있는 정보는 저장하지 않습니다.

- 1.2 (〔시행일〕) — 화면 비교 쿠키 · 페이지 의견(1년 파기) · 방문 · 누름 수
$D329P$;
  r record; v_ver text; v_body text; n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.terms WHERE code = 'PRIVACY' AND body LIKE '%sgb_ab%') THEN
    RAISE NOTICE 'D329 처리방침에 이미 화면 비교 쿠키 절이 있음 — 건너뜀';
    RETURN;
  END IF;
  SELECT * INTO r FROM public.terms WHERE code = 'PRIVACY'
   ORDER BY split_part(version, '.', 1)::int DESC, split_part(version, '.', 2)::int DESC LIMIT 1;
  IF r.code IS NULL THEN
    RAISE NOTICE 'D329 처리방침 없음 — 건너뜀';
    RETURN;
  END IF;
  v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
  WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
    v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
  END LOOP;
  n := position(E'\n## 제13조 (변경)' in r.body);
  v_body := CASE WHEN n > 0 THEN left(r.body, n) || ltrim(v_add, E'\n') || E'\n' || substr(r.body, n + 1) ELSE r.body || E'\n' || v_add END;
  INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
  VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'DRAFT', r.display_order, r.gwan_code,
          'v10.776 (D329 · docs/884) 처리방침 1.2 초안 — 바탕 판 ' || r.version || '(' || r.status || ') 에 사이트 이용 기록 절(화면 비교 쿠키 90일 · 페이지 의견 1년 파기 · 방문 · 누름 수)을 더함. 법무 확인 · 시행일 빈칸.', r.is_notice);
  RAISE NOTICE 'D329 처리방침 새 초안(DRAFT)을 넣음 — 게시된 판은 그대로';
END $$;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/mall-item-layouts', 'gwan-ux', 'VIEW'), ('GET', '/admin/mall-item-layouts', 'gwans', 'VIEW'),
  ('GET', '/admin/mall-item-layouts/{scope}/{ref}', 'gwan-ux', 'VIEW'), ('GET', '/admin/mall-item-layouts/{scope}/{ref}', 'gwans', 'VIEW'),
  ('PUT', '/admin/mall-item-layouts/{scope}/{ref}', 'gwan-ux', 'EDIT'), ('PUT', '/admin/mall-item-layouts/{scope}/{ref}', 'gwans', 'EDIT'),
  ('POST', '/admin/mall-item-layouts/{scope}/{ref}/publish', 'gwan-ux', 'EDIT'), ('POST', '/admin/mall-item-layouts/{scope}/{ref}/publish', 'gwans', 'EDIT'),
  ('DELETE', '/admin/mall-item-layouts/{scope}/{ref}/publish', 'gwan-ux', 'EDIT'), ('DELETE', '/admin/mall-item-layouts/{scope}/{ref}/publish', 'gwans', 'EDIT'),
  ('GET', '/admin/hlt-carriers', 'hlt-orders', 'VIEW'),
  ('PUT', '/admin/hlt-carriers/{name}', 'hlt-orders', 'EDIT'),
  ('POST', '/admin/hlt-carriers/{name}/check', 'hlt-orders', 'EDIT'),
  ('GET', '/admin/integration-keys/pg-readiness', 'integrations', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
