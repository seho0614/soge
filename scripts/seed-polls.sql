-- 소개광장 「이건 어때?」 — 메인의 세 장에 나가는 투표를 넣습니다 (D021 · 개발 · 시연용 시드).
--
--   질문은 2026-10-03 에 확정한 초안입니다(v10.15). 카드 그림은 주신 디자인에서 자른 것 그대로이고(로봇청소기 2대 · 쇼핑백 · 공기청정기),
--   그 그림에 맞는 질문입니다. 특정 상표 이름은 넣지 않습니다. 표 수는 0 에서 시작합니다(참여 수 = 실제 표 수).
--
--   여러 번 돌려도 같습니다.
--     1) v10.14 의 예시 문구 투표(「A 브랜드 / B 브랜드」 등)가 남아 있으면 정리합니다
--          표가 없으면 지우고, 표가 있으면 지우지 않고 「감춤」으로 돌립니다(넣은 표는 지울 수 없는 규칙 — 기록을 남깁니다).
--     2) 투표가 하나도 없었거나 1)에서 정리한 것이 있으면 새 질문 3건을 넣습니다(같은 제목이 이미 있으면 건너뜀).
--        운영이 직접 만든 투표만 있는 곳에는 아무것도 넣지 않습니다.
--   운영에서는 운영 화면 「이건 어때? 투표」에서 만듭니다 — 이 파일은 개발 · 시연용입니다.
DO $$
DECLARE
  v uuid; o record; cleaned integer := 0; was_empty boolean;
  OLD_TITLES text[] := ARRAY['둘 중 어떤 제품이 더 좋을까요?', '구매할 때 가장 중요한 기준은?', '이 제품을 사용해보신 분들의 의견을 들려주세요!'];
  T_VS   text := '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?';
  T_ASK  text := '소개받아 살 때 가장 먼저 보는 것은?';
  T_USED text := '공기청정기를 써 보신 분들의 의견을 들려주세요!';
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM polls) INTO was_empty;

  FOR o IN
    SELECT p.id, (SELECT count(*) FROM poll_votes x WHERE x.poll_id = p.id) AS votes
      FROM polls p WHERE p.title = ANY (OLD_TITLES) AND p.state <> 'HIDDEN'
  LOOP
    IF o.votes = 0 THEN
      DELETE FROM polls WHERE id = o.id;                       -- 보기도 함께 지워집니다(ON DELETE CASCADE)
    ELSE
      UPDATE polls SET state = 'HIDDEN', hidden_reason = '예시 문구 투표 — 확정한 질문으로 바꿈 (v10.15)' WHERE id = o.id;
    END IF;
    cleaned := cleaned + 1;
  END LOOP;

  IF NOT (was_empty OR cleaned > 0) THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM polls WHERE title = T_VS) THEN
    INSERT INTO polls (kind, title, sort, show_on_home) VALUES ('VS', T_VS, 1, true) RETURNING id INTO v;
    INSERT INTO poll_options (poll_id, sort, label, sub, image) VALUES
      (v, 1, '흡입력 우선', '값이 더 나가도 잘 빨아들이는 쪽', '/home/d/vs-a.png'),
      (v, 2, '가성비 우선', '기본 기능에 값이 싼 쪽', '/home/d/vs-b.png');
    UPDATE polls SET state = 'OPEN' WHERE id = v;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM polls WHERE title = T_ASK) THEN
    INSERT INTO polls (kind, title, image, sort, show_on_home) VALUES ('ASK', T_ASK, '/home/d/poll-bags.png', 2, true) RETURNING id INTO v;
    INSERT INTO poll_options (poll_id, sort, label) VALUES
      (v, 1, '가격'), (v, 2, '써 본 사람의 후기'), (v, 3, '소개한 사람에 대한 믿음'), (v, 4, '사후관리(A/S)'), (v, 5, '브랜드');
    UPDATE polls SET state = 'OPEN' WHERE id = v;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM polls WHERE title = T_USED) THEN
    INSERT INTO polls (kind, title, description, image, sort, show_on_home)
    VALUES ('USED', T_USED, '필터 값 · 소음 · 전기료 — 솔직한 의견을 기다려요.', '/home/d/poll-purifier.png', 3, true) RETURNING id INTO v;
    INSERT INTO poll_options (poll_id, sort, label) VALUES
      (v, 1, '사용 중이에요'), (v, 2, '사용해봤어요'), (v, 3, '아직 안 써봤어요');
    UPDATE polls SET state = 'OPEN' WHERE id = v;
  END IF;
END $$;
