-- =====================================================================
-- 10. LEAD — 리드관 (파트너센터 이관). 소비자 개인정보 격리
-- =====================================================================

CREATE TABLE lead_services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id),
  category_id   uuid NOT NULL REFERENCES categories(id),
  name          text NOT NULL,
  intake_type   text NOT NULL CHECK (intake_type IN
                  ('MATRIX','CONTRACT','PAYMENT','REGULATED')),
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                  ('DRAFT','IN_REVIEW','PUBLISHED','REJECTED','SUSPENDED')),
  layout_blocks jsonb,                   -- 12블록 상세페이지 빌더
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_grade_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id),
  grade_code  text NOT NULL CHECK (grade_code ~ '^[A-H]$'),   -- 8등급
  min_score   numeric(6,2) NOT NULL,
  view_price  numeric(14,0) NOT NULL,     -- 확인비용
  effective_from timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, grade_code, effective_from)
);

CREATE TABLE leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_service_id uuid NOT NULL REFERENCES lead_services(id),
  category_id   uuid NOT NULL REFERENCES categories(id),
  region_code   text REFERENCES regions(code),
  -- INV-12 전제: 알림톡/SMS 검증 결과. 미연동 시 UNVERIFIED 로 남는다
  phone_verified boolean NOT NULL DEFAULT false,
  booking_confirmed boolean NOT NULL DEFAULT false,
  grade_code    text CHECK (grade_code ~ '^[A-H]$'),
  score         numeric(6,2),
  view_price    numeric(14,0),
  status        text NOT NULL DEFAULT 'NEW' CHECK (status IN
                  ('NEW','ASSIGNED','VIEWED','REJECT_REQUESTED','REJECTED','CLOSED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_service ON leads(lead_service_id, status, created_at DESC);
COMMENT ON COLUMN leads.grade_code IS
  'R-04 미연동 시 phone_verified=false 로 등급이 기본값에 고정된다. 가격 근거가 성립하지 않음을 데이터로 드러낼 것.';

CREATE TABLE lead_purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id),
  business_id   uuid NOT NULL REFERENCES businesses(id),
  ledger_entry_id bigint REFERENCES ledger_entries(id),   -- LEAD_VIEW 차감
  price         numeric(14,0) NOT NULL,
  purchased_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, business_id)
);

CREATE TABLE lead_rejections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  reason_code text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'REQUESTED'
                CHECK (status IN ('REQUESTED','ACCEPTED','DENIED')),
  decided_by  uuid REFERENCES accounts(id),
  decided_at  timestamptz,
  refund_ledger_entry_id bigint REFERENCES ledger_entries(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_performance_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id),
  business_id  uuid NOT NULL REFERENCES businesses(id),
  outcome      text NOT NULL CHECK (outcome IN ('CONTRACTED','FAILED','PENDING')),
  amount       numeric(14,0),
  reported_at  timestamptz NOT NULL DEFAULT now(),
  consumer_confirmed_at timestamptz     -- R-09: 소비자 확인 절차
);

-- 소비자 개인정보. 별도 스키마 + 암호화 + 파기 기한
CREATE TABLE pii.lead_contacts (
  lead_id       uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  name_enc      bytea NOT NULL,
  phone_enc     bytea NOT NULL,
  address_enc   bytea,
  memo_enc      bytea,
  consent_id    uuid NOT NULL,              -- 개인정보 제공 동의 (A-00R 근거)
  retention_until date NOT NULL,            -- 파기 배치 기준일
  created_at    timestamptz NOT NULL DEFAULT now(),
  purged_at     timestamptz
);
CREATE INDEX idx_pii_retention ON pii.lead_contacts(retention_until)
  WHERE purged_at IS NULL;

CREATE TABLE pii.consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key  text NOT NULL,               -- 소비자 식별 해시
  purpose      text NOT NULL,
  third_party  text,                        -- 제공받는 자
  agreed_at    timestamptz NOT NULL DEFAULT now(),
  retention_months int NOT NULL,
  ip           inet,
  evidence     jsonb
);
CREATE TRIGGER trg_consents_ro BEFORE UPDATE OR DELETE ON pii.consents
  FOR EACH ROW EXECUTE FUNCTION fn_block_write();
