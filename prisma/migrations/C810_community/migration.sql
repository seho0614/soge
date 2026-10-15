-- =====================================================================
-- C810_community  ·  커뮤니티 · AI 자동 분류
--
-- ── 사장님 결정 (2026-09-18) ────────────────────────────────────────
--   ① 커뮤니티 필요  ② **전체 공개**  ③ AI 자동 분류
--
-- ── 전체 공개는 막을 것이 많습니다 ──────────────────────────────────
-- 사업자 인증을 요구하면 스팸이 거의 없지만, 전체 공개면 **첫날부터
-- 광고 글이 올라옵니다.** 다섯 겹으로 막습니다.
--   ① 금칙어  ② 링크 제한  ③ 도배 제한  ④ 첫 글 검수  ⑤ 신고
-- =====================================================================

CREATE TABLE IF NOT EXISTS posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board         text NOT NULL,
  author_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  deal_id       uuid REFERENCES deals(id),
  state         text NOT NULL DEFAULT 'PENDING',
  views         int  NOT NULL DEFAULT 0,
  comment_count int  NOT NULL DEFAULT 0,
  report_count  int  NOT NULL DEFAULT 0,
  is_pinned     boolean NOT NULL DEFAULT false,
  /* 왜 그렇게 분류됐는지 남깁니다 — 설명할 수 없으면 고칠 수도 없습니다 */
  classified_by  text,
  classify_score int,
  classify_terms text[],
  hidden_at     timestamptz,
  hidden_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posts_board_check CHECK (board IN ('REVIEW','TRADE','QNA','NOTICE')),
  CONSTRAINT posts_state_check CHECK (state IN ('PENDING','PUBLISHED','HIDDEN','DELETED')),
  CONSTRAINT posts_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 100),
  CONSTRAINT posts_body_check CHECK (length(btrim(body)) BETWEEN 10 AND 10000),
  CONSTRAINT posts_classified_check CHECK (classified_by IS NULL OR classified_by IN ('USER','AI')),
  /* 소개 후기는 거래 기록이 있어야 합니다 */
  CONSTRAINT posts_review_check CHECK (board <> 'REVIEW' OR deal_id IS NOT NULL)
);

COMMENT ON TABLE posts IS
  '커뮤니티 글. **전체 공개**라 첫 글은 검수를 거칩니다. 소개 후기는 '
  '거래 기록이 있어야 합니다 — 거래도 안 한 사람의 후기가 가장 나쁜 광고입니다.';

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, created_at DESC)
  WHERE state = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES post_comments(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  body         text NOT NULL,
  state        text NOT NULL DEFAULT 'PUBLISHED',
  report_count int NOT NULL DEFAULT 0,
  hidden_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comments_state_check CHECK (state IN ('PUBLISHED','HIDDEN','DELETED')),
  CONSTRAINT comments_body_check CHECK (length(btrim(body)) BETWEEN 2 AND 2000)
);

COMMENT ON TABLE post_comments IS
  '댓글. **대댓글은 1단계까지**입니다 — 더 깊으면 화면에서 읽기 어렵습니다.';

CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at);

-- ── 분류 어휘 ──────────────────────────────────────────────────────
--
-- ★ `classify_vocab` 은 **업종**을 분류합니다. 여기는 **글의 성격**을
--   봅니다 — 어휘가 달라 표를 따로 둡니다.
CREATE TABLE IF NOT EXISTS board_classify_vocab (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board     text NOT NULL,
  term      text NOT NULL,
  weight    int  NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  note      text,
  UNIQUE (board, term),
  CONSTRAINT bcv_board_check CHECK (board IN ('REVIEW','TRADE','QNA')),
  CONSTRAINT bcv_weight_check CHECK (weight BETWEEN 1 AND 10)
);

COMMENT ON TABLE board_classify_vocab IS
  '게시판 분류 어휘. **학습이 아니라 어휘 관리**입니다 — 고치면 다음 '
  '글부터 바뀌고, 왜 그렇게 됐는지 설명할 수 있습니다.';

INSERT INTO board_classify_vocab (board, term, weight, note) VALUES
 ('QNA','나요',5,'질문 어미'), ('QNA','인가요',5,NULL), ('QNA','할까요',5,NULL),
 ('QNA','되나요',5,NULL), ('QNA','있나요',5,NULL), ('QNA','어떻게',4,NULL),
 ('QNA','방법',2,NULL), ('QNA','문의',4,NULL), ('QNA','궁금',4,NULL),
 ('QNA','알려주',4,NULL), ('QNA','?',2,'물음표'), ('QNA','가능한가',3,NULL),
 ('QNA','뭔가요',3,NULL), ('QNA','언제',2,NULL), ('QNA','얼마',2,NULL),
 ('QNA','누가',3,NULL), ('QNA','무엇',3,NULL), ('QNA','어디',3,NULL),
 ('QNA','왜',2,NULL), ('QNA','맞나',4,NULL), ('QNA','아시는',4,NULL),
 ('QNA','여쭤',5,NULL), ('QNA','질문',5,NULL),

 ('REVIEW','받았습니다',3,'후기 종결'), ('REVIEW','성사',3,NULL),
 ('REVIEW','체결',3,NULL), ('REVIEW','소개비',3,NULL), ('REVIEW','후기',4,NULL),
 ('REVIEW','감사',2,NULL), ('REVIEW','덕분에',3,NULL), ('REVIEW','처음으로',2,NULL),
 ('REVIEW','거래를 마',3,NULL), ('REVIEW','정산',2,NULL), ('REVIEW','만원 받',3,NULL),
 ('REVIEW','연결해',2,NULL), ('REVIEW','소개했',3,NULL),

 ('TRADE','시세',3,'업종 이야기'), ('TRADE','권리금',3,NULL), ('TRADE','요즘',2,NULL),
 ('TRADE','업계',3,NULL), ('TRADE','동향',3,NULL), ('TRADE','매출',2,NULL),
 ('TRADE','창업',2,NULL), ('TRADE','상권',3,NULL), ('TRADE','임대료',3,NULL),
 ('TRADE','전망',3,NULL), ('TRADE','추세',3,NULL), ('TRADE','분석',2,NULL),
 ('TRADE','공유합니다',2,NULL), ('TRADE','경험상',2,NULL)
ON CONFLICT (board, term) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_classify_board(p_title text, p_body text)
RETURNS TABLE(board text, score int, matched text[]) AS $$
  SELECT v.board, sum(v.weight)::int,
         array_agg(v.term ORDER BY v.weight DESC)
    FROM board_classify_vocab v
   WHERE v.is_active
     AND position(lower(v.term) in lower(coalesce(p_title,'') || ' ' || coalesce(p_body,''))) > 0
   GROUP BY v.board
   ORDER BY sum(v.weight) DESC
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_classify_board IS
  '본문으로 게시판을 고릅니다. 점수가 낮거나 1·2등이 비슷하면 '
  '**작성자에게 묻습니다** — 억지로 분류하면 "내 글이 왜 저기 있냐" 가 나옵니다.';

CREATE OR REPLACE FUNCTION fn_classify_board_auto(p_title text, p_body text)
RETURNS TABLE(board text, score int, matched text[], confident boolean) AS $$
DECLARE r1 record; r2 record;
BEGIN
  SELECT * INTO r1 FROM fn_classify_board(p_title, p_body) LIMIT 1;
  IF r1 IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0, NULL::text[], false;
    RETURN;
  END IF;
  SELECT * INTO r2 FROM fn_classify_board(p_title, p_body) OFFSET 1 LIMIT 1;
  RETURN QUERY SELECT r1.board, r1.score, r1.matched,
    (r1.score >= 5 AND (r2 IS NULL OR r1.score - r2.score >= 3));
END $$ LANGUAGE plpgsql STABLE;

-- ── 막는 트리거 ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_post_guard() RETURNS trigger AS $$
DECLARE v_joined timestamptz; v_cnt int; v_first boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  IF NEW.board = 'NOTICE' THEN
    IF NOT EXISTS (SELECT 1 FROM account_roles
                    WHERE account_id = NEW.author_id AND role IN ('ADMIN','SUPER')) THEN
      RAISE EXCEPTION 'POST: 공지는 운영만 쓸 수 있습니다';
    END IF;
    NEW.state := 'PUBLISHED';
    RETURN NEW;
  END IF;

  SELECT created_at INTO v_joined FROM accounts WHERE id = NEW.author_id;

  /* ★ 스팸의 목적은 링크입니다. 링크가 없으면 도배할 이유가 줄어듭니다. */
  IF v_joined > now() - interval '7 days'
     AND (NEW.body ~* 'https?://' OR NEW.title ~* 'https?://') THEN
    RAISE EXCEPTION 'POST: 가입 7일 뒤부터 링크를 넣으실 수 있습니다';
  END IF;

  SELECT count(*) INTO v_cnt FROM posts
   WHERE author_id = NEW.author_id AND created_at > now() - interval '1 day';
  IF v_cnt >= 5 THEN
    RAISE EXCEPTION 'POST: 하루에 5개까지 쓰실 수 있습니다';
  END IF;

  IF EXISTS (SELECT 1 FROM posts
              WHERE author_id = NEW.author_id
                AND created_at > now() - interval '1 day'
                AND lower(btrim(body)) = lower(btrim(NEW.body))) THEN
    RAISE EXCEPTION 'POST: 방금 쓰신 글과 같습니다';
  END IF;

  /* ★ `deals.state` 가 아니라 **status** 입니다. 틀린 컬럼을 보면
   *   방어가 조용히 통과합니다 — 실제로 그랬습니다.
   *   소개자도 당사자입니다 — 성사시킨 사람이 후기를 못 쓰면
   *   정작 쓸 사람이 없습니다. */
  IF NEW.board = 'REVIEW' THEN
    IF NOT EXISTS (
      SELECT 1 FROM deals d
       WHERE d.id = NEW.deal_id
         AND (d.buyer_account_id = NEW.author_id
           OR d.seller_account_id = NEW.author_id
           OR d.introducer_account_id = NEW.author_id)
         AND d.status IN ('CONFIRMED','FULFILLED','CLOSED')) THEN
      RAISE EXCEPTION 'POST: 성사된 거래에 대해서만 후기를 쓰실 수 있습니다';
    END IF;
  END IF;

  /* ★ 첫 글은 한 번만 사람이 봅니다. 그 뒤로는 신고가 들어올 때만. */
  SELECT NOT EXISTS (SELECT 1 FROM posts
                      WHERE author_id = NEW.author_id AND state = 'PUBLISHED')
    INTO v_first;
  NEW.state := CASE WHEN v_first THEN 'PENDING' ELSE 'PUBLISHED' END;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_guard ON posts;
CREATE TRIGGER trg_post_guard BEFORE INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION fn_post_guard();

CREATE OR REPLACE FUNCTION fn_comment_count() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET comment_count = (
    SELECT count(*) FROM post_comments
     WHERE post_id = coalesce(NEW.post_id, OLD.post_id) AND state = 'PUBLISHED')
   WHERE id = coalesce(NEW.post_id, OLD.post_id);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_count ON post_comments;
CREATE TRIGGER trg_comment_count AFTER INSERT OR UPDATE OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION fn_comment_count();

CREATE OR REPLACE FUNCTION fn_comment_depth() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM post_comments WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'POST: 대댓글은 1단계까지입니다 — 더 깊으면 읽기 어렵습니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_depth ON post_comments;
CREATE TRIGGER trg_comment_depth BEFORE INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION fn_comment_depth();

-- ── 감시 ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_post_pending_long AS
SELECT p.id, p.board, p.title, p.created_at,
       (current_date - p.created_at::date) AS days_waiting
  FROM posts p
 WHERE p.state = 'PENDING' AND p.created_at < now() - interval '2 days';

COMMENT ON VIEW v_post_pending_long IS
  '첫 글 검수가 2일 넘게 밀린 것. **0이어야 합니다** — 밀리면 새 '
  '회원이 "글이 안 올라간다" 고 합니다.';

CREATE OR REPLACE VIEW v_post_reported AS
SELECT p.id, p.board, p.title, p.report_count, p.hidden_at
  FROM posts p
 WHERE p.report_count >= 3 AND p.state <> 'DELETED';

COMMENT ON VIEW v_post_reported IS
  '신고가 쌓인 글. **자동으로 지우지 않습니다** — 경쟁사 3명이 '
  '신고하면 정상 글이 사라집니다. 가리기만 하고 운영이 판단합니다.';

CREATE OR REPLACE VIEW v_board_misclassified AS
SELECT p.id, p.title, p.board, p.classify_score, p.classify_terms
  FROM posts p
 WHERE p.classified_by = 'AI'
   AND p.updated_at > p.created_at + interval '1 minute';

COMMENT ON VIEW v_board_misclassified IS
  'AI 분류 뒤 작성자가 바꾼 글. **쌓이면 어휘를 고칩니다** — '
  '작성자가 바꿨다는 것은 AI 가 틀렸다는 뜻입니다.';

CREATE OR REPLACE VIEW v_post_spam_suspect AS
SELECT p.author_id, count(*) AS posts_today,
       count(*) FILTER (WHERE p.body ~* 'https?://') AS with_link
  FROM posts p
 WHERE p.created_at > now() - interval '1 day'
 GROUP BY p.author_id
HAVING count(*) >= 3 AND count(*) FILTER (WHERE p.body ~* 'https?://') >= 2;
