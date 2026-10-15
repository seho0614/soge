-- =====================================================================
-- 소개뱅크 광고 플랫폼 — 스키마
--
-- 본체(sgb)에서 분리한 별도 DB 입니다.
--
-- ── 본체를 참조하지 않습니다 ────────────────────────────────────────
-- 외래키로 본체 테이블을 걸면 분리한 의미가 없습니다. 대신
-- **id 만 들고 있고 실재는 API 로 확인**합니다.
--
--   advertiser_biz_id   본체 businesses.id — FK 아님
--   account_id          본체 accounts.id  — FK 아님
--
-- 끊어진 참조가 생길 수 있으므로 v_orphan_ref 로 감시합니다.
--
-- ── 성향은 여기 없습니다 ────────────────────────────────────────────
-- 본체가 정본입니다. 복제하면 **동의를 철회했는데 광고 쪽에 남는**
-- 일이 생기고, 그건 INV-AD 위반입니다.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 자리 ────────────────────────────────────────────────────────────
CREATE TABLE ad_slots (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  placement   text NOT NULL,
  width       int, height int,
  is_active   boolean NOT NULL DEFAULT true,
  in_ranking  boolean NOT NULL DEFAULT false,
  spec        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN ad_slots.in_ranking IS
  '추천 점수에 넣는가. 인피드는 반드시 false 여야 합니다 — '
  'true 면 돈으로 순위를 사는 것이 됩니다.';

-- ── 파는 상품 ───────────────────────────────────────────────────────
CREATE TABLE ad_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_code      text NOT NULL REFERENCES ad_slots(code),
  period_unit    text NOT NULL CHECK (period_unit IN ('DAY','WEEK','MONTH')),
  list_price     bigint NOT NULL DEFAULT 0,
  is_intro_price boolean NOT NULL DEFAULT true,
  is_active      boolean NOT NULL DEFAULT true,
  note           text
);

COMMENT ON COLUMN ad_products.is_intro_price IS
  '도입가 여부. true 인 동안은 **이 값으로 수익을 계산하지 마십시오** — '
  '실측 전 추정치입니다.';

-- ── 광고주 (본체 사업자의 그림자) ───────────────────────────────────
CREATE TABLE advertisers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id        uuid NOT NULL UNIQUE,      -- 본체 businesses.id · FK 아님
  name          text NOT NULL,
  verified_at   timestamptz,               -- 본체 API 로 확인한 시각
  suspended_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE advertisers IS
  '본체 사업자의 그림자. biz_id 는 FK 가 아닙니다 — 분리한 DB 라 '
  '외래키를 걸 수 없습니다. 실재는 본체 API 로 확인하고 verified_at 에 '
  '남깁니다. 오래된 확인은 v_stale_verify 가 잡습니다.';

-- ── 예약 ────────────────────────────────────────────────────────────
CREATE TABLE ad_bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_code     text NOT NULL REFERENCES ad_slots(code),
  product_id    uuid NOT NULL REFERENCES ad_products(id),
  advertiser_id uuid NOT NULL REFERENCES advertisers(id),
  period        daterange NOT NULL,
  amount        bigint NOT NULL,
  is_precontract boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 같은 자리를 같은 기간에 두 번 팔 수 없습니다.
  EXCLUDE USING gist (slot_code WITH =, period WITH &&)
);

COMMENT ON CONSTRAINT ad_bookings_slot_code_period_excl ON ad_bookings IS
  '같은 자리를 같은 기간에 두 번 팔면 한쪽은 못 나갑니다 — 환불 문제가 됩니다.';

-- ── 소재 ────────────────────────────────────────────────────────────
CREATE TABLE ad_creatives (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  slot_code      text NOT NULL REFERENCES ad_slots(code),
  advertiser_id  uuid REFERENCES advertisers(id),
  advertiser     text NOT NULL,
  category       text,
  title          text NOT NULL,
  body           text,
  cta            text,
  landing_url    text,
  image_key      text,
  segments       text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
  is_regulated   boolean NOT NULL DEFAULT false,
  review_no      text,
  review_confirmed_at timestamptz,
  starts_at      date, ends_at date,
  impressions    bigint NOT NULL DEFAULT 0,
  clicks         bigint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN ad_creatives.is_regulated IS
  '의료·보험 등 심의 대상. true 면 review_no 없이 나갈 수 없습니다.';

-- ── 노출·클릭 ───────────────────────────────────────────────────────
CREATE TABLE ad_events (
  id          bigserial PRIMARY KEY,
  creative_id uuid NOT NULL REFERENCES ad_creatives(id),
  slot_code   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('IMPRESSION','CLICK')),
  account_id  uuid,                       -- 본체 accounts.id · FK 아님
  segment     text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_events_day ON ad_events(occurred_at, kind);
CREATE INDEX idx_ad_events_acct ON ad_events(account_id, occurred_at)
  WHERE account_id IS NOT NULL;

COMMENT ON TABLE ad_events IS
  '과금 근거입니다. 수정·삭제되지 않습니다 — 광고주가 청구서를 '
  '따질 때 이것이 유일한 근거입니다.';

-- ── 설정 ────────────────────────────────────────────────────────────
CREATE TABLE ad_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text
);

INSERT INTO ad_settings (key, value, description) VALUES
 ('daily_cap_per_user', '12',
  '1인당 하루 노출 상한. 커머스 목록이 12회 내외이고, 넘으면 목록을 피합니다.'),
 ('infeed_every', '8', '목록 몇 건마다 광고 1개를 넣는지.'),
 ('infeed_max_per_view', '3', '한 번 스크롤에 보이는 인피드 최대 개수.'),
 ('core_api_base', 'http://localhost:3000/api/v1',
  '본체 API 주소. 성향과 사업자 실재를 여기서 확인합니다.'),
 ('verify_ttl_hours', '24',
  '광고주 실재 확인의 유효 시간. 넘으면 다시 물어봅니다 — '
  '휴폐업한 곳의 광고가 계속 나가면 안 됩니다.');
