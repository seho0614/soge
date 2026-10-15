-- =====================================================================
-- D021 — 소개광장 「이건 어때?」 투표 · 사회관계망 주소 설정 (2026-10-02 사장님 결정)
--
--   메인(「hero 페이지」)의 「이건 어때?」 3장은 눌러도 소개광장으로 갈 뿐 투표 기능이 없었습니다.
--   사회관계망 아이콘 4개도 주소가 없어 「준비 중」만 떴습니다. 둘 다 실제로 되게 합니다.
--
--   정해 주신 것
--     ① 투표는 **비로그인도 가능** — 회원은 1인 1표, 비로그인은 방문자(기기) 1표
--     ② 참여 수는 **실제 표 수**만 보여 줍니다(그림의 3,482명 등은 쓰지 않습니다)
--     ③ 사회관계망 주소는 **운영 화면에서 입력** — 넣은 아이콘만 연결, 비면 「준비 중」
--
--   투표 종류(kind) — 그림의 세 장
--     VS    비교해요            보기 2개(그림 · 이름 · 한 줄)
--     ASK   궁금해요            보기 2 ~ 8개
--     USED  써본 의견이 필요해요  보기 2 ~ 5개
--
--   막는 것은 DB 가 합니다(트리거) — API 를 거치지 않는 경로도 같은 규칙을 탑니다.
--     · 열린(OPEN) 투표 · 마감 전 · 그 투표의 보기에만 투표
--     · 회원 1인 1표 / 비로그인 방문자 1표(같은 방문자 키)
--     · 비로그인 투표는 설정 poll.guest_vote 가 on 일 때만
--     · 같은 인터넷 주소(날짜를 섞은 해시)의 비로그인 표는 투표마다 하루 poll.guest_ip_daily_limit 건까지
--     · 표가 들어온 투표는 보기를 바꾸거나 지울 수 없습니다(결과가 달라집니다)
--     · 표는 고치거나 지울 수 없습니다
--
--   개인정보 — 표에는 계정(회원일 때) · 방문자 키(쿠키 값) · 날짜를 섞은 주소 해시만 남깁니다. 주소 원문은 저장하지 않습니다.
--
--   재실행 안전.
-- =====================================================================

-- 1. 설정 ---------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('poll.guest_vote', 'on', 'GLOBAL',
   '「이건 어때?」 투표를 비로그인 방문자도 할 수 있게 할지(on/off). off 면 로그인 회원만 투표합니다.',
   false, '^(on|off)$', 'on'),
  ('poll.guest_ip_daily_limit', '5', 'GLOBAL',
   '「이건 어때?」 — 같은 인터넷 주소에서 비로그인으로 하루에 넣을 수 있는 표 수(투표 1건당). 표 부풀리기를 줄입니다.',
   false, '^[1-9][0-9]{0,2}$', '5'),
  ('sns.facebook', '', 'GLOBAL', '사회관계망 — 페이스북 계정 주소(https://…). 비우면 메인 푸터 아이콘이 「준비 중」으로 나옵니다.',
   false, '^$|^https://[^\s]{4,200}$', 'https://www.facebook.com/sogaebank'),
  ('sns.instagram', '', 'GLOBAL', '사회관계망 — 인스타그램 계정 주소(https://…). 비우면 「준비 중」.',
   false, '^$|^https://[^\s]{4,200}$', 'https://www.instagram.com/sogaebank'),
  ('sns.x', '', 'GLOBAL', '사회관계망 — 엑스(X · 옛 트위터) 계정 주소(https://…). 비우면 「준비 중」.',
   false, '^$|^https://[^\s]{4,200}$', 'https://x.com/sogaebank'),
  ('sns.youtube', '', 'GLOBAL', '사회관계망 — 유튜브 채널 주소(https://…). 비우면 「준비 중」.',
   false, '^$|^https://[^\s]{4,200}$', 'https://www.youtube.com/@sogaebank')
ON CONFLICT (key) DO NOTHING;

-- 2. 표 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.polls (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('VS','ASK','USED')),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 4 AND 80),
  description   text CHECK (description IS NULL OR length(description) <= 200),
  image         text CHECK (image IS NULL OR image ~ '^(/[A-Za-z0-9_./-]{1,200}|https://[^\s]{4,250})$'),
  state         text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','OPEN','CLOSED','HIDDEN')),
  show_on_home  boolean NOT NULL DEFAULT false,
  sort          integer NOT NULL DEFAULT 0,
  ends_at       timestamptz,
  hidden_reason text,
  created_by    uuid REFERENCES public.accounts(id),
  opened_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_polls_hidden_reason CHECK (state <> 'HIDDEN' OR length(btrim(coalesce(hidden_reason, ''))) >= 5)
);
COMMENT ON TABLE public.polls IS
  '소개광장 「이건 어때?」 투표(D021). kind — VS 비교해요 · ASK 궁금해요 · USED 써본 의견이 필요해요. 운영자가 만들고 OPEN 으로 열어야 보입니다. show_on_home 이면 메인 카드에 나옵니다(종류마다 1건).';
COMMENT ON COLUMN public.polls.image IS '카드 옆 그림(궁금해요 · 써본 의견). 사이트 안 경로(/…) 또는 https 주소.';
COMMENT ON COLUMN public.polls.show_on_home IS '메인 「이건 어때?」에 낼지. 종류(kind)마다 sort 가 가장 앞선 열린 투표 1건이 나옵니다.';

CREATE TABLE IF NOT EXISTS public.poll_options (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id    uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  sort       integer NOT NULL CHECK (sort BETWEEN 1 AND 8),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  sub        text CHECK (sub IS NULL OR length(sub) <= 40),
  image      text CHECK (image IS NULL OR image ~ '^(/[A-Za-z0-9_./-]{1,200}|https://[^\s]{4,250})$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, sort)
);
COMMENT ON TABLE public.poll_options IS '투표 보기(D021). 표가 들어온 뒤에는 바꾸거나 지울 수 없습니다(fn_poll_option_guard).';
CREATE INDEX IF NOT EXISTS ix_poll_options_poll ON public.poll_options (poll_id);

CREATE TABLE IF NOT EXISTS public.poll_votes (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id     uuid NOT NULL REFERENCES public.polls(id),
  option_id   uuid NOT NULL REFERENCES public.poll_options(id),
  account_id  uuid REFERENCES public.accounts(id),
  visitor_key text CHECK (visitor_key IS NULL OR visitor_key ~ '^[A-Za-z0-9-]{8,64}$'),
  ip_hash     text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  vote_day    date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_poll_votes_who CHECK (account_id IS NOT NULL OR visitor_key IS NOT NULL)
);
COMMENT ON TABLE public.poll_votes IS
  '투표한 표(D021). 회원은 계정 1표, 비로그인은 방문자 키(sgb_visitor 쿠키) 1표. 주소는 날짜를 섞은 해시(ip_hash)만 남깁니다 — 원문 없음. 고치거나 지울 수 없습니다.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_poll_votes_account ON public.poll_votes (poll_id, account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_poll_votes_visitor ON public.poll_votes (poll_id, visitor_key) WHERE account_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_poll_votes_option ON public.poll_votes (option_id);
CREATE INDEX IF NOT EXISTS ix_poll_votes_ip ON public.poll_votes (poll_id, ip_hash, vote_day) WHERE account_id IS NULL;

-- 3. 규칙 ---------------------------------------------------------------
/* 투표 상태 — 열 때 보기 수를 보고, 닫은 때를 남깁니다 */
CREATE OR REPLACE FUNCTION public.fn_poll_guard() RETURNS trigger AS $$
DECLARE n integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.kind IS DISTINCT FROM NEW.kind
     AND EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = NEW.id) THEN
    RAISE EXCEPTION 'POLL_LOCKED: 표가 들어온 투표는 종류를 바꿀 수 없습니다';
  END IF;
  IF NEW.state = 'OPEN' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'OPEN' OR OLD.kind IS DISTINCT FROM NEW.kind) THEN
    SELECT count(*) INTO n FROM poll_options o WHERE o.poll_id = NEW.id;
    IF NEW.kind = 'VS' AND n <> 2 THEN
      RAISE EXCEPTION 'POLL_OPTIONS: 「비교해요」는 보기가 정확히 2개여야 열 수 있습니다 (지금 %개)', n;
    ELSIF NEW.kind = 'ASK' AND (n < 2 OR n > 8) THEN
      RAISE EXCEPTION 'POLL_OPTIONS: 「궁금해요」는 보기가 2 ~ 8개여야 열 수 있습니다 (지금 %개)', n;
    ELSIF NEW.kind = 'USED' AND (n < 2 OR n > 5) THEN
      RAISE EXCEPTION 'POLL_OPTIONS: 「써본 의견이 필요해요」는 보기가 2 ~ 5개여야 열 수 있습니다 (지금 %개)', n;
    END IF;
    IF NEW.ends_at IS NOT NULL AND NEW.ends_at <= now() THEN
      RAISE EXCEPTION 'POLL_ENDS_AT: 마감 시각이 이미 지났습니다 — 마감을 비우거나 앞으로 잡으십시오';
    END IF;
    NEW.opened_at := coalesce(NEW.opened_at, now());
    NEW.closed_at := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state = 'DRAFT' AND OLD.state <> 'DRAFT'
     AND EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = NEW.id) THEN
    RAISE EXCEPTION 'POLL_LOCKED: 표가 들어온 투표는 준비 중으로 되돌릴 수 없습니다 — 마감하거나 감추십시오';
  END IF;
  IF NEW.state = 'CLOSED' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'CLOSED') THEN
    NEW.closed_at := now();
  END IF;
  IF NEW.state <> 'HIDDEN' THEN NEW.hidden_reason := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_guard ON public.polls;
CREATE TRIGGER trg_poll_guard BEFORE INSERT OR UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_guard();

/* 보기 — 표가 들어온 뒤에는 그대로 */
CREATE OR REPLACE FUNCTION public.fn_poll_option_guard() RETURNS trigger AS $$
DECLARE v_poll uuid := coalesce(NEW.poll_id, OLD.poll_id);
BEGIN
  IF EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = v_poll) THEN
    RAISE EXCEPTION 'POLL_LOCKED: 표가 들어온 투표는 보기를 바꿀 수 없습니다 — 새 투표를 만드십시오';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_option_guard ON public.poll_options;
CREATE TRIGGER trg_poll_option_guard BEFORE INSERT OR UPDATE OR DELETE ON public.poll_options
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_option_guard();

/* 표 — 열린 투표 · 제 보기 · 한 사람 한 표 · 비로그인 한도 */
CREATE OR REPLACE FUNCTION public.fn_poll_vote_guard() RETURNS trigger AS $$
DECLARE v_state text; v_ends timestamptz; v_limit integer; n integer;
BEGIN
  SELECT state, ends_at INTO v_state, v_ends FROM polls WHERE id = NEW.poll_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'POLL_NOT_FOUND: 없는 투표입니다';
  END IF;
  IF v_state <> 'OPEN' OR (v_ends IS NOT NULL AND v_ends <= now()) THEN
    RAISE EXCEPTION 'POLL_CLOSED: 마감된 투표입니다';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM poll_options o WHERE o.id = NEW.option_id AND o.poll_id = NEW.poll_id) THEN
    RAISE EXCEPTION 'POLL_OPTION: 이 투표의 보기가 아닙니다';
  END IF;

  NEW.vote_day := (now() AT TIME ZONE 'Asia/Seoul')::date;

  IF NEW.account_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = NEW.poll_id AND v.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'POLL_VOTED: 이미 투표하셨습니다';
    END IF;
    RETURN NEW;
  END IF;

  /* 비로그인 */
  IF coalesce((SELECT value FROM site_settings WHERE key = 'poll.guest_vote'), 'on') <> 'on' THEN
    RAISE EXCEPTION 'POLL_LOGIN: 로그인한 회원만 투표할 수 있습니다';
  END IF;
  IF EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = NEW.poll_id AND v.account_id IS NULL AND v.visitor_key = NEW.visitor_key) THEN
    RAISE EXCEPTION 'POLL_VOTED: 이미 투표하셨습니다';
  END IF;
  IF NEW.ip_hash IS NOT NULL THEN
    SELECT CASE WHEN value ~ '^[1-9][0-9]{0,2}$' THEN value::integer ELSE 5 END INTO v_limit
      FROM site_settings WHERE key = 'poll.guest_ip_daily_limit';
    v_limit := coalesce(v_limit, 5);
    SELECT count(*) INTO n FROM poll_votes v
     WHERE v.poll_id = NEW.poll_id AND v.account_id IS NULL AND v.ip_hash = NEW.ip_hash AND v.vote_day = NEW.vote_day;
    IF n >= v_limit THEN
      RAISE EXCEPTION 'POLL_IP_LIMIT: 같은 인터넷 주소에서 오늘 넣을 수 있는 표 수(%건)를 넘었습니다 — 로그인하면 투표할 수 있습니다', v_limit;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_vote_guard ON public.poll_votes;
CREATE TRIGGER trg_poll_vote_guard BEFORE INSERT ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_vote_guard();

CREATE OR REPLACE FUNCTION public.fn_poll_vote_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'POLL_VOTE_FIXED: 넣은 표는 고치거나 지울 수 없습니다';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_vote_immutable ON public.poll_votes;
CREATE TRIGGER trg_poll_vote_immutable BEFORE UPDATE OR DELETE ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_vote_immutable();

-- 4. 결과 ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_poll_result AS
SELECT o.poll_id, o.id AS option_id, o.sort, o.label, o.sub, o.image,
       (SELECT count(*) FROM poll_votes v WHERE v.option_id = o.id)::integer AS votes
  FROM poll_options o;
COMMENT ON VIEW public.v_poll_result IS '투표 보기별 실제 표 수(D021). 화면의 참여 수 · 비율은 이 값만 씁니다.';

CREATE OR REPLACE VIEW public.v_poll_home AS
SELECT DISTINCT ON (p.kind) p.id, p.kind, p.title, p.description, p.image, p.sort, p.ends_at, p.opened_at
  FROM polls p
 WHERE p.state = 'OPEN' AND p.show_on_home AND (p.ends_at IS NULL OR p.ends_at > now())
 ORDER BY p.kind, p.sort, p.opened_at DESC NULLS LAST, p.created_at DESC;
COMMENT ON VIEW public.v_poll_home IS '메인 「이건 어때?」에 낼 투표 — 종류(VS · ASK · USED)마다 열린 것 1건(D021).';
