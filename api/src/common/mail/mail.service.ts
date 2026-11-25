import { Injectable } from '@nestjs/common';
import { sgb, sgbOk } from '../../core/sgb-client';

/* e3.5 (docs/011) 메일 — 소개뱅크 common/mail/mail.service 와 같은 이름 · ready · send 만(미수 독촉 dunning)
 *   보내는 주소 · SMTP · 반송 처리는 소개뱅크 한 곳 → 내부 API */
export interface MailMessage { to: string; subject: string; text: string; html?: string }
@Injectable()
export class MailService {
  async ready(): Promise<boolean> {
    try { return !!sgbOk<{ ready: boolean }>(await sgb.get('/internal/erp/mail/ready')).ready; } catch { return false; }
  }
  async send(m: MailMessage) {
    return sgbOk<{ ok: boolean; messageId?: string }>(await sgb.post('/internal/erp/mail', m));
  }
}
