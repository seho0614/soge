-- =====================================================================
-- D201 (v10.241 · docs/381) — 대표 할 일 「직접 확인」 줄 끝남 기록
--
--   v10.240 첫 화면 「대표 할 일」 카드의 직접 확인 3줄(요금제 금액 확정 · 법무 · 세무 확인 · EBS 스냅샷 예약)은
--   DB 로 알 수 없어 늘 「직접 확인」이었습니다. SUPER 가 메모(5자 이상)와 함께 「끝남」 · 「다시 아직」을 적으면
--   가장 최근 줄이 그 항목의 상태가 됩니다. 쌓기만 하고 고치거나 지울 수 없습니다(누가 언제 무엇을 적었는지 남음).
--   적은 값을 그대로 믿습니다(실제로 끝났는지는 확인하지 않음). 처음은 비어 있음 — 모두 「직접 확인」.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS audit.owner_todo_marks (
  id          bigserial PRIMARY KEY,
  item_key    text NOT NULL CHECK (item_key IN ('plans', 'legal', 'ebs')),
  done        boolean NOT NULL,
  note        text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 500),
  marked_by   uuid NOT NULL REFERENCES public.accounts(id),
  marked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_todo_marks_item ON audit.owner_todo_marks (item_key, marked_at DESC, id DESC);
COMMENT ON TABLE audit.owner_todo_marks IS
  '대표 할 일 직접 확인 줄 기록(D201 · v10.241). item_key = plans(요금제 금액 확정) · legal(법무 · 세무 확인) · ebs(EBS 스냅샷 예약) · done = 끝남(true) · 다시 아직(false) · 가장 최근 줄이 지금 상태 · 고치거나 지울 수 없습니다.';
DROP TRIGGER IF EXISTS trg_owner_todo_marks_ro ON audit.owner_todo_marks;
CREATE TRIGGER trg_owner_todo_marks_ro BEFORE DELETE OR UPDATE ON audit.owner_todo_marks
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
