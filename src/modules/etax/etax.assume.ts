import { EtaxAdapter, EtaxDoc, EtaxResult } from './etax.adapter';

/**
 * v10.34 (D093) 간주 어댑터 — 국세청에 **보내지 않습니다**.
 *
 * 승인번호를 지어내지 않습니다(approvalNo = null). 실제 승인번호처럼 보이는 숫자를 만들면
 * 업체 · 세무 신고에서 진짜 번호로 오해합니다. 남는 것은 내부 문서 번호(docKey)와 「간주」 표시뿐입니다.
 * 설정 assume.etax 가 on 이면 이 어댑터가 쓰이고, 그 사실은 오픈 체크리스트(v_open_blockers 「간주 모드 켜짐」)에 남습니다.
 */
export class AssumeEtaxAdapter implements EtaxAdapter {
  readonly name = 'assume' as const;

  async issue(_doc: EtaxDoc): Promise<EtaxResult> {
    return { status: 'ASSUMED', approvalNo: null };
  }

  /** 간주 발행은 업체에 문서가 없습니다 — 있는 그대로 「간주」 */
  async status(_docKey: string): Promise<EtaxResult> {
    return { status: 'ASSUMED', approvalNo: null };
  }

  /** 간주 발행의 취소 — 국세청 쪽에 아무것도 없으므로 내부 기록만 취소 */
  async cancel(): Promise<EtaxResult> {
    return { status: 'CANCELED', approvalNo: null, amendApprovalNo: null };
  }
}
