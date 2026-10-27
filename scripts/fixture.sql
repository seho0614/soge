-- 검증용 픽스처. 재실행 안전.
-- ⚠ TRUNCATE CASCADE 금지 — accounts 를 CASCADE 하면 updated_by 로 연결된
--   site_settings · restricted_industries · banned_words · categories 까지 함께 지워집니다.
--   반드시 아래처럼 의존 순서대로 DELETE 하십시오.
-- ⚠ append-only 테이블(fee_agreements 등)은 DELETE 트리거가 막으므로
--   시험용 초기화 동안만 트리거를 끕니다. 운영 DB에서는 절대 사용 금지.
SET session_replication_role = replica;
DELETE FROM deal_reviews;      DELETE FROM dispute_messages;   DELETE FROM disputes;
DELETE FROM settlements;
DELETE FROM deal_contracts;    DELETE FROM deal_confirmations; DELETE FROM fee_agreements;
DELETE FROM deals;             DELETE FROM messages;           DELETE FROM conversations;
DELETE FROM favorites;        DELETE FROM request_views;     DELETE FROM request_proposals;  DELETE FROM requests;
DELETE FROM listing_badges;    DELETE FROM listing_regions;   DELETE FROM listing_media;      DELETE FROM listing_versions;
DELETE FROM review_events;     DELETE FROM review_items;       DELETE FROM listings;
-- (v10.18) 구독을 지우면서 그 청구 기록도 함께 비웁니다. 전에는 청구서 · 시도 기록이 주인 없는 줄로 남아 검정을 돌릴수록 쌓였고,
--   옛 판의 검정이 넣은 「결제 근거 없는 결제 완료 청구서」가 D022 의 정합 점검(v_billing_integrity)에 걸렸습니다(쓰던 검정 DB 에서만).
DELETE FROM subscription_refunds; DELETE FROM billing_attempts;  DELETE FROM subscription_invoices;
DELETE FROM referral_codes;    DELETE FROM subscriptions;
DELETE FROM attribution_events;DELETE FROM visitor_identities;
DELETE FROM notifications;      DELETE FROM ops_alerts;
DELETE FROM business_members;   DELETE FROM businesses;
DELETE FROM term_agreements;   DELETE FROM account_roles;      DELETE FROM accounts;
-- 시험이 만든 업종·제한업종 정리 (재실행 안전)
DELETE FROM restricted_industries WHERE code = 'NEWR';
DELETE FROM category_grades WHERE category_id IN (SELECT id FROM categories WHERE code IN ('LT1','LT2','LT3','INS','NR','T1','T2','T3','VT1','T2A','TST'));
DELETE FROM categories WHERE code IN ('LT1','LT2','LT3','INS','NR','T1','T2','T3','VT1','T2A','TST');
DELETE FROM restricted_industries WHERE code IN ('NEWR','TSTR');
DELETE FROM banned_words WHERE word LIKE '시험%';
-- D-1 정합: 시험 과정에서 만든 Deal 에 LOCKED 합의가 없으면 채웁니다.
-- 픽스처가 불변식을 깨면 deploy-check 가 실제 위반과 구분되지 않습니다.
SET session_replication_role = replica;
INSERT INTO fee_agreements(deal_id, version, proposed_by, amount, state,
                           agreed_by_buyer_at, agreed_by_seller_at)
SELECT d.id, 1, d.buyer_account_id, d.agreed_fee, 'LOCKED', now(), now()
  FROM deals d
 WHERE d.agreed_fee IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM fee_agreements f
                    WHERE f.deal_id = d.id AND f.state = 'LOCKED');
SET session_replication_role = origin;
-- ★ LED 폼 문구는 더 이상 지우지 않습니다.
--    예전에는 LED 가 빈 관이라 시험이 마음대로 비웠습니다.
--    C993 으로 업종 8종과 폼 문구가 정식 기준 데이터가 되었으므로
--    지우면 배포본이 훼손됩니다 (검정 뒤 0건이 되어 관을 못 엽니다).
--    관 열기 게이트 시험은 임시 관(ZZT)으로 합니다.
UPDATE gwans SET is_active=false WHERE code='LED';
DELETE FROM notifications WHERE event_code='MSGTEST';
SET session_replication_role=replica;
DELETE FROM audit.pii_access_logs WHERE reason='시험 조회';
SET session_replication_role=origin;
DELETE FROM identity_verifications WHERE account_id IN ('aaaa9999-0000-4000-a000-0000000000f1','aaaa9999-0000-4000-a000-0000000000f2');
DELETE FROM accounts WHERE email::text IN ('pv1@t.com','pv2@t.com');
-- 연동 상태는 되돌리지 않습니다.
--
-- 예전에는 여기서 전부 NOT_STARTED 로 초기화했습니다. 시험 격리 목적이었지만,
-- 검정을 돌릴 때마다 **실제 연동 진행 상황이 지워졌습니다.**
-- 국세청 키를 등록해 TESTING 으로 올려 두어도 verify-invariants 한 번이면
-- NOT_STARTED 로 돌아갔고, 아무 오류도 나지 않았습니다.
--
-- 시험이 실제로 건드리는 것은 egress_ip 하나뿐이므로 그것만 되돌립니다.
-- status 와 secret_registered 는 운영 사실이라 시험이 손대면 안 됩니다.
UPDATE integrations SET egress_ip = NULL WHERE egress_ip IS NOT NULL;

-- 운영자 계정. 권한 경로를 시험하려면 실제 권한을 가진 계정이 필요합니다.
-- 없으면 "권한 없음(403)"과 "계정 없음(403)"이 구분되지 않아
-- 권한 검사가 도는지 알 수 없습니다.
INSERT INTO accounts (id, email, password_hash, name, account_type, status)
VALUES ('aaaa0000-0000-4000-a000-0000000000ad','admin@x.com','h','운영자','BUSINESS','ACTIVE')
ON CONFLICT (id) DO NOTHING;
INSERT INTO account_roles (account_id, role)
VALUES ('aaaa0000-0000-4000-a000-0000000000ad','ADMIN'),
       ('aaaa0000-0000-4000-a000-0000000000ad','SUPER')
ON CONFLICT DO NOTHING;
-- 약관 발행 상태 원복 (시험이 SERVICE 를 발행하므로)
DELETE FROM terms WHERE version = '9.9';
-- 시험이 만든 약관만 되돌립니다.
--
-- 전에는 무조건 전부 초안으로 되돌렸는데, 그러면 **실제 발행분까지
-- 지워집니다.** 2026-11-11 시행으로 발행한 이용약관이 검정 한 번에
-- 사라졌고, v_open_blockers 가 7건에서 11건으로 되돌아갔습니다.
--
-- 시험은 본문에 '이용약관 본문입니다' 같은 자리표시자를 넣으므로
-- 그것으로 구분합니다. 실제 본문은 수천 자입니다.
-- v10.26 (G-210) — 지우기 전에, 마이그레이션이 낸 다음 판(D024 · D028 은 이미 발행된 1.0 을 고친 글을 1.1 · 1.2 … 로 발행합니다)의 본문을 1.0 에 옮깁니다.
--   옮기지 않으면 쓰던 검정 DB(Docker 볼륨의 sgb_check 등)에서는 새 조항이 든 판이 지워지고 옛 글의 1.0 만 남아
--   「발행된 약관에 조항이 있는지」 불변식(SV-T3)이 걸립니다. 시험 자리표시자 글 · 9.9 는 옮기지 않습니다.
-- v10.28 (G-223) — 본문과 함께 알림 표시(is_notice · D042) · 제목도 옮깁니다. 본문만 옮기면 쓰던 검정 DB 에서 위탁 1.0 이 「알림」 글인데
--   알림이 아닌 판으로 발행돼(SV-T7) 알림 판에 동의 기록을 막는 공격 검정(AD-04)이 대상이 없어 「뚫림」으로 나왔습니다(10/9 Docker 검정).
UPDATE terms t SET body = n.body, is_notice = n.is_notice, title = n.title
  FROM (SELECT DISTINCT ON (code) code, body, is_notice, title FROM terms
         WHERE version <> '1.0' AND version ~ '^[0-9]+\.[0-9]+$' AND status = 'PUBLISHED'   -- v10.133 — 법무 검토 초안(D131)은 옮기지 않음
           AND body NOT LIKE '%본문입니다%' AND body NOT LIKE '%(생성 대기)%' AND length(body) > 200
         ORDER BY code, split_part(version, '.', 1)::int DESC, split_part(version, '.', 2)::int DESC) n
 WHERE t.code = n.code AND t.version = '1.0' AND (t.body IS DISTINCT FROM n.body OR t.is_notice IS DISTINCT FROM n.is_notice OR t.title IS DISTINCT FROM n.title);
-- v10.133 (D131) — 마이그레이션이 만든 법무 검토 초안(새 판 · 실제 본문)은 남김 — 운영과 같게(게시된 1.0 옆에 초안)
DELETE FROM terms WHERE version <> '1.0'
   AND NOT (status IN ('DRAFT','LEGAL_REVIEW') AND version ~ '^[0-9]+\.[0-9]+$' AND split_part(version, '.', 1)::int < 9
            AND body NOT LIKE '%본문입니다%' AND body NOT LIKE '%(생성 대기)%' AND length(body) > 200);
-- 시험 자리표시자만 되돌립니다. 실제 발행분은 건드리지 않습니다.
UPDATE terms SET status='LEGAL_REVIEW', effective_from='infinity'
 WHERE body LIKE '%본문입니다%' OR body LIKE '%(생성 대기)%';

SET session_replication_role = origin;

INSERT INTO gwans(code,name) VALUES ('MNY','소개장터'),('MAL','안심소개'),('BIZ','소개창업'),('LED','소개리드')
  ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(id,email,password_hash,name,account_type) VALUES
 ('11111111-1111-1111-1111-111111111111','intro@x.com','h','소개자','BUSINESS'),
 ('22222222-2222-2222-2222-222222222222','buyer@x.com','h','구매자','BUSINESS'),
 ('33333333-3333-3333-3333-333333333333','seller@x.com','h','판매자','BUSINESS'),
 ('44444444-4444-4444-4444-444444444444','person@x.com','h','개인','INDIVIDUAL');

INSERT INTO businesses(id,account_id,biz_reg_no,company_name,ceo_name,verified_at) VALUES
 ('aaaaaaaa-0000-4000-a000-000000000001','11111111-1111-1111-1111-111111111111','1110000001','소개사','대표',now());
INSERT INTO businesses(id,account_id,biz_reg_no,company_name,ceo_name) VALUES
 ('aaaaaaaa-0000-4000-a000-000000000002','44444444-4444-4444-4444-444444444444','1110000002','미인증사','대표');
-- bank_accounts 제거됨 — 플랫폼은 계좌를 보관하지 않습니다(INV-11 · 320_inv_hardening)

INSERT INTO subscription_plans(code,name,monthly_price,included_codes) VALUES
 ('BASIC','베이직',0,0),('STANDARD','스탠다드',49000,3),('PRO','프로',149000,15)
  ON CONFLICT (code) DO NOTHING;

INSERT INTO subscriptions(id,account_id,plan_code,status,current_period_start,current_period_end) VALUES
 ('bbbbbbbb-0000-4000-a000-000000000001','11111111-1111-1111-1111-111111111111','STANDARD','ACTIVE',now()-interval '1 day',now()+interval '29 days'),
 ('bbbbbbbb-0000-4000-a000-000000000002','22222222-2222-2222-2222-222222222222','BASIC','EXPIRED',now()-interval '60 days',now()-interval '30 days');

-- A-14: 승인하려면 직업안정법 판정이 필요
INSERT INTO categories(id,gwan_code,code,name,status,labor_law_flag) VALUES
 ('eeeeeeee-0000-4000-a000-000000000001','MNY','MFG','제조 설비','APPROVED','NOT_APPLICABLE')
  ON CONFLICT (gwan_code,code) DO NOTHING;

-- ★ 판매 등록 전에 사업자 인증을 마칩니다.
--
--   판매 등록은 인증 사업자만 할 수 있습니다(결정 ⑤). 픽스처가 인증
--   없이 등록을 넣으면 트리거에 막혀 초기화 자체가 실패합니다.
--   시험 데이터라고 트리거를 끄지 않습니다 — 끄면 그 방어가
--   정말 도는지 확인할 수 없습니다.
INSERT INTO businesses(account_id, company_name, ceo_name, biz_reg_no, verified_at)
SELECT '33333333-3333-3333-3333-333333333333','시험판매사','판매자','333-33-33333', now()
 WHERE NOT EXISTS (SELECT 1 FROM businesses
                    WHERE account_id = '33333333-3333-3333-3333-333333333333');
UPDATE businesses SET verified_at = coalesce(verified_at, now())
 WHERE account_id = '33333333-3333-3333-3333-333333333333';

INSERT INTO listings(id,gwan_code,category_id,owner_account_id,title,status,desired_fee) VALUES
 ('ffffffff-0000-4000-a000-000000000001','MNY','eeeeeeee-0000-4000-a000-000000000001','33333333-3333-3333-3333-333333333333','설비 매각','PUBLISHED',1000000);

-- 귀속 이벤트 (INV-2 first-touch 근거). 이게 없으면 소개자 지정 확정이 거부됩니다
INSERT INTO attribution_events(code,visitor_key,account_id,occurred_at,expires_at) VALUES
 ('OK1','v-1','22222222-2222-2222-2222-222222222222',now()-interval '2 days',now()+interval '88 days');

INSERT INTO deals(id,listing_id,buyer_account_id,seller_account_id,status,introducer_account_id,attributed_code) VALUES
 ('cccccccc-0000-4000-a000-000000000001','ffffffff-0000-4000-a000-000000000001','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PAYMENT_REPORTED','11111111-1111-1111-1111-111111111111','OK1');

-- 소개비 약정.
-- 460 에서 소개비 기능을 껐으므로 신규 체결은 트리거가 막습니다.
-- 과거 데이터가 남아 있는 상황(기능을 껐지만 이전 건은 존재)을 재현해야
-- 그 위의 방어 장치(D-1 잠금 등)를 시험할 수 있으므로,
-- 스위치를 잠시 켜서 넣고 다시 끕니다.
UPDATE site_settings SET value='on' WHERE key='feature.referral_fee';
INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state,agreed_by_buyer_at,agreed_by_seller_at)
 VALUES ('cccccccc-0000-4000-a000-000000000001',1,'22222222-2222-2222-2222-222222222222',1000000,'LOCKED',now(),now());
UPDATE deals SET agreed_fee=1000000 WHERE id='cccccccc-0000-4000-a000-000000000001';
UPDATE site_settings SET value='off' WHERE key='feature.referral_fee';

-- 등급별 성사 수수료 시험용 구독 (공급자 = STANDARD)
INSERT INTO subscriptions(account_id,plan_code,status,started_at,current_period_start,current_period_end)
 VALUES ('33333333-3333-3333-3333-333333333333','STANDARD','ACTIVE',now(),now(),now()+interval '90 days')
 ON CONFLICT DO NOTHING;

SET session_replication_role = origin;

-- ── 약관 발행 상태 복구 ─────────────────────────────────────────────
--
-- ★ 위에서 `status='LEGAL_REVIEW'` 로 되돌립니다. 발행 흐름을 시험하기
--   위한 것인데 **되돌린 뒤 복구하지 않아** 푸터 링크가 전부 죽고
--   약관 발행을 전제한 검정 4건이 함께 무너졌습니다.
--
--   시험이 끝난 상태는 "약관이 발행된 평상시" 여야 합니다.
--   v10.133 (D131) — 운영의 발행(publish-terms.sh)과 같이 **미확정 표시(〔시행일〕 말고 〔…〕)가 남은 판은 발행하지 않습니다**
--   (법무 확인 전 초안 · 처리방침의 〔확인 필요〕). 그런 판은 검토 중(LEGAL_REVIEW)으로 둡니다.
-- v10.133 — 빈 DB 에서 세우면 게시된 판이 없어 D131 이 1.0 초안 자체를 새 글(〔확인 필요〕)로 바꿉니다. 그대로 두면 처리방침이 게시되지 않아
--   푸터 고지가 죽고(FOOT), 약관 발행 시험의 되돌리기가 그 1.0 을 게시로 돌려 미확정 표시가 게시됩니다(Y-02 · CQ-06 · realcheck 2차).
--   운영과 같은 모양(게시된 1.0 + 법무 검토 초안 1.1)으로 맞춥니다: 새 글은 1.1 초안으로 옮기고, 1.0 의 미확정 칸만 검정용 글로 채워 게시합니다.
INSERT INTO terms(code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice, audience)
SELECT code, '1.1', title, body, is_required, 'infinity', 'LEGAL_REVIEW', display_order, gwan_code, change_note, is_notice, audience
  FROM terms t
 WHERE version = '1.0' AND status IN ('DRAFT','LEGAL_REVIEW')
   AND code IN ('SERVICE','PRIVACY','REFUND','THIRDPARTY','OUTSOURCE','ADPERSONAL','HLT_SALE','MARKETING','MARKETING_NIGHT')
   AND body ~ '〔(?!시행일〕)[^〕]*〕'
   AND NOT EXISTS (SELECT 1 FROM terms d WHERE d.code = t.code AND d.version <> '1.0' AND d.status IN ('DRAFT','LEGAL_REVIEW'))
ON CONFLICT (code, version) DO NOTHING;
UPDATE terms SET body = regexp_replace(body, '〔(?!시행일〕)[^〕]*〕', '(검정 DB 채움)', 'g')
 WHERE version = '1.0' AND status IN ('DRAFT','LEGAL_REVIEW')
   AND code IN ('SERVICE','PRIVACY','REFUND','THIRDPARTY','OUTSOURCE','ADPERSONAL','HLT_SALE','MARKETING','MARKETING_NIGHT')
   AND body ~ '〔(?!시행일〕)[^〕]*〕';
UPDATE terms SET status = 'PUBLISHED', effective_from = '2026-11-11'
 WHERE version = '1.0'
   AND code IN ('SERVICE','PRIVACY','REFUND','THIRDPARTY','OUTSOURCE',
                'ADPERSONAL','HLT_SALE','MARKETING','MARKETING_NIGHT')
   AND NOT EXISTS (SELECT 1 FROM regexp_matches(body, '〔[^〕]*〕', 'g') m WHERE m[1] <> '〔시행일〕');
-- 게시하면 같은 약관의 다른 판(초안 포함)이 보관됩니다(fn_archive_prior_terms) — 위에서 옮긴 법무 검토 초안은 되살립니다.
UPDATE terms SET status = 'LEGAL_REVIEW'
 WHERE version <> '1.0' AND status = 'ARCHIVED' AND effective_from = 'infinity'
   AND body ~ '〔(?!시행일〕)[^〕]*〕';

-- v10.28 (G-223) — 「알림」 글인 판은 알림으로(D042 와 같은 기준 · 동의를 받지 않음). 판을 1.0 하나로 줄인 쓰던 검정 DB 에서도 맞게.
UPDATE terms SET is_notice = true, title = '개인정보 처리업무 위탁 안내'
 WHERE code = 'OUTSOURCE' AND status <> 'ARCHIVED' AND body LIKE '%이 글은 **알림**입니다%' AND NOT is_notice;

-- 위치기반은 폐기 그대로 둡니다(단말기 위치를 수집하지 않습니다).
UPDATE terms SET status = 'ARCHIVED' WHERE code = 'LOCATION';

-- ★ 본문의 〔시행일〕 자리표시자를 실제 날짜로 채웁니다.
--   안 채우면 "시행일 미정" 이라 적힌 약관을 발행한 셈입니다(Y-02).
-- v10.28 — 날짜 형식을 고침. 전에는 'YYYY년 M월 D일' 이라(M 은 형식 글자가 아니고 D 는 요일 번호) 「2026년 M월 4일」이 박혔습니다.
--   이미 그렇게 박힌 검정 DB 의 본문도 바로잡습니다(약관 한 벌 일치 검사 SV-T5 가 잡음).
UPDATE terms
   SET body = replace(body, '〔시행일〕', to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"'))
 WHERE status = 'PUBLISHED' AND body LIKE '%〔시행일〕%'
   AND effective_from IS NOT NULL AND effective_from <> 'infinity';
UPDATE terms
   SET body = regexp_replace(body, '시행일 [0-9]{4}년 M월 [0-9]일', '시행일 ' || to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"'))
 WHERE status = 'PUBLISHED' AND body ~ '시행일 [0-9]{4}년 M월 [0-9]일'
   AND effective_from IS NOT NULL AND effective_from <> 'infinity';
