-- =====================================================================
-- D029 — 금칙어 같은 줄 정리 + 유일 규칙 (G-203 · 2026-10-08 「이번 판에서 고침」 · v10.26)
--
--   공격 점검(scripts/attack-check.sh G-02)이 「100% 성공」 금칙어를 `ON CONFLICT DO NOTHING` 으로 넣는데,
--   banned_words 에는 유일 규칙이 id 하나뿐이라 충돌이 나지 않아 **돌 때마다 한 줄씩 늘었습니다**(개발 DB 422줄).
--   기준선(B900)이 그 DB 에서 만들어져 새로 설치한 DB 에도 422줄이 들어갑니다.
--   검사 결과는 같지만(같은 말이 여러 번 걸림) 목록 · 운영 화면 · 검사 비용이 늘어납니다.
--
--   1) 같은 줄(말의 앞뒤 공백 · 대소문자를 뺀 것 · 맞춤 방식 · 관)이 여럿이면 가장 먼저 들어간 하나만 남깁니다.
--      켬/끔 · 세기가 다르면 남길 줄을 「켬 → BLOCK → 먼저 들어간 것」 순으로 고릅니다(더 엄한 쪽).
--   2) 유일 규칙 uq_banned_words_rule — 이제 `ON CONFLICT DO NOTHING` 이 실제로 막습니다.
--   B900 은 고치지 않습니다(적용된 마이그레이션을 바꾸면 변경 감지에 걸림) — 새로 설치해도 이 마이그레이션이 정리합니다. 재실행 안전.
-- =====================================================================
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY lower(btrim(word)), match_type, coalesce(gwan_code, '*')
           ORDER BY is_active DESC, (severity = 'BLOCK') DESC, updated_at, id) AS rn
    FROM public.banned_words)
DELETE FROM public.banned_words b USING ranked r WHERE b.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_banned_words_rule
  ON public.banned_words (lower(btrim(word)), match_type, coalesce(gwan_code, '*'));
COMMENT ON INDEX public.uq_banned_words_rule IS '같은 금칙어 줄(말 · 맞춤 방식 · 관)은 하나만 — G-203 (D029)';
