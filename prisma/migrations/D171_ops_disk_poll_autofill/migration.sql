-- =====================================================================
-- D171 (v10.182 · docs/285) — 서버 디스크 지켜보기 · 메인 투표 자동 채우기
--
--   ① 설정 ops.disk_warn_pct 85 — 디스크가 이만큼 차면 운영 알림 DISK_LOW(WARN · 95% 넘으면 CRITICAL · 0 이면 끔)
--   ② 설정 poll.home_autofill on — 메인 「이건 어때?」 종류마다 고른 투표(show_on_home)가 없으면 운영이 만든 최근 열린 투표로 채움
--   ③ v_poll_home 다시 정의 — 칸은 그대로(id · kind · title · description · image · sort · ends_at · opened_at)
--      고른 투표가 늘 먼저 · 자동 채우기는 운영이 만든 투표(source ADMIN)만 · 회원 투표는 메인에 나가지 않음(D166 그대로)
--
--   지우는 문장 없음.
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.disk_warn_pct', '85', 'ADMIN',
   '서버 디스크 지켜보기(v10.182 · docs/285) — 디스크가 이 % 이상 차면 운영 알림 DISK_LOW(하루 한 번 · 95% 이상은 CRITICAL). 0 이면 끔.',
   false, '^([0-9]|[1-9][0-9])$', '85'),
  ('poll.home_autofill', 'on', 'ADMIN',
   '메인 「이건 어때?」 자동 채우기(v10.182) — on 이면 종류마다 「메인에 내기」를 고른 투표가 없을 때 운영이 만든 최근 열린 투표로 채움. off 면 그 자리는 「준비 중」.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.v_poll_home AS
SELECT DISTINCT ON (p.kind) p.id, p.kind, p.title, p.description, p.image, p.sort, p.ends_at, p.opened_at
  FROM polls p
 WHERE p.state = 'OPEN' AND (p.ends_at IS NULL OR p.ends_at > now())
   AND (p.show_on_home
        OR (p.source = 'ADMIN'
            AND coalesce((SELECT s.value FROM site_settings s WHERE s.key = 'poll.home_autofill'), 'on') = 'on'))
 ORDER BY p.kind, p.show_on_home DESC, p.sort, p.opened_at DESC NULLS LAST, p.created_at DESC;
COMMENT ON VIEW public.v_poll_home IS
  '메인 「이건 어때?」에 낼 투표 — 종류(VS · ASK · USED)마다 열린 것 1건(D021). v10.182 (D171) — 「메인에 내기」 고른 것이 먼저 · 없으면 poll.home_autofill(on)일 때 운영이 만든(source ADMIN) 최근 열린 투표로 채움.';
