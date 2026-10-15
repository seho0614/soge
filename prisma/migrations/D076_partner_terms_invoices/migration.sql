-- v10.31 (W5 · 10/10 시안 기준) — 파트너 이용약관(리드 이용료 선불 충전 조항) · 리드 이용료 세금계산서
--
--   1) 파트너 이용약관 1.0 — **법무 검토 전 초안(LEGAL_REVIEW)** 으로 넣습니다. 발행(시행일 지정)은 검토 뒤 운영이 합니다.
--      글은 scripts/terms-text.js(한 벌) 와 같습니다(검정 SV-T5 — docs/terms/PARTNER.md).
--      필수 동의(is_required)는 끕니다 — 일반 회원 가입 동의 목록에 섞이지 않게. 파트너 입점 신청에서 받는 것은 발행 때 붙입니다.
--   2) 리드 이용료 세금계산서 — 달마다 유상 잔액에서 실제로 쓴 금액(차감 − 환급)으로 발행 요청 줄을 만듭니다(fn_lead_cash_invoice_month).
--      실제 발행(국세청 전송)은 연동 전이라 운영이 발행 번호를 적어 「발행」으로 바꿉니다(w6 운영 화면).

INSERT INTO public.terms(code, version, title, body, is_required, status, effective_from, display_order, change_note)
VALUES ('PARTNER', '1.0', '파트너 이용약관', $SGBT$# 파트너 이용약관

## 제1조 (목적)
이 약관은 **(주)한국바이오헬스케어 소개뱅크 사업부**(이하 "회사")가
운영하는 파트너센터에서, 입점한 사업자(이하 "파트너")가 상담 신청(리드)을
받고 확인하는 조건을 정합니다. 이 약관에 없는 것은 「이용약관」을 따릅니다.

## 제2조 (리드 이용료는 정보 이용료입니다)
① 리드 이용료(확인비용)는 상담 신청자의 연락처를 **여는 순간** 생기는
   정보 이용료입니다.
② 상담이 성사되든 안 되든 금액은 같습니다. 성사되었다고 더 내지 않고,
   결렬되었다고 돌려받지 않습니다.
③ 리드 이용료는 **소개비가 아닙니다.** 소개비는 당사자끼리 직접 주고받으며
   회사를 거치지 않습니다(이용약관 제3조).
④ 금액은 업종 기준 단가(파트너가 그보다 높게 정한 최고 확인비용이 있으면
   그 금액)에 리드 등급 비율을 곱해 정합니다. 등급은 신청자 확인 알림의
   결과가 정합니다.

## 제3조 (선불 충전)
① 파트너는 리드 이용료를 **미리 충전한 잔액**에서 냅니다. 잔액이 모자라면
   연락처를 열 수 없고, 잔액이 0이면 새 상담이 배정되지 않습니다.
② 충전금(유상 잔액)은 **회사가 제공하는 리드 확인 서비스의 이용료로만**
   씁니다. 다른 가맹점 · 다른 회원의 상품이나 서비스에 쓰거나, 다른 사람에게
   넘기거나, 현금으로 바꿀 수 없습니다.
③ 한 번에 충전하는 금액과 보유하는 유상 잔액에는 상한이 있으며, 그 금액은
   서비스 화면에 표시합니다.
④ 충전할 때 파트너 등급에 따른 할인분을 **보너스 잔액**으로 드립니다.
   보너스 잔액은 유상 잔액보다 먼저 쓰이고, 환불 대상이 아니며, 그 충전을
   환불하면 회수합니다.
⑤ 자동 청구를 켜시면 잔액이 정하신 금액 아래로 내려갈 때 등록된 카드로
   정하신 금액을 충전합니다. 언제든지 끄실 수 있습니다.

## 제4조 (반려와 환급)
① 허위 정보 · 연락 불가 · 중복 · 지역이나 분야 밖의 리드는 접수 후
   72시간 안에 반려를 신청하실 수 있습니다. 한 건에 한 번, 한 달에 받은
   리드의 15%까지입니다.
② 상담 결렬은 반려 사유가 아닙니다.
③ 반려가 인정되거나 회사의 위험감지로 무효가 되면, 그 건의 확인비용을
   **차감한 그대로 잔액으로 환급**합니다(보너스로 낸 몫은 보너스 잔액으로).

## 제5조 (환불)
① 남은 **유상 잔액**은 언제든지 환불을 신청하실 수 있습니다. 회사는 충전에
   쓰신 결제 수단의 결제를 취소하는 방법으로 돌려드립니다.
② 환불 수수료는 받지 않습니다.
③ 결제사 사정으로 취소가 되지 않으면 그 금액은 잔액으로 되돌리고 알려
   드립니다.
④ 파트너 계약이 끝나면 남은 유상 잔액의 환불을 안내합니다.

## 제6조 (전환 전 후불 청구분)
이 약관 시행 전에 생긴 미청구 이용료는 종전 방식(후불 청구)대로 청구합니다.

## 제7조 (세금계산서)
충전하고 사용하신 이용료의 세금계산서는 관련 법령에 따라 발행하며,
발행 상태는 파트너센터 「정산」 화면에서 보실 수 있습니다.

---

시행일 〔시행일〕$SGBT$, false, 'LEGAL_REVIEW', 'infinity', 20,
        '10/10 시안 기준 — 리드 이용료 후불 청구 → 선불 충전(제3조) · 반려 인정 = 환급(제4조) · 유상 잔액 환불(제5조). 법무 검토 전')
ON CONFLICT (code, version) DO NOTHING;

CREATE TABLE public.lead_cash_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES public.partners(id),
  ym            text NOT NULL CHECK (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  total         bigint NOT NULL CHECK (total > 0),
  supply        bigint NOT NULL CHECK (supply > 0),
  vat           bigint NOT NULL CHECK (vat >= 0),
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','ISSUED','CANCELED')),
  invoice_no    text UNIQUE,
  issued_on     date,
  issued_by     uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, ym),
  CONSTRAINT ck_lci_sum CHECK (supply + vat = total),
  CONSTRAINT ck_lci_issued CHECK (state <> 'ISSUED' OR (invoice_no IS NOT NULL AND issued_on IS NOT NULL))
);
COMMENT ON TABLE public.lead_cash_invoices IS '리드 이용료 세금계산서 발행 요청(D076) — 달마다 유상 잔액 실사용액(부가세 포함 금액을 공급가액 · 세액으로 나눔)';

/* 한 달 치 발행 요청 줄 — 그 달(한국 시각)에 유상 잔액에서 실제로 쓴 금액(차감 − 환급). 이미 있으면 건너뜁니다 */
CREATE FUNCTION public.fn_lead_cash_invoice_month(p_ym text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_n int;
BEGIN
  IF p_ym !~ '^[0-9]{4}-[0-9]{2}$' THEN RAISE EXCEPTION 'LEADCASH: 달은 YYYY-MM 입니다'; END IF;
  v_from := (p_ym || '-01')::date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_to   := ((p_ym || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';
  IF v_to > now() THEN RAISE EXCEPTION 'LEADCASH: 끝나지 않은 달(%)은 만들 수 없습니다', p_ym; END IF;
  INSERT INTO lead_cash_invoices(partner_id, ym, total, supply, vat)
  SELECT e.partner_id, p_ym, x.t, round(x.t / 1.1)::bigint, x.t - round(x.t / 1.1)::bigint
    FROM (SELECT e.partner_id, sum(l.amount)::bigint AS t
            FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
           WHERE l.account = 'PARTNER_PAID' AND e.kind IN ('USE','RESTORE')
             AND e.created_at >= v_from AND e.created_at < v_to
           GROUP BY e.partner_id) x
    JOIN (SELECT DISTINCT partner_id FROM lead_cash_entries) e ON e.partner_id = x.partner_id
   WHERE x.t > 0
  ON CONFLICT (partner_id, ym) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
