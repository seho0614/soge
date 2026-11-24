-- =====================================================================
-- D324 (v10.710 · v10.711 · docs/818 · 819) 점검 시간 손님 미리 알림 · 페이지 게시 요청 · 승인
--
--   대표 11/24 「다음개발목록」 → 4개 모두(점검 미리 알림 · 게시 요청 · 승인 · 꾸밀 페이지 게시 전 점검 · 관 점검 기록 보고).
--   ① gwan_maintenances.notice_id · announce — 점검을 예약할 때 「손님에게 미리 알림」을 고르면 공지(notices · 상단 고정 · 끝 = 점검 끝)를 만들고
--      취소 · 지금 끝내기면 그 공지를 지금 내림(ends_at) · 「회원 알림도」면 공지 notify(기존 공지 알림 길)
--   ② page_publish_requests — ADMIN 이 초안을 다 고치면 게시 요청(꾸밀 페이지 LAYOUT · 관 안 페이지 PAGE) → SUPER 가 승인(게시) · 되돌려 보냄(사유)
--      요청 때 초안 지문(draft_sig)을 떠 둠 — 그 뒤 초안이 바뀌면 승인 막음(서버) · 같은 페이지에 열린 요청은 하나(DB)
--   권한 주소 표 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

ALTER TABLE public.gwan_maintenances ADD COLUMN IF NOT EXISTS announce boolean NOT NULL DEFAULT false;
ALTER TABLE public.gwan_maintenances ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES public.notices(id);
COMMENT ON COLUMN public.gwan_maintenances.notice_id IS 'v10.710 (D324) 손님 미리 알림 공지 — 상단 고정 · 끝 = 점검 끝 · 취소 · 지금 끝내기면 지금 내림';

CREATE TABLE IF NOT EXISTS public.page_publish_requests (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('LAYOUT', 'PAGE')),
  ref           text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 20),
  draft_sig     text NOT NULL CHECK (draft_sig ~ '^[0-9a-f]{32}$'),
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  requested_by  uuid REFERENCES public.accounts(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 300),
  CONSTRAINT page_publish_req_decided CHECK ((status = 'OPEN') = (decided_at IS NULL)),
  CONSTRAINT page_publish_req_reject CHECK (status <> 'REJECTED' OR (reason IS NOT NULL AND char_length(reason) >= 2))
);
CREATE UNIQUE INDEX IF NOT EXISTS page_publish_req_open_uq ON public.page_publish_requests (kind, ref) WHERE status = 'OPEN';
COMMENT ON TABLE public.page_publish_requests IS 'v10.711 (D324) 게시 요청 — ADMIN 요청 → SUPER 승인(게시) · 되돌려 보냄(사유) · 철회 · 같은 페이지 열린 요청 하나 · 요청 뒤 초안이 바뀌면 승인 막음(서버)';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/publish-requests', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/publish-requests', 'gwans', 'VIEW'),
  ('POST', '/admin/publish-requests', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/publish-requests', 'gwans', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/approve', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/approve', 'gwans', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/reject', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/reject', 'gwans', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/withdraw', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/publish-requests/{id}/withdraw', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
