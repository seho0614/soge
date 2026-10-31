-- =====================================================================
-- D154 · 소개광장 동네 인증(GPS 1회 → 행정동만) — 꺼진 채로 (v10.164 · 2026-11-01 · sgb-core docs/253)
--   대표 결정(10/31 「GPS 동네 인증 도입」 · decisions/community-sogae-gwangjang #17 · map-kakao #16)
--   ① member_towns          회원마다 인증한 행정동 한 줄(코드 · 이름 · 인증일 · 만료일 30일) — **좌표 칸 없음**
--   ② town_verify_logs      위치정보 이용 확인 기록(누가 · 언제 · 결과 행정동 · 실패 종류) — 좌표 없음 · 지우기 금지
--   ③ v_member_town_current 만료 전 인증만(글의 「동네 인증」 배지 · 내 동네)
--   ④ 설정 community.town_verify(처음 off) — 위치기반서비스사업 신고 · 위치기반 약관 게시 뒤 SUPER 가 켬
--   ⑤ 위치기반서비스 이용약관 LOCATION 2.0 **초안**(법무 검토 전 · 〔미확정〕 있음 → 게시 막힘 TERM_HOLES) — 1.0(9/18 폐기)은 그대로
--   좌표는 서버가 카카오 「좌표 → 행정구역」 한 번에만 쓰고 저장 · 기록하지 않음. 재실행 안전 · 지우는 문장 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.member_towns (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id),
  adm_code    text NOT NULL CHECK (adm_code ~ '^[0-9]{10}$'),
  adm_name    text NOT NULL CHECK (length(adm_name) BETWEEN 2 AND 80),
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
COMMENT ON TABLE public.member_towns IS '소개광장 동네 인증 — 행정동 코드 · 이름만(좌표 없음) · 30일마다 다시(D154 · v10.164)';

CREATE TABLE IF NOT EXISTS public.town_verify_logs (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  at          timestamptz NOT NULL DEFAULT now(),
  purpose     text NOT NULL DEFAULT 'TOWN_VERIFY',
  adm_code    text,
  ok          boolean NOT NULL,
  fail_kind   text
);
CREATE INDEX IF NOT EXISTS idx_town_verify_logs ON public.town_verify_logs (account_id, at DESC);
COMMENT ON TABLE public.town_verify_logs IS '위치정보 이용 확인 기록(동네 인증 · D154) — 결과 행정동 · 실패 종류만 · 좌표 없음 · 수정 · 삭제 금지';

CREATE OR REPLACE FUNCTION public.fn_town_log_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT: 위치정보 이용 확인 기록은 수정·삭제할 수 없습니다';
END $$;
DROP TRIGGER IF EXISTS trg_town_log_ro ON public.town_verify_logs;
CREATE TRIGGER trg_town_log_ro BEFORE DELETE OR UPDATE ON public.town_verify_logs FOR EACH ROW EXECUTE FUNCTION public.fn_town_log_ro();

CREATE OR REPLACE VIEW public.v_member_town_current AS
 SELECT account_id, adm_code, adm_name, verified_at, expires_at
   FROM public.member_towns
  WHERE expires_at > now();
COMMENT ON VIEW public.v_member_town_current IS '만료 전 동네 인증(D154) — 글 배지 · 내 동네';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('community.town_verify', 'off', 'GLOBAL',
        '소개광장 동네 인증(v10.164 · docs/253) — on 이면 회원이 휴대폰 위치로 한 번 인증하고 서버는 행정동 코드 · 이름만 저장(좌표 저장 안 함 · 30일마다 다시). 위치기반서비스사업 신고와 위치기반서비스 이용약관(LOCATION) 게시 뒤에만 켜십시오(decisions/community #17).',
        false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
SELECT 'LOCATION', '2.0', '위치기반서비스 이용약관',
'# 위치기반서비스 이용약관

제1조(목적) 이 약관은 〔회사명〕(이하 「회사」)가 제공하는 소개광장 동네 인증(이하 「서비스」)의 이용 조건과 절차, 회사와 회원의 권리 · 의무를 정합니다.

제2조(서비스 내용) 회원이 동네 인증을 요청하면 회사는 회원 단말기의 위치정보를 한 번 받아 행정동(읍 · 면 · 동) 이름과 코드로 바꾸고, 위치정보(좌표)는 바꾼 즉시 파기합니다. 회사는 행정동 이름 · 코드와 인증일만 보관하며, 인증은 30일 동안 유효합니다.

제3조(이용 요금) 서비스는 무료입니다.

제4조(개인위치정보의 이용 · 보유) ① 회사는 동네 인증 목적에만 개인위치정보를 이용합니다. ② 위치정보 이용 · 제공사실 확인자료는 〔보관 기간〕 동안 보관합니다.

제5조(회원의 권리) 회원은 언제든지 동의를 철회하고 인증을 지울 수 있으며, 이용 · 제공사실 확인자료의 열람 · 고지를 요구할 수 있습니다.

제6조(위치정보관리책임자) 〔위치정보관리책임자 이름 · 연락처〕

제7조(손해배상 · 분쟁) 〔법무 검토〕

부칙 이 약관은 〔시행일〕부터 시행합니다.',
  false, 'infinity', 'DRAFT', coalesce((SELECT max(display_order) FROM public.terms WHERE code = 'LOCATION'), 90), NULL,
  '동네 인증(GPS 1회 → 행정동만 · 좌표 즉시 파기 · 30일) — 9/18 폐기한 1.0 을 대신할 새 판 초안(법무 검토 전)', false
WHERE NOT EXISTS (SELECT 1 FROM public.terms WHERE code = 'LOCATION' AND version = '2.0');
