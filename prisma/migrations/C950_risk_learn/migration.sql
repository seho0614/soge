-- =====================================================================
-- C950_risk_learn  ·  위험감지 오탐 학습
--
-- ── 사장님 지시 (2026-09-23) ────────────────────────────────────────
--   분류·성향처럼 위험감지도 스스로 고쳐지게 합니다.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────
--   `risk_alerts.state` 에 FALSE_POSITIVE 가 있고
--   `risk_rules.false_positive` 에 "이런 경우도 있습니다" 가
--   적혀 있는데 — **둘 다 쓰이지 않습니다.**
--
--   운영이 "이건 정상" 이라고 닫아도 **같은 것이 내일 또 뜹니다.**
--   그러면 사람이 경보를 안 보게 되고, 진짜 위험이 묻힙니다.
--
-- ── ★ 법이 정한 규칙은 학습하지 않습니다 ────────────────────────────
--     RSK-05  제한업종 (INV-6 · 대부업법 · 방문판매법)
--     RSK-07  광고 규제 (의료법 27조 · 표시광고법)
--
--   운영이 "정상" 이라고 해도 **열면 안 됩니다.** 사람의 판단으로
--   법을 넘을 수는 없습니다.
-- =====================================================================

-- ── ① 예외 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_exemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code   text NOT NULL REFERENCES risk_rules(code) ON DELETE CASCADE,
  subject     text NOT NULL,          -- 무엇을 예외로 두나
  reason      text NOT NULL,          -- ★ 왜 정상인지
  signals     int  NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,            -- ★ 영구 예외는 위험합니다
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES accounts(id),

  UNIQUE (rule_code, subject),
  /* 왜 정상인지 안 적으면 나중에 "이게 왜 예외지" 에 답할 수 없습니다. */
  CONSTRAINT exm_reason_check CHECK (length(btrim(reason)) >= 5),
  /* ★ 법이 정한 규칙은 예외를 둘 수 없습니다. */
  CONSTRAINT exm_law_check CHECK (rule_code NOT IN ('RSK-05','RSK-07'))
);

COMMENT ON TABLE risk_exemptions IS
  '위험 경보 예외. 운영이 "정상" 으로 닫은 것이 3회 쌓이면 여기 '
  '들어가 더 뜨지 않습니다. **RSK-05(제한업종) · RSK-07(광고 규제)는 '
  '제외** — 법이 정한 것이라 사람 판단으로 열 수 없습니다.';
COMMENT ON COLUMN risk_exemptions.expires_at IS
  '★ 예외는 기한을 둡니다. 영구 예외는 시간이 지나면 왜 뒀는지 '
  '아무도 모르게 되고, 그 사이 진짜 위험이 통과합니다.';

CREATE INDEX IF NOT EXISTS idx_exm_lookup
  ON risk_exemptions(rule_code, subject)
  WHERE revoked_at IS NULL;

-- ── ② 설정 ────────────────────────────────────────────────────────
INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('risk.learn.enabled', 'on', 'GLOBAL',
  '위험감지 오탐 학습. off 면 예외가 늘지 않고 경보가 계속 뜹니다.',
  'on', '^(on|off)$'),
 ('risk.learn.min_signals', '3', 'GLOBAL',
  '몇 번 "정상" 으로 닫아야 예외로 둘지. **1 로 두지 마십시오** — '
  '한 번 잘못 닫으면 그 위험이 영영 안 보입니다.',
  '3', '^[1-9]$'),
 ('risk.learn.expire_days', '90', 'GLOBAL',
  '예외 기한(일). 지나면 다시 경보가 뜹니다 — 상황이 바뀌었을 수 '
  '있으니 주기적으로 다시 봅니다.',
  '90', '^[0-9]{2,4}$')
ON CONFLICT (key) DO NOTHING;

-- ── ③ 학습 실행 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_risk_learn() RETURNS TABLE(
  out_rule text, out_subject text, out_signals int
) AS $$
DECLARE
  v_on   text;
  v_min  int;
  v_days int;
BEGIN
  SELECT value INTO v_on FROM site_settings WHERE key='risk.learn.enabled';
  IF coalesce(v_on,'off') <> 'on' THEN RETURN; END IF;

  SELECT coalesce(value,'3')::int  INTO v_min
    FROM site_settings WHERE key='risk.learn.min_signals';
  SELECT coalesce(value,'90')::int INTO v_days
    FROM site_settings WHERE key='risk.learn.expire_days';

  RETURN QUERY
  WITH fp AS (
    SELECT a.rule_code AS rc, a.subject AS sb, count(*)::int AS n,
           max(a.reason) AS rsn
      FROM risk_alerts a
     WHERE a.state = 'FALSE_POSITIVE'
       AND a.closed_at >= now() - interval '180 days'
       /* ★ 법이 정한 규칙은 학습하지 않습니다. */
       AND a.rule_code NOT IN ('RSK-05','RSK-07')
     GROUP BY a.rule_code, a.subject
    HAVING count(*) >= v_min
  ),
  ins AS (
    INSERT INTO risk_exemptions (rule_code, subject, reason, signals, expires_at)
    SELECT f.rc, f.sb,
           coalesce(nullif(btrim(f.rsn),''), '운영이 정상으로 판단 (사유 미기재)'),
           f.n, now() + (v_days || ' days')::interval
      FROM fp f
    ON CONFLICT (rule_code, subject) DO UPDATE
      SET signals = excluded.signals,
          expires_at = excluded.expires_at,
          revoked_at = NULL
    RETURNING rule_code, subject, signals
  )
  SELECT i.rule_code, i.subject, i.signals FROM ins i;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_risk_learn IS
  '"정상" 으로 닫힌 경보가 3회 쌓이면 예외로 둡니다. '
  '**RSK-05 · RSK-07 은 제외** — 법이 정한 것입니다. '
  '예외에는 기한이 붙습니다.';

-- ── ④ 예외 적용 ───────────────────────────────────────────────────
--
-- 경보를 만들 때 이것을 먼저 봅니다.
CREATE OR REPLACE FUNCTION fn_risk_exempted(p_rule text, p_subject text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM risk_exemptions
     WHERE rule_code = p_rule AND subject = p_subject
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now()));
$$ LANGUAGE sql STABLE;

/* 예외로 둔 것은 경보를 만들지 않습니다. */
CREATE OR REPLACE FUNCTION fn_risk_alert_guard() RETURNS trigger AS $$
BEGIN
  IF fn_risk_exempted(NEW.rule_code, NEW.subject) THEN
    /* ★ 조용히 버리지 않습니다. 예외로 걸렀다는 것을 남깁니다 —
       나중에 "왜 안 떴지" 를 추적할 수 있어야 합니다. */
    UPDATE risk_exemptions
       SET signals = signals + 1
     WHERE rule_code = NEW.rule_code AND subject = NEW.subject;
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_risk_alert_guard ON risk_alerts;
CREATE TRIGGER trg_risk_alert_guard BEFORE INSERT ON risk_alerts
  FOR EACH ROW EXECUTE FUNCTION fn_risk_alert_guard();

-- ── ⑤ 감시 ────────────────────────────────────────────────────────

/* 법이 정한 규칙에 예외가 생기면 안 됩니다. */
CREATE OR REPLACE VIEW v_risk_law_exempted AS
SELECT rule_code, subject, created_at
  FROM risk_exemptions
 WHERE rule_code IN ('RSK-05','RSK-07') AND revoked_at IS NULL;

COMMENT ON VIEW v_risk_law_exempted IS
  '법이 정한 규칙에 생긴 예외. **0이어야 합니다** — 제한업종과 '
  '광고 규제는 사람 판단으로 열 수 없습니다.';

/* 예외가 너무 많으면 규칙 자체가 잘못된 것입니다. */
CREATE OR REPLACE VIEW v_risk_overexempted AS
SELECT e.rule_code, count(*)::int AS n
  FROM risk_exemptions e
 WHERE e.revoked_at IS NULL
   AND (e.expires_at IS NULL OR e.expires_at > now())
 GROUP BY e.rule_code
HAVING count(*) >= 20;

COMMENT ON VIEW v_risk_overexempted IS
  '예외가 20건 넘는 규칙. **0이어야 합니다** — 이만큼 예외를 둬야 '
  '한다면 규칙의 조건 자체가 잘못된 것입니다. 예외를 늘리지 말고 '
  '규칙을 고치십시오.';

/* 기한 없는 예외는 시간이 지나면 왜 뒀는지 모르게 됩니다. */
CREATE OR REPLACE VIEW v_risk_exempt_forever AS
SELECT rule_code, subject, created_at
  FROM risk_exemptions
 WHERE expires_at IS NULL AND revoked_at IS NULL;

COMMENT ON VIEW v_risk_exempt_forever IS
  '기한 없는 예외. **0이어야 합니다** — 시간이 지나면 왜 뒀는지 '
  '아무도 모르고, 그 사이 진짜 위험이 통과합니다.';
