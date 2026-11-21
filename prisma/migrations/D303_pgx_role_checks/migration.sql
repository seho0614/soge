-- v10.615 (docs/757) 권한그룹 전환 준비 — DB 함수 · 트리거의 「역할 이름 검사」를 권한그룹 판정과 함께 보게 고침(앞머리 pgx_)
--   대표 11/21 승인. 마이그레이션 번호는 메인이 붙임. 다시 돌려도 같음(CREATE OR REPLACE 만 · 표 · 칸 · 트리거를 새로 만들지 않음).
--   규칙: 「역할 또는 그 업무 EDIT 이상(보기 검사는 VIEW)」 — 역할 줄은 글자 그대로 두고 OR 로 권한그룹을 더함(넓히기만).
--         권한그룹 쪽은 perm.mode = GROUPS 이고 SUPER 아닌 운영 역할이 있는 계정만(pgx_groups_task) — ROLE · COMPARE 는 지금과 똑같음.
--   업무 · 수준은 R_역할 처음 권한그룹(D258 · D291 시드)이 그 역할과 같은 범위가 되는 것만 골랐음(docs/757 3절).
--   바꾸는 함수 4개 — 옛 본문을 그대로 옮기고 역할 검사 한 곳만 바꿈:
--     fn_settlement_approval(D080 · 정산 승인) · fn_post_guard(C810 · 소개광장 공지 글) · fn_bzx_inquiry_file_guard(D299 · 답변 사진) · fn_file_can_read(D269 · 파일 열람)
--   그대로 둔 것(까닭은 docs/757): 지급 실행(PAYOUT · 돈 나감) · SUPER 전용(경비 · 품의 결재) · 겸직 금지(C710 · D173) · 결재선 단계 역할 · 퍼블리셔 명세서 승인(R_PAYOUT 도 같은 업무 승인을 가져 넓어짐).
--   RAISE 글자에 퍼센트 기호 없음(정산 승인의 옛 자리 표시도 USING MESSAGE 로 같은 글을 만듦).

/* ── ① 권한그룹 판정 한 줄 — perm.mode GROUPS · 운영 역할(SUPER 빼고) · fn_perm_effective 에 업무 · 수준 ── */
CREATE OR REPLACE FUNCTION public.pgx_groups_task(p_account uuid, p_tasks text[], p_levels text[])
 RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_account IS NULL OR p_tasks IS NULL OR p_levels IS NULL THEN RETURN false; END IF;
  IF coalesce((SELECT s.value FROM public.site_settings s WHERE s.key = 'perm.mode'), 'ROLE') <> 'GROUPS' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_roles r
                  WHERE r.account_id = p_account AND r.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
                    AND (r.expires_at IS NULL OR r.expires_at > now())) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.fn_perm_effective(p_account) e WHERE e.task_key = ANY (p_tasks) AND e.level = ANY (p_levels));
END $$;
COMMENT ON FUNCTION public.pgx_groups_task(uuid, text[], text[]) IS
  'v10.615 (docs/757) 권한그룹 판정 — perm.mode GROUPS 이고 SUPER 아닌 운영 역할(기한 안)이 있으면 실제 권한(fn_perm_effective)에 업무 · 수준이 있는지. 그 밖 모드는 늘 거짓(역할 검사만). DB 트리거는 「역할 또는 이것」으로 씀.';

/* ── ② 정산 승인(D080 fn_settlement_approval) — ADMIN · SUPER 또는 정산(settlement) 고치기 이상(R_ADMIN 만 가짐) ── */
CREATE OR REPLACE FUNCTION public.fn_settlement_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; v_bad text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF OLD.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'STL_APPROVE: 승인 대기(신청) 상태의 정산만 승인할 수 있습니다';
    END IF;
    IF NEW.approved_by IS NULL OR NOT (EXISTS (
         SELECT 1 FROM account_roles r WHERE r.account_id = NEW.approved_by AND r.role IN ('ADMIN','SUPER'))
         OR public.pgx_groups_task(NEW.approved_by, ARRAY['settlement'], ARRAY['EDIT', 'APPROVE'])) THEN   -- v10.615 (docs/757) GROUPS 면 정산 업무 고치기 이상도
      RAISE EXCEPTION 'STL_APPROVE: 운영(ADMIN · SUPER) 계정만 승인할 수 있습니다';
    END IF;
    SELECT * INTO d FROM deals WHERE id = NEW.deal_id;
    IF NEW.approved_by IN (NEW.payee_account_id, d.seller_account_id, d.buyer_account_id, d.introducer_account_id) THEN
      RAISE EXCEPTION 'STL_APPROVE: 거래 당사자는 자기 정산을 승인할 수 없습니다(2인 원칙)';
    END IF;
    IF NEW.held_by_dispute_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM disputes x WHERE x.deal_id = NEW.deal_id AND x.status IN ('OPEN','IN_REVIEW')) THEN
      RAISE EXCEPTION 'STL_APPROVE: 분쟁이 걸린 거래의 정산은 승인할 수 없습니다';
    END IF;
    IF NEW.payee_business_id IS NULL THEN
      SELECT CASE
               WHEN p.id IS NULL THEN '받을 계좌 확인이 끝나지 않았습니다'
               WHEN NOT p.verified THEN '받을 계좌 1원 확인이 끝나지 않았습니다'
               WHEN regexp_replace(p.holder_name, '\s', '', 'g') <> regexp_replace(a.name, '\s', '', 'g')
                 THEN '예금주명이 회원 이름과 다릅니다 — 수동 검증 대기'
             END INTO v_bad
        FROM accounts a
        LEFT JOIN LATERAL (SELECT * FROM payout_accounts q WHERE q.account_id = a.id
                            ORDER BY q.is_default DESC, q.verified DESC, q.created_at DESC LIMIT 1) p ON true
       WHERE a.id = NEW.payee_account_id;
      IF v_bad IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE = 'STL_APPROVE: ' || v_bad; END IF;   -- v10.615 같은 글(자리 표시 없이)
    END IF;
    NEW.approved_at := now();
  END IF;

  /* 지급 표시(당사자)는 운영 승인 뒤에만 */
  IF TG_OP = 'UPDATE' AND NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'STL_PAID: 운영 승인 전에는 지급 표시를 할 수 없습니다';
  END IF;

  /* 보류 · 반려 · 다시 신청으로 돌아가면 승인은 풀립니다(기록은 settlement_approvals 에 남음) */
  IF TG_OP = 'UPDATE' AND NEW.status IN ('REQUESTED','HELD','REJECTED') AND OLD.status = 'APPROVED' THEN
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;

/* ── ③ 소개광장 공지 글(C810 fn_post_guard) — ADMIN · SUPER 또는 글 검수(community) · 공지(mainops) 고치기 이상(둘 다 R_ADMIN 만) ── */
CREATE OR REPLACE FUNCTION public.fn_post_guard() RETURNS trigger AS $$
DECLARE v_joined timestamptz; v_cnt int; v_first boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  IF NEW.board = 'NOTICE' THEN
    IF NOT EXISTS (SELECT 1 FROM account_roles
                    WHERE account_id = NEW.author_id AND role IN ('ADMIN','SUPER'))
       AND NOT public.pgx_groups_task(NEW.author_id, ARRAY['community', 'mainops'], ARRAY['EDIT', 'APPROVE']) THEN   -- v10.615 (docs/757) GROUPS 면 글 검수 · 공지 업무 고치기 이상도
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

/* ── ④ 1:1 문의 답변 사진(D299 fn_bzx_inquiry_file_guard) — ADMIN · SUPER 또는 1:1 문의(inquiries) 고치기 이상(R_ADMIN 만) ── */
CREATE OR REPLACE FUNCTION public.fn_bzx_inquiry_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_n integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'BZX_INQ_PHOTO: 붙인 사진 줄은 고치지 않습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = NEW.file_id AND f.purpose = 'INQUIRY_ATTACHMENT' AND f.status = 'READY'
                   AND f.owner_account_id = NEW.added_by AND f.content_type IN ('image/jpeg', 'image/png')) THEN
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 붙인 사람이 올린 문의 첨부 그림(JPG · PNG · READY)만 붙입니다.';
  END IF;
  SELECT account_id INTO v_owner FROM public.inquiries WHERE id = NEW.inquiry_id;
  IF NEW.side = 'MEMBER' AND v_owner IS DISTINCT FROM NEW.added_by THEN
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 문의한 회원만 사진을 더 붙입니다.';
  END IF;
  IF NEW.side = 'STAFF' AND NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.added_by AND r.role IN ('ADMIN', 'SUPER'))
     AND NOT public.pgx_groups_task(NEW.added_by, ARRAY['inquiries'], ARRAY['EDIT', 'APPROVE']) THEN   -- v10.615 (docs/757) GROUPS 면 1:1 문의 고치기 이상도
    RAISE EXCEPTION 'BZX_INQ_PHOTO: 답변 사진은 운영(ADMIN · SUPER)만 붙입니다.';
  END IF;
  SELECT count(*) INTO v_n FROM public.bzx_inquiry_files WHERE inquiry_id = NEW.inquiry_id AND side = NEW.side;
  IF v_n >= 6 THEN RAISE EXCEPTION 'BZX_INQ_PHOTO_FULL: 사진은 문의마다 6장까지입니다.'; END IF;
  RETURN NEW;
END $$;

/* ── ⑤ 파일 열람(D269 fn_file_can_read) — 역할 줄 그대로 · GROUPS 면 업무 보기로도 ── */
CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
 RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE
  f public.files;
  v_partner boolean;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = p_file;
  IF f.id IS NULL OR f.status <> 'READY' OR p_account IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  IF f.owner_account_id = p_account THEN RETURN 'OK'; END IF;
  /* v10.615 (docs/757) perm.mode GROUPS — 업무 권한으로도 엶(아래 역할 줄은 그대로 · 넓히기만 · ROLE · COMPARE 는 pgx_groups_task 가 늘 거짓)
   *   검수 큐 보기 = ADMIN · REVIEWER 줄과 같은 범위(사내 · 인사 · 법무 서류 빼고) · 사내 문서함 보기 = ADMIN · PAYOUT · 인사 3탭 보기 = ADMIN · 법무 3탭(보험 빼고) 보기 = ADMIN
   *   파트너 보기 = ADMIN · 안심 파트너 담당 · 제휴 고치기 이상 = ADMIN · 제휴 파트너 담당(제휴 보기는 지급 담당도 가져 넓어지므로 고치기) */
  IF f.purpose NOT IN ('CORP_DOC', 'HR_DOC', 'LGL_DOC') AND public.pgx_groups_task(p_account, ARRAY['queue'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'CORP_DOC' AND public.pgx_groups_task(p_account, ARRAY['corp-docs'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'HR_DOC' AND public.pgx_groups_task(p_account, ARRAY['hr-training', 'hr-recruit', 'hr-contract'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'LGL_DOC' AND public.pgx_groups_task(p_account, ARRAY['lgl-reviews', 'lgl-cases', 'lgl-licenses'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose IN ('BROKER_DOC', 'PARTNER_MEDIA') AND public.pgx_groups_task(p_account, ARRAY['partners'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose IN ('MARKETING_MATERIAL', 'PARTNER_GUIDE') AND public.pgx_groups_task(p_account, ARRAY['affiliates'], ARRAY['EDIT', 'APPROVE']) THEN RETURN 'OK'; END IF;
  /* 심사 · 심의하는 사람 */
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN
    /* v10.425 — 사내 문서는 REVIEWER 에게 열지 않음 */
    IF f.purpose = 'CORP_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    /* v10.458 ~ 461 (D262) — 인사 서류(HR_DOC · 의무교육 증빙 · 지원자 서류)는 검수(REVIEWER)에게 열지 않음 · 지급 담당 · 세무사 분기에도 넣지 않음(본인 = 올린 사람은 위 주인 줄로 엶) */
    IF f.purpose = 'HR_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    /* v10.486 ~ 489 (D269 · 대표 11/20) — 법무 서류(LGL_DOC · 인허가 · 계약 검토 · 사건 · 보험)는 검수(REVIEWER)에게 열지 않음 · 본인 = 올린 사람은 위 주인 줄로 엶 */
    IF f.purpose = 'LGL_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    RETURN 'OK';
  END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 · v10.425 (D253) 사내 문서 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose IN ('ACCT_EVIDENCE', 'CORP_DOC') THEN RETURN 'OK'; END IF;
  /* v10.489 (D269 · 대표 11/20) — 지급 담당은 법무 서류 중 보험 증권에 붙은 파일만(보험료 처리) · 계약 검토 · 사건 · 인허가 서류는 못 엶 · 세무사 분기에는 넣지 않음 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose = 'LGL_DOC'
     AND EXISTS (SELECT 1 FROM public.lgl_insurance_policies x WHERE f.id = ANY (x.file_ids)) THEN RETURN 'OK'; END IF;
  /* v10.437 (D257) — 세무사 공유 계정은 회계 증빙만(사내 문서 · 회원 파일은 못 엶) */
  IF 'ACCOUNTANT' = ANY (p_roles) AND f.purpose = 'ACCT_EVIDENCE' THEN RETURN 'OK'; END IF;

  IF f.purpose = 'MARKETING_MATERIAL'
     AND EXISTS (SELECT 1 FROM public.marketing_materials m WHERE m.file_id = f.id AND m.state = 'APPROVED')
  OR f.purpose = 'PARTNER_GUIDE'
     AND EXISTS (SELECT 1 FROM public.partner_guides g WHERE g.file_id = f.id AND g.is_active) THEN
    SELECT EXISTS (SELECT 1 FROM public.partners p JOIN public.businesses b ON b.id = p.business_id
                    WHERE b.account_id = p_account AND p.aff_status = 'ACTIVE') INTO v_partner;
    RETURN CASE WHEN v_partner THEN 'OK' ELSE 'PARTNER_ONLY' END;
  END IF;
  /* v10.31 — 공개된 매물 · 요청의 사진 */
  IF f.purpose = 'LISTING_IMAGE' AND EXISTS (
       SELECT 1 FROM public.listing_media m JOIN public.listings l ON l.id = m.listing_id
        WHERE m.file_id = f.id AND l.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  IF f.purpose = 'REQUEST_IMAGE' AND EXISTS (
       SELECT 1 FROM public.requests r WHERE r.photo_file_id = f.id AND r.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  /* 등기부 · 중개 서류는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $function$;

/* ── ⑥ 「?」 도움말 GET /admin/help/tab — 운영 역할이면 누구나(어느 업무든 보기가 있으면) (11/21 대표 지시 추가)
 *   D300 시드는 업무 5개(scx-help · home · manual · my-hr · ofc-notify) 중 하나의 보기만 열어, 새 탭만 가진 권한그룹은 GROUPS · ON 에서 403 이 났음.
 *   같은 주소에 모든 업무의 보기를 이음(「하나라도 있으면 통과」) · 새 업무가 생기면 트리거가 같이 이음 · 절은 서버가 그 탭 보기 권한이 있을 때만 줌(tab-help.ts).
 *   다시 돌려도 같음(ON CONFLICT DO NOTHING) · 설명서 묶음(v10.616)이 같은 줄을 넣어도 겹치지 않음. */
INSERT INTO public.perm_route_map (method, pattern, task_key, level)
SELECT 'GET', '/admin/help/tab', t.key, 'VIEW' FROM public.perm_tasks t
ON CONFLICT (method, pattern, task_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pgx_task_help_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES ('GET', '/admin/help/tab', NEW.key, 'VIEW')
  ON CONFLICT (method, pattern, task_key) DO NOTHING;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.pgx_task_help_route() IS 'v10.615 (docs/757) 새 업무(perm_tasks)마다 「?」 도움말 주소 GET /admin/help/tab 에 그 업무 보기를 이음 — 운영 역할이면 누구나 도움말 주소를 엶';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pgx_task_help_route' AND tgrelid = 'public.perm_tasks'::regclass) THEN
    CREATE TRIGGER trg_pgx_task_help_route AFTER INSERT ON public.perm_tasks FOR EACH ROW EXECUTE FUNCTION public.pgx_task_help_route();
  END IF;
END $$;
