-- ── 약관 시행일 (C910) ─────────────────────────────────────────────
--
-- ── 사장님 지시 (2026-09-22) ────────────────────────────────────────
--   약관 시행일을 **2026-11-11** 로 통일합니다.
--
-- ── 시행일이 무엇을 정하나 ──────────────────────────────────────────
--   `effective_from <= now()` 인 약관만 화면에 나갑니다.
--   그 전에는 가입 화면에 동의 항목이 뜨지 않습니다.
--
--   ★ 오픈일보다 **늦으면 안 됩니다.** 동의를 못 받은 채로 가입이
--     이루어지면 그 가입은 근거가 없습니다.
--
-- ── 본문의 〔시행일〕 도 함께 채웁니다 ───────────────────────────────
--   본문에 자리표시자가 남아 있으면 "언제부터인지 모르는 약관" 이
--   됩니다. Y-02 검정이 잡습니다.

UPDATE terms
   SET effective_from = DATE '2026-11-11',
       body = replace(body, '〔시행일〕', '2026년 11월 11일')
 WHERE status <> 'ARCHIVED';

/* 오픈일과 약관 시행일이 어긋나면 안 됩니다.
 *
 * ★ 시행일이 미래면 가입 화면에 동의 항목이 안 뜹니다.
 *   그 상태로 오픈하면 동의 없이 가입이 이루어집니다. */
CREATE OR REPLACE VIEW v_terms_not_effective AS
SELECT code, title, effective_from::date AS effective_from,
       (effective_from::date - current_date) AS days_left
  FROM terms
 WHERE status = 'PUBLISHED'
   AND is_required
   AND effective_from > now();

COMMENT ON VIEW v_terms_not_effective IS
  '아직 시행 전인 필수 약관. 오픈 전까지 **0이 되어야 합니다** — '
  '시행일이 미래면 가입 화면에 동의 항목이 뜨지 않고, 그 상태로 '
  '열면 동의 없이 가입이 이루어집니다.';
