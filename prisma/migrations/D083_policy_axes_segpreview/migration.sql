-- v10.31 (10/10 「시안 기준」 · 운영 화면 W6) — 시안 구역에 맞는 서버 자료
--   ① policy_items        — 정책 원본 표(SB-ADM-POL-010 「항목 · 내용 · 근거 · 상태」 9줄 + 미결 경고).
--                            값이 서버에 있는 항목(구독 요금 · 검수 처리 · 초과 코드)은 화면이 서버 값으로 덮어 그립니다(live_key).
--   ② gwan_axes           — 관 UI/UX 관리(SB-ADM-GWN-010 「관마다 축 · 성격 · 판정 문장 · 급구 명칭 · 규제 · 노출 · UI 유형」).
--                            축을 내리면 신규 노출만 멈춥니다 — 진행 중인 거래는 그대로(E-01 방식). 사용자 웹은 GET /gwan-axes 로 읽습니다(합칠 때 연결).
--   ③ v_segment_shift_preview — 옮길 대상 미리보기(SB-ADM-SEG-020). 옮김 · 보류(클릭 부족 · 차이 부족) 판정을 학습 실행 전에 봅니다.

/* ── ① 정책 원본 ─────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS policy_items (
  code       text PRIMARY KEY,
  title      text NOT NULL,
  content    text NOT NULL,
  basis      text,
  status     text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','PENDING')),
  pending_effect text,
  live_key   text,
  sort_order int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE policy_items IS 'v10.31 — 정책 원본(운영 「정책」 화면 표). 확정/미결 · 근거 결정 번호';
COMMENT ON COLUMN policy_items.live_key IS '서버 값으로 내용을 그리는 항목(PLANS · REVIEW_CAP · REFCODE_EXTRA) — content 는 값이 없을 때의 글';
INSERT INTO policy_items (code, title, content, basis, status, pending_effect, live_key, sort_order) VALUES
  ('FEE_BASIS',     '소개비 산정',       '요율표 없음 — 당사자 협의',                        'A-12',   'CONFIRMED', NULL, NULL, 1),
  ('DEDUCTION',     '공제',              '없음 — 소개비 전액 지급',                          'INV-9',  'CONFIRMED', NULL, NULL, 2),
  ('WITHHOLDING',   '원천징수',          '폐지 — 구독제',                                    'B-03',   'CONFIRMED', NULL, NULL, 3),
  ('CUSTODY',       '대금 수수',         '당사자 직접 — 플랫폼 미수탁(정산 승인은 정산서 확인일 뿐 자금 이동 아님)', 'INV-11', 'CONFIRMED', NULL, NULL, 4),
  ('PLANS',         '구독 요금',         'BASIC 0 · STANDARD 49,000 · PRO 149,000',          'B-13R',  'CONFIRMED', NULL, 'PLANS', 5),
  ('REFCODE_EXTRA', '초과 코드',         '건당 30,000원 정액 (거래금액 무연동)',              'B-13R',  'CONFIRMED', NULL, 'REFCODE_EXTRA', 6),
  ('REVIEW_CAP',    '검수 처리',         '1명 · 일 50건 · SLA 24시간',                       'B-09R',  'CONFIRMED', NULL, 'REVIEW_CAP', 7),
  ('REALTY_FEE',    '부동산 소개비',     '노출료 방식 — 금액 미정',                          'A-07',   'PENDING',  '부동산 노출료(A-07)는 금액이 없어 정산이 생성되지 않습니다.', NULL, 8),
  ('REQ_ATTRIB',    '소개받기 귀속 시점','수락 시점 (INV-2 예외)',                           'B-16',   'PENDING',  '소개받기 귀속 시점(B-16)은 제안 수락 화면의 문구가 확정되지 않습니다.', NULL, 9)
ON CONFLICT (code) DO NOTHING;

/* ── ② 관 축 · UI 유형 ──────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS gwan_axes (
  gwan_code    text NOT NULL REFERENCES gwans(code),
  axis_code    text NOT NULL,
  name         text NOT NULL,
  nature       text NOT NULL,
  judge        text NOT NULL,
  urgent_label text,
  regulation   text,
  is_exposed   boolean NOT NULL DEFAULT true,
  ui_type      text NOT NULL DEFAULT 'LIST' CHECK (ui_type IN ('LIST','MATCH','SERVICE','CONTENT')),
  ui_fixed     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  updated_by   uuid REFERENCES accounts(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gwan_code, axis_code)
);
COMMENT ON TABLE gwan_axes IS 'v10.31 — 관 축과 UI 유형(운영 「관 UI/UX 관리」). 거래형 축은 목록형 고정(ui_fixed). 내리면 신규 노출만 멈춤';
COMMENT ON COLUMN gwan_axes.axis_code IS '사용자 웹 축 키 — 안심소개 listing(기계 · 부동산 합본) · RE · CONSULT, 소개창업 listing · STAFF · SUPPORT · INFO';
INSERT INTO gwan_axes (gwan_code, axis_code, name, nature, judge, urgent_label, regulation, ui_type, ui_fixed, sort_order) VALUES
  ('MAL','ASSET',   '기계 · 설비 · 시설', '실물자산형', '등기 없이 실물 인도로 넘어갑니까?',              '급매 · 이전', NULL, 'LIST', true, 1),
  ('MAL','RE',      '부동산',             '등기자산형', '등기부등본이 있습니까?',                          '급매',        'A-07 법무 회신 대기', 'LIST', true, 2),
  ('MAL','CONSULT', '생활 · 금융 상담',   '상담신청형', '상담을 신청하면 인증된 업체 1곳이 연락드립니다.', NULL,          NULL, 'LIST', true, 3),
  ('BIZ','STARTUP', '창업',               '거래형',     '내일 아침 문을 열고 바로 장사가 됩니까?',         '급매 사업체', NULL, 'LIST', true, 1),
  ('BIZ','STAFF',   '인력',               '매칭형',     '고용 관계가 성립합니까?',                         '초단기 급구', '도급만 · 개인 노출 없음', 'MATCH', false, 2),
  ('BIZ','SUPPORT', '운영지원',           '서비스형',   '지속적 자문 · 수행 계약이 성립합니까?',           NULL,          NULL, 'SERVICE', false, 3),
  ('BIZ','INFO',    '정보',               '콘텐츠형',   '거래가 없습니다 — 열람과 신청만 합니다',          NULL,          NULL, 'CONTENT', false, 4)
ON CONFLICT (gwan_code, axis_code) DO NOTHING;

INSERT INTO code_labels (domain, code, label, sort_order, audience) VALUES
  ('gwan.ui_type','LIST','목록형',1,'ALL'), ('gwan.ui_type','MATCH','매칭형',2,'ALL'),
  ('gwan.ui_type','SERVICE','서비스형',3,'ALL'), ('gwan.ui_type','CONTENT','콘텐츠형',4,'ALL')
ON CONFLICT (domain, code) DO NOTHING;

/* 거래형(목록형 고정) 축의 UI 유형은 바꿀 수 없습니다 — 매물 카드 틀을 공유합니다(설계서 §3-4) */
CREATE OR REPLACE FUNCTION fn_gwan_axis_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ui_fixed AND NEW.ui_type IS DISTINCT FROM OLD.ui_type THEN
    RAISE EXCEPTION 'GWAN_AXIS: 거래형 축은 목록형으로 고정입니다 — 매물 카드 틀을 공유합니다';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gwan_axis_guard ON gwan_axes;
CREATE TRIGGER trg_gwan_axis_guard BEFORE UPDATE ON gwan_axes FOR EACH ROW EXECUTE FUNCTION fn_gwan_axis_guard();

/* ── ③ 옮길 대상 미리보기 ───────────────────────────────────── */
CREATE OR REPLACE VIEW v_segment_shift_preview AS
WITH cfg AS (
  SELECT coalesce((SELECT value FROM site_settings WHERE key = 'segment.learn.min_clicks'), '5')::int AS min_c,
         coalesce((SELECT value FROM site_settings WHERE key = 'segment.learn.ratio'), '3')::int AS ratio
), other AS (
  SELECT account_id, current_code, clicked_code, sum(clicks)::int AS clicks
    FROM v_segment_behavior WHERE clicked_code <> current_code AND NOT ambiguous
   GROUP BY 1, 2, 3
), own AS (
  SELECT account_id, sum(clicks)::int AS clicks FROM v_segment_behavior WHERE clicked_code = current_code GROUP BY 1
), best AS (
  SELECT DISTINCT ON (account_id) account_id, current_code, clicked_code, clicks FROM other ORDER BY account_id, clicks DESC
)
SELECT b.account_id, b.current_code, b.clicked_code AS to_code,
       coalesce(w.clicks, 0) AS clicks_from, b.clicks AS clicks_to,
       CASE WHEN b.clicks < cfg.min_c THEN 'HOLD_CLICKS'
            WHEN b.clicks < greatest(coalesce(w.clicks, 0) * cfg.ratio, cfg.min_c) THEN 'HOLD_RATIO'
            ELSE 'MOVE' END AS verdict,
       cfg.min_c, cfg.ratio
  FROM best b LEFT JOIN own w ON w.account_id = b.account_id CROSS JOIN cfg;
COMMENT ON VIEW v_segment_shift_preview IS 'v10.31 — 성향 학습 실행 전 미리보기(옮김 · 보류). 판정 기준은 v_segment_shift_candidates 와 같음';
