-- =====================================================================
-- D100 — v10.47 (2026-10-17 · 소개광장 › 우리동네 맛집 · docs/98)
--
--   대표 결정(2026-10-17 「추천대로」 · decisions/community-sogae-gwangjang #12 · #13)
--     자료       회원 소개 글 + 운영 동네픽(운영자가 쓴 글 = 「동네픽」 배지)
--     장소       카카오 장소에서 고른 가게 — 이름 · 분류 · 주소 · 좌표 · 카카오 ID · 장소 주소(URL)만 저장
--                (자세한 정보는 「카카오맵에서 보기」 링크 · 카카오 자료를 통째로 저장 · 재가공하지 않음)
--     정밀도     식당은 공개된 영업장 → 정확한 핀
--     위치       동네는 직접 고름 · 「현재 위치로」는 브라우저 안에서만(서버로 보내지 않음) · 설정 map.food_geolocation 처음 off
--
--   ① posts.board 에 FOOD — 소개광장 글 표를 그대로 씁니다: 금칙어 · 링크 · 도배 · 첫 글 검수 · 신고 · 댓글이 그대로 걸립니다(C810)
--      FOOD 글은 게시판을 바꿀 수 없고(트리거), 다른 글을 FOOD 로 바꿀 수도 없습니다
--   ② town_places        가게(카카오 ID 하나에 한 줄)
--   ③ town_food_posts    글 ↔ 가게 · 추천 메뉴 · 광고 · 협찬 표시
--   ④ v_town_places      공개 지도 · 목록(숨긴 가게 · 공개 안 된 글 제외 · 추천 = 공개된 소개 글 수)
--   ⑤ map.food_geolocation  「현재 위치로」 단추 — 처음 off(법률 확인 뒤 켬)
--
--   기존 기능에 영향 없음: FOOD 글은 지도 사용(map.enabled)이 켜져 있어야 쓸 수 있고(서비스),
--   소개광장 「전체」 목록 · 메인에는 섞이지 않습니다(community.service). 자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================

/* ── ① 게시판 FOOD ─────────────────────────────────────────────────── */
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_board_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_board_check CHECK (board IN ('REVIEW','TRADE','QNA','NOTICE','FOOD'));

CREATE OR REPLACE FUNCTION public.fn_post_board_lock() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.board IS DISTINCT FROM OLD.board AND (OLD.board = 'FOOD' OR NEW.board = 'FOOD') THEN
    RAISE EXCEPTION 'POST_FOOD_BOARD: 우리동네 맛집 글은 게시판을 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_post_board_lock ON public.posts;
CREATE TRIGGER trg_post_board_lock BEFORE UPDATE OF board ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.fn_post_board_lock();

/* ── ② 가게 ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.town_places (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kakao_place_id text NOT NULL,
  name           text NOT NULL,
  category       text,
  phone          text,
  road           text,
  jibun          text,
  sido           text,
  sigungu        text,
  dong           text,
  lat            numeric(9,6) NOT NULL,
  lng            numeric(9,6) NOT NULL,
  place_url      text,
  is_hidden      boolean NOT NULL DEFAULT false,
  hidden_reason  text,
  created_by     uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_town_places_kakao UNIQUE (kakao_place_id),
  CONSTRAINT ck_town_places_kakao CHECK (kakao_place_id ~ '^[0-9]{1,20}$'),
  CONSTRAINT ck_town_places_name  CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT ck_town_places_kr    CHECK (lat BETWEEN 33 AND 39 AND lng BETWEEN 124 AND 132),
  CONSTRAINT ck_town_places_url   CHECK (place_url IS NULL OR place_url ~ '^https://place\.map\.kakao\.com/'),
  CONSTRAINT ck_town_places_hide  CHECK (NOT is_hidden OR hidden_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_town_places_geo ON public.town_places (lat, lng) WHERE NOT is_hidden;
CREATE INDEX IF NOT EXISTS idx_town_places_region ON public.town_places (sido, sigungu) WHERE NOT is_hidden;
COMMENT ON TABLE public.town_places IS
  'v10.47 (docs/98) — 우리동네 맛집 가게. 카카오 장소에서 고른 것만(이름 · 분류 · 주소 · 좌표 · ID · 장소 주소). 영업장이라 정확한 좌표를 공개합니다. 운영이 숨길 수 있습니다(사유 필수).';

/* ── ③ 글 ↔ 가게 ──────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.town_food_posts (
  post_id    uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  place_id   uuid NOT NULL REFERENCES public.town_places(id),
  menu       text,
  sponsored  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_town_food_menu CHECK (menu IS NULL OR length(btrim(menu)) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_town_food_place ON public.town_food_posts (place_id, created_at DESC);
COMMENT ON COLUMN public.town_food_posts.sponsored IS
  '대가(무료 제공 · 할인 · 돈)를 받고 쓴 글이면 true — 화면에 「광고 · 협찬」 표시(추천 · 보증 심사지침). 쓴 사람이 체크합니다.';

/* FOOD 글만 가게에 붙습니다 */
CREATE OR REPLACE FUNCTION public.fn_town_food_post_guard() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = NEW.post_id AND board = 'FOOD') THEN
    RAISE EXCEPTION 'TOWN_FOOD_POST: 우리동네 맛집 글만 가게에 붙일 수 있습니다.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_town_food_post_guard ON public.town_food_posts;
CREATE TRIGGER trg_town_food_post_guard BEFORE INSERT OR UPDATE OF post_id ON public.town_food_posts
  FOR EACH ROW EXECUTE FUNCTION public.fn_town_food_post_guard();

/* ── ④ 공개 지도 · 목록 ────────────────────────────────────────────── */
CREATE OR REPLACE VIEW public.v_town_places AS
 SELECT tp.id, tp.name, tp.category, tp.road, tp.jibun, tp.sido, tp.sigungu, tp.dong,
        tp.lat, tp.lng, tp.place_url,
        count(p.id)::int AS post_count,
        count(p.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.account_roles ar
                                           WHERE ar.account_id = p.author_id AND ar.role IN ('ADMIN','SUPER')))::int AS pick_count,
        max(p.created_at) AS last_post_at
   FROM public.town_places tp
   JOIN public.town_food_posts f ON f.place_id = tp.id
   JOIN public.posts p ON p.id = f.post_id AND p.board = 'FOOD' AND p.state = 'PUBLISHED'
  WHERE NOT tp.is_hidden
  GROUP BY tp.id;
COMMENT ON VIEW public.v_town_places IS
  'v10.47 — 지도 · 목록에 나가는 가게: 숨기지 않았고 공개된 소개 글이 1건 이상. 추천 = 공개된 소개 글 수 · 동네픽 = 운영자가 쓴 글 수.';

/* ── ⑤ 「현재 위치로」 단추 — 처음 off ─────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('map.food_geolocation', 'off', 'GLOBAL',
        '우리동네 맛집의 「현재 위치로」 단추(v10.47 · docs/98). on 이면 브라우저가 휴대폰 위치로 지도만 옮깁니다 — 위치를 서버로 보내거나 저장하지 않습니다. 위치정보법 확인 뒤 켜십시오(decisions/map-kakao #10).',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
