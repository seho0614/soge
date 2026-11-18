-- v10.361 · v10.362 (docs/495 · 496) — 회원 운영 메모 · 가입 차단 목록
--   대표 11/18 「다음개발」 → ① 회원 운영 메모 ② 가입 차단 목록 ③ 탈퇴 사유 통계 ④ 역할별 「오늘 할 일」 「모두」 → 「승인 + 통과하면 병합」.
--   ① member_notes — 운영진 내부 메모(쌓기만 · 회원 화면 · 내 정보 내려받기에 안 나감)
--   ② signup_blocks — 이메일 도메인 · IP 대역 · 사람(본인인증 고유값 해시 — 회원 상세에서 등록) · 사유 필수 · 기한 · 풀기는 칸만 채움(지우기 없음)
--      signup_block_hits — 하루 · 종류마다 막힌 수(사람 정보 없음)
--   지우는 문장 없음 · 다시 돌려도 같음.

CREATE TABLE IF NOT EXISTS public.member_notes (
  id         bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 1000),
  important  boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_member_notes_account ON public.member_notes (account_id, created_at DESC);
COMMENT ON TABLE public.member_notes IS 'v10.361 (D237) 회원 운영 메모 — 운영진만(ADMIN · SUPER) · 쌓기만(고치기 · 지우기 막음) · 회원 화면 · 내 정보 내려받기에 안 나감';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_member_notes_ro' AND tgrelid = 'public.member_notes'::regclass) THEN
    CREATE TRIGGER trg_member_notes_ro BEFORE UPDATE OR DELETE ON public.member_notes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.signup_blocks (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('EMAIL_DOMAIN', 'IP_CIDR', 'PERSON')),
  value          text NOT NULL CHECK (char_length(value) BETWEEN 2 AND 100),
  label          text CHECK (label IS NULL OR char_length(label) <= 100),
  reason         text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 200),
  expires_at     timestamptz,
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  removed_by     uuid REFERENCES public.accounts(id),
  removed_reason text CHECK (removed_reason IS NULL OR char_length(removed_reason) BETWEEN 2 AND 200),
  CONSTRAINT ck_signup_blocks_removed CHECK ((removed_at IS NULL) = (removed_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_signup_blocks_active ON public.signup_blocks (kind, value) WHERE removed_at IS NULL;
COMMENT ON TABLE public.signup_blocks IS 'v10.362 (D237) 가입 차단 목록 — EMAIL_DOMAIN(소문자 도메인 · 하위 도메인도) · IP_CIDR(대역) · PERSON(본인인증 고유값 해시 · 원문 없음) · 풀기는 removed_* 만 채움(고치기 · 지우기 막음)';
COMMENT ON COLUMN public.signup_blocks.label IS '화면에 보일 이름 — PERSON 은 가린 이메일(해시 대신)';

CREATE OR REPLACE FUNCTION public.fn_signup_blocks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SIGNUP_BLOCK: 가입 차단은 지우지 않고 풀기로 남깁니다.'; END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL
     OR (NEW.kind, NEW.value, NEW.label, NEW.reason, NEW.expires_at, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM (OLD.kind, OLD.value, OLD.label, OLD.reason, OLD.expires_at, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'SIGNUP_BLOCK: 가입 차단은 풀기(한 번)만 할 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_signup_blocks_guard' AND tgrelid = 'public.signup_blocks'::regclass) THEN
    CREATE TRIGGER trg_signup_blocks_guard BEFORE UPDATE OR DELETE ON public.signup_blocks FOR EACH ROW EXECUTE FUNCTION public.fn_signup_blocks_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.signup_block_hits (
  day  date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  kind text NOT NULL CHECK (kind IN ('EMAIL_DOMAIN', 'IP_CIDR', 'PERSON')),
  n    integer NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, kind)
);
COMMENT ON TABLE public.signup_block_hits IS 'v10.362 (D237) 가입 차단에 막힌 수 — 하루 · 종류마다(사람 정보 없음)';
