import { Injectable } from '@nestjs/common';
import { sgb, sgbOk } from '../../core/sgb-client';

/* e3.5 (docs/011) 세금계산서 보내기 — 소개뱅크 etax.service 와 같은 이름 · 회계가 쓰는 send 만
 *   업체 전송 · 연동 키 · 전송 기록(etax_send_log)은 소개뱅크(대표 11/26 「소개뱅크가 대신 호출」) → POST /internal/erp/etax/send
 *   ERP 표 acct_tax_invoices 의 상태 고치기는 소개뱅크 응답을 받아 ERP 쪽 코드가 그대로 함 */
@Injectable()
export class EtaxService {
  async send(slug: string, id: string, mode: 'send' | 'resend') {
    return sgbOk(await sgb.post('/internal/erp/etax/send', { slug, id, mode }));
  }
}
