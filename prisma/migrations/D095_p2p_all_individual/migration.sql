-- =====================================================================
-- D095 — v10.37 (2026-10-13 대표 지시) 소개뱅크는 B2B 가 아니라 P2P
--
--   「모두 개인에게 허용. 단 등록 시 인증을 받아야 하는 경우만 인증 받고 가능 · 이외의 제약이 없음」
--
--   ① 매물 판매 게이트 2개 — 「사업자만」 판정을 뺍니다(모든 관). D094(v10.36 · 소개장터만 예외)를 넓힌 것입니다.
--      인증이 필요한 등록의 게이트는 그대로 둡니다: 제한업종(INV-6) · 보험 · 의료 자격 심사(GATED) · 부동산 공인중개사(PROP · BROKER) ·
--      안심소개 입점 승인 스위치(mal.partner_only) · 소유 확인.
--   ② 소개창업 공고 · 자문 서비스(biz_axis_items JOB · SVC) — 「인증 사업자 본인만」을 뺍니다. 사업자 정보를 붙이면 그 사업자는 올린 사람의 것 · 인증된 것이어야 합니다(그대로).
--   ③ 문구 — ui_messages.BUSINESS_ONLY · 자주 묻는 질문 「개인도 가입할 수 있나요?」
--   ④ 이용약관 제4조 표 — 본인인증 = 모든 업무 · 인증이 필요한 업종은 그 인증 뒤 · 사업자 인증은 사업자로 소개비를 받을 때(선택).
--      글은 scripts/terms-text.js 한 벌 · 방식은 D041 · D062 와 같음(초안이면 본문만 · 발행된 판이면 다음 번호로 발행 · 필수 약관이라 다음 로그인 때 다시 동의).
--   재실행 안전.
-- =====================================================================

/* ── ① 매물 판매 게이트 — 사업자 판정 없음 (트리거는 그대로 두고 함수만 통과로) ── */
CREATE OR REPLACE FUNCTION public.fn_listing_seller_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- v10.37 (D095) — P2P: 판매 등록은 개인 회원도 합니다(모든 관). 인증이 필요한 등록은 각 게이트(GATED · PROP · INV-6 · 입점)가 봅니다.
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_listing_requires_business() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- v10.37 (D095) — P2P: 품목(상품 · 서비스 · 창업)에 사업자 인증을 요구하지 않습니다.
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_listing_seller_gate() IS
  'v10.37 (D095) — P2P: 판매 등록에 사업자 판정 없음(통과). 인증이 필요한 등록은 fn_gated_no_intro_listing · fn_property_guard · 제한업종 · fn_mal_partner_only_guard 가 봅니다.';
COMMENT ON FUNCTION public.fn_listing_requires_business() IS
  'v10.37 (D095) — P2P: 품목별 사업자 요구 없음(통과). item_types.requires_business 는 참고 값으로만 남습니다.';

/* ── ② 소개창업 공고 · 자문 서비스 ── */
DO $$
DECLARE c record;
BEGIN
  -- 이름이 자동으로 붙은 제약(biz_axis_items_check1)이라 이름 대신 내용(JOB · SVC 면 business_id 필수)으로 찾아 뺍니다
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.biz_axis_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%business_id IS NOT NULL%' LOOP
    EXECUTE format('ALTER TABLE public.biz_axis_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_biz_axis_item_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE hit record; b record;
BEGIN
  SELECT * INTO hit FROM fn_check_banned_words(coalesce(NEW.title,'') || ' ' || coalesce(NEW.description,'') || ' ' || coalesce(NEW.sub_text,''), 'BIZ')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word; END IF;
  -- v10.37 (D095) — P2P: 공고 · 자문 서비스는 개인 회원도 올립니다. 사업자 정보를 붙였다면 그 사업자는 올린 사람의 것 · 인증된 것이어야 합니다.
  IF NEW.business_id IS NOT NULL THEN
    SELECT * INTO b FROM public.businesses WHERE id = NEW.business_id;
    IF b.id IS NULL OR b.verified_at IS NULL OR b.account_id <> NEW.owner_account_id THEN
      RAISE EXCEPTION 'BIZ_AXIS_BUSINESS: 붙인 사업자 정보가 올린 분의 인증된 사업자가 아닙니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* ── ③ 문구 ── */
UPDATE public.ui_messages
   SET message = '개인 회원도 본인인증으로 모든 업무를 하실 수 있습니다. 사업자 인증은 사업자로 소개비(세금계산서)를 받으실 때 하시면 됩니다.',
       updated_at = now()
 WHERE code = 'BUSINESS_ONLY';

UPDATE public.faqs
   SET answer = '가입하실 수 있습니다. 개인 회원도 본인인증을 하시면 모든 업무(등록 · 문의 · 거래 · 소개비 받기)를 하실 수 있습니다. 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.'
 WHERE question = '개인도 가입할 수 있나요?';

/* ── ⑤ 계약서 발급 — 합의한 소개비가 없을 때의 거절을 이유와 함께(500 → 422 CONTRACT_FEE) ──
 *   v10.37 에서 개인 회원도 계약서를 발급하게 되며 드러남(전에도 사업자에게 같은 500). 판정은 그대로 · 문구에 접두어만 붙입니다. */
CREATE OR REPLACE FUNCTION public.fn_lock_fee_on_contract()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fa record;
BEGIN
  -- 소개비가 꺼져 있으면 소개비 없이 계약서를 냅니다.
  -- 소개비는 당사자끼리 정하는 사항이므로 플랫폼 계약서의 조건이 아닙니다.
  IF NOT fn_feature_on('referral_fee') THEN
    NEW.fee_agreement_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO fa FROM fee_agreements
   WHERE deal_id = NEW.deal_id AND state = 'LOCKED';
  IF fa.id IS NULL THEN
    -- AGREED 상태의 최신 합의를 LOCKED 로 승격
    SELECT * INTO fa FROM fee_agreements
     WHERE deal_id = NEW.deal_id AND state = 'AGREED'
       AND agreed_by_buyer_at IS NOT NULL AND agreed_by_seller_at IS NOT NULL
     ORDER BY version DESC LIMIT 1;
    IF fa.id IS NULL THEN
      RAISE EXCEPTION
        'CONTRACT_FEE: 계약서 발급 불가 — 양측이 합의한 소개비 금액이 없습니다. 소개비를 제시하고 양측이 동의한 뒤 발급하십시오 (deal %)', NEW.deal_id;
    END IF;
    INSERT INTO fee_agreements(deal_id, version, proposed_by, amount, state,
                               agreed_by_buyer_at, agreed_by_seller_at, reason_code)
    VALUES (fa.deal_id, fa.version + 1, fa.proposed_by, fa.amount, 'LOCKED',
            fa.agreed_by_buyer_at, fa.agreed_by_seller_at, 'CONTRACT_ISSUE')
    RETURNING * INTO fa;
    UPDATE deals SET agreed_fee = fa.amount, agreed_fee_fixed_at = now()
     WHERE id = NEW.deal_id;
  END IF;
  NEW.fee_agreement_id := fa.id;
  RETURN NEW;
END $function$;

/* ── ④ 이용약관 제4조 ── */
CREATE TEMP TABLE _terms_text (code text PRIMARY KEY, body text NOT NULL, note text NOT NULL) ON COMMIT DROP;
INSERT INTO _terms_text VALUES ('SERVICE', $TERM$# 이용약관

## 제1조 (목적)
이 약관은 **(주)한국바이오헬스케어 소개뱅크 사업부**(이하 "회사")가
제공하는 소개뱅크 서비스의 이용 조건을 정합니다.

## 제2조 (소개뱅크가 하는 일)
① 회사는 **회원끼리 서로를 찾도록 잇고, 그 기록을 남깁니다.**
② 회사는 회원 사이의 거래에 **당사자로 참여하지 않습니다.**
③ 회사가 직접 파는 것은 **소개몰(직판)** 하나뿐이며, 그 부분은
   별도의 「건강상품 판매 약관」이 적용됩니다.

## 제3조 (소개비)
① 소개비는 **당사자끼리 직접** 주고받습니다.
② 회사는 소개비에서 **어떤 명목으로도 공제하지 않습니다.**
③ 회사는 소개비를 **대신 받아 두지 않습니다.** 회사 계좌를 거치지
   않습니다.

> 이 조항은 회사의 핵심 원칙입니다. 회사가 소개비를 받아 두면
> 자금을 수탁하는 것이 되어 별도의 허가가 필요합니다.

## 제4조 (회원 자격)
① **만 19세 이상**이면 개인과 사업자 모두 가입하실 수 있습니다.
② 쓰실 수 있는 기능은 **확인을 마친 단계**에 따라 열립니다. 관과
   업종에 따라 조건이 더 붙습니다(제7조 · 제8조).

| 단계 | 열리는 기능 |
|---|---|
| 가입 | 둘러보기 |
| 본인인증 | **모든 업무** — 문의 · 매물과 요청 등록 · 급구 · 급매 신청 · 거래 만들기 · 소개비 제시 · 계약서 발급 · 거래 성사 확인 · 대금 지급 신고 · 소개몰 주문 · **소개비 받기** |
| 등록에 인증이 필요한 업종 | 그 인증(공인중개사 · 보험 · 의료 자격 심사 · 업체 입점 심사 등)을 받은 뒤 등록 |
| 사업자 인증(선택) | 사업자로 소개비 받기(세금계산서 발행) |

소개비 **정산을 신청하실 때**는 받으실 **계좌를 확인**합니다.
사업자로 받는 소개비(세금계산서 발행)는 **사업자 인증 뒤에 성사된 거래**부터입니다 — 인증 시각이 기준이며
소급하지 않습니다. 인증 전에 성사된 거래의 소개비는 개인으로 받습니다.

③ 사업자 인증은 **본인인증과 사업자 진위 확인**을 거칩니다.
④ 만 19세 미만은 가입할 수 없습니다.

## 제5조 (회원의 의무)
회원은 다음을 하지 않습니다.

- 사실과 다른 내용을 올리는 것
- 남의 물건이나 자격을 자기 것처럼 쓰는 것
- 소개 실적을 꾸미거나 허위 거래를 만드는 것
- 다른 회원의 연락처를 목적 밖으로 쓰는 것
- 법령이 금지한 물품·용역을 다루는 것

## 제6조 (등록물의 검수)
① 회원이 올린 내용은 **게시 전에 회사가 확인**합니다.
② 확인은 **영업일 기준 24시간 이내**에 처리하며(토 · 일요일 제외), 반려 시 **사유를 알려 드립니다.**
③ 반려는 그 내용이 위법하다는 판단이 아니라, **이 서비스에서
   다루지 않는다**는 뜻입니다.

## 제7조 (제한 업종)
법령상 별도 허가·등록이 필요하거나 회사가 감당할 수 없는 위험이
있는 업종은 다룰 수 없습니다. 목록은 서비스 안에 공지합니다.

## 제8조 (부동산)
① 부동산 매물은 **공인중개사 인증을 받은 회원** 또는 **본인 소유를
   확인받은 회원**만 올릴 수 있습니다(공인중개사법 18조의2 ③).
② 화면에는 **중개사 매물인지 직거래인지** 갈라 적습니다.
③ 부동산 매물에는 **소개비가 아니라 노출료**가 붙으며, 부동산 거래에는
   **소개비 약정 · 정산이 생기지 않습니다**(A-07 법무 회신 전까지).

## 제9조 (구독)
① 일부 기능은 구독이 필요합니다.
② 구독료와 한도는 서비스 안에 표시합니다. 요금제마다 소개코드 발급 수와 소개 제안 수가
   다르며, 무료 요금제에는 소개코드가 포함되지 않습니다(필요하면 건당 정액으로 발급).
③ 환불은 「구독 환불 정책」에 따릅니다.

## 제10조 (회사의 책임)
① 회사는 회원 사이 거래의 **이행·불이행에 책임지지 않습니다.**
② 다만 회사의 **고의나 중대한 과실**로 회원에게 손해가 생긴 경우에는
   책임을 집니다.
③ 회사는 등록물의 내용을 확인하지만, 그 확인이 **내용의 진실성을
   보증하는 것은 아닙니다.**

## 제11조 (서비스 중단)
① 점검·고장·천재지변으로 서비스를 멈출 수 있습니다.
② 예정된 점검은 **미리 알려 드립니다.**

## 제12조 (이용 제한)
① 제5조를 어기면 경고 · 일시 정지 · 이용 계약 해지를 할 수 있습니다.
② 제한하기 전에 **사유를 알리고 소명할 기회**를 드립니다. 다만
   긴급한 경우에는 먼저 조치하고 알려 드립니다.

## 제13조 (탈퇴)
① 언제든지 탈퇴하실 수 있습니다.
② 진행 중인 거래나 정산이 있으면 **그것이 끝난 뒤** 처리됩니다.
③ 탈퇴 후에도 법령이 정한 기간 동안 일부 기록이 보관됩니다.

## 제14조 (약관 변경)
① 약관을 바꿀 때는 **시행 7일 전**에 알려 드립니다.
② 회원에게 불리한 변경은 **30일 전**에 알리고, 동의하지 않으시면
   탈퇴하실 수 있습니다.

## 제15조 (분쟁)
① 분쟁은 서로 협의하여 해결합니다.
② 협의가 안 되면 **회사 주소지 관할 법원**으로 합니다.

---

**(주)한국바이오헬스케어 소개뱅크 사업부**
대표 노명석 · 사업자등록번호 429-88-01533
서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호

시행일 〔시행일〕$TERM$, 'v10.37 — P2P: 모든 업무를 본인인증 개인 회원도 합니다(거래 만들기 · 소개비 제시 · 계약서 발급 포함). 등록에 인증이 필요한 업종만 그 인증을 받은 뒤 등록 · 사업자 인증은 사업자로 소개비를 받을 때(선택)');

DO $$
DECLARE
  x record; r record; v_ver text; v_day text := to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY"년" FMMM"월" FMDD"일"');
BEGIN
  FOR x IN SELECT * FROM _terms_text LOOP
    UPDATE public.terms SET body = x.body, change_note = x.note
     WHERE code = x.code AND status IN ('DRAFT','LEGAL_REVIEW')
       AND fn_term_body_norm(body) <> fn_term_body_norm(x.body);
    SELECT * INTO r FROM public.terms WHERE code = x.code AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
    IF r.code IS NULL OR fn_term_body_norm(r.body) = fn_term_body_norm(x.body) THEN CONTINUE; END IF;
    v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
    WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
      v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
    END LOOP;
    INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note)
    VALUES (r.code, v_ver, r.title, replace(x.body, '〔시행일〕', v_day), r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, x.note);
    UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL WHERE code = r.code AND version = v_ver;
    RAISE NOTICE '% % 발행 — P2P(모든 업무 개인 · 인증이 필요한 등록만 그 인증)(이전 % 는 보관)', r.code, v_ver, r.version;
  END LOOP;
END $$;
