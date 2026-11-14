-- =====================================================================
-- D215 (v10.288 · docs/413) — 감사 기록 찾기 색인
--
--   대표 승인(11/14 「백오피스 기능」 B): 위험감지 › 감사 › 「감사 기록」 찾기 키우기(사람 · 행위 · 대상 · 기간 · 100줄 넘김 · 상세 · CSV).
--   전에는 사람(actor) · 대상(target) 색인만 있어 기간 · 행위로 찾으면 표 전체를 읽었음.
--   ① ix_audit_logs_at — 기간 · 최근 순
--   ② ix_audit_logs_action — 행위(정확 · 앞부분) + 최근 순
--   표 · 기록은 그대로(쌓기만). 지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE INDEX IF NOT EXISTS ix_audit_logs_at ON audit.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit.audit_logs (action text_pattern_ops, occurred_at DESC);
