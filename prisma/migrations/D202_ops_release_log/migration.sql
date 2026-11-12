-- =====================================================================
-- D202 (v10.244 · docs/383) — 운영 적용 기록(API 가 뜰 때 판이 바뀌었으면 한 줄)
--
--   운영 판은 운영 서버 파일(~/sgb/VERSION)로만 알 수 있어, 언제 어떤 판을 올렸는지 · 되돌렸는지가 DB 에 남지 않았습니다.
--   API 가 뜰 때 VERSION 이 가장 최근 줄과 다르면 한 줄을 적습니다 — apply.sh · rollback.sh 를 고치지 않아도
--   올림(UP) · 되돌림(BACK)이 저절로 남습니다. 같은 판으로 다시 뜨면(pm2 restart · 재부팅) 적지 않습니다.
--   첫 줄은 이 마이그레이션을 올린 판이 처음 뜰 때(FIRST). 쌓기만 하고 고치거나 지울 수 없습니다.
--   postcheck.sh 는 그대로 「읽기만」 — 운영 화면은 서버에 남은 postcheck 결과 파일을 읽어 보여 줍니다(DB 에 쓰지 않음).
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ops_release_log (
  id            bigserial PRIMARY KEY,
  version       text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 20),
  prev_version  text CHECK (prev_version IS NULL OR length(prev_version) <= 20),
  kind          text NOT NULL CHECK (kind IN ('FIRST', 'UP', 'BACK', 'OTHER')),
  host          text CHECK (host IS NULL OR length(host) <= 100),
  booted_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_release_log_at ON public.ops_release_log (booted_at DESC, id DESC);
COMMENT ON TABLE public.ops_release_log IS
  '운영 적용 기록(D202 · v10.244). API 가 뜰 때 판(VERSION)이 가장 최근 줄과 다르면 한 줄 — kind FIRST(첫 기록) · UP(올림) · BACK(되돌림) · OTHER(견줄 수 없음) · prev_version 앞 판 · host 서버 이름. 고치거나 지울 수 없습니다.';
DROP TRIGGER IF EXISTS trg_ops_release_log_ro ON public.ops_release_log;
CREATE TRIGGER trg_ops_release_log_ro BEFORE DELETE OR UPDATE ON public.ops_release_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
