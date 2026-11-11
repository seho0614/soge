import { Injectable, Logger } from '@nestjs/common';
import { TG_MAX } from '../telegram/telegram.service';

/* ---------------------------------------------------------------------
 * v10.237 (D200 · docs/377) — 급한 운영 알림 · 하루 요약을 슬랙으로도
 *
 *   웹훅 주소: 외부 연동 › 연동 키 › 메일 칸 「슬랙 웹훅 주소」(SLACK_WEBHOOK_URL — IntegrationSecretService 가 process.env 에 얹음 · 없으면 .env)
 *   받을 곳:   웹훅 주소 하나에 채널 하나(슬랙 앱에서 고름) — 따로 설정 없음 · 주소가 없으면 꺼짐
 *
 *   ★ 웹훅 주소 자체가 비밀(아는 사람은 누구나 그 채널에 글을 올림)이라 오류 글 · 로그에 주소를 남기지 않습니다(까닭 코드 · 상태 번호만).
 *   ★ 보내는 글은 텔레그램과 같은 글(alert-push.ts) — 알림 제목 · 등급 · 시각뿐, 알림 내용(detail)은 넣지 않습니다.
 *   ★ 글자 수는 텔레그램과 같은 4,000자로 나눔(슬랙 한도는 더 크지만 같은 글을 보내려고).
 * ------------------------------------------------------------------- */
export type SlackReason = 'NO_WEBHOOK';
export interface SlackResult { ok: boolean; errorKind?: 'AUTH' | 'REJECTED' | 'SERVER' | 'TIMEOUT' | 'NETWORK'; status?: number; error?: string }

@Injectable()
export class SlackService {
  private readonly log = new Logger(SlackService.name);

  private url() { return process.env.SLACK_WEBHOOK_URL?.trim() || ''; }

  /** 운영 알림 화면 「슬랙」 줄 — 준비 여부 · 까닭(NO_WEBHOOK) · 주소 끝 4자 */
  status(): { ready: boolean; reason: SlackReason | null; hook: string | null } {
    const u = this.url();
    if (!u) return { ready: false, reason: 'NO_WEBHOOK', hook: null };
    return { ready: true, reason: null, hook: `…${u.slice(-4)}` };
  }

  /** 한 통(4,000자에서 자름). 준비 안 됐으면 보내지 않음 — 부르는 쪽이 status() 로 먼저 봄.
   *  슬랙은 & < > 를 글자 그대로 받지 않으므로 바꿔 보냄 · mrkdwn 끔(제목의 * _ ~ 가 꾸밈으로 바뀌지 않게) */
  async send(text: string): Promise<SlackResult> {
    const u = this.url();
    if (!u) return { ok: false, errorKind: 'REJECTED', error: 'NOT_READY' };
    if (text.length > TG_MAX) this.log.warn(`슬랙 글이 ${text.length}자라 ${TG_MAX}자에서 자름`);
    const body = { text: escapeSlack(text.slice(0, TG_MAX)), mrkdwn: false, unfurl_links: false, unfurl_media: false };
    const timeout = Math.min(Math.max(Number(process.env.SLACK_TIMEOUT_MS) || 8000, 1000), 30000);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(u, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const desc = (await res.text()).slice(0, 100);
      /* 슬랙 웹훅 — 200 「ok」 · 400 invalid_payload · 403 action_prohibited · 404 no_service(지운 앱 · 주소) · 410 channel_is_archived */
      const r: SlackResult = res.ok ? { ok: true }
        : res.status === 403 || res.status === 404 || res.status === 410 ? { ok: false, errorKind: 'AUTH', status: res.status, error: desc }
        : res.status >= 500 ? { ok: false, errorKind: 'SERVER', status: res.status, error: desc }
        : { ok: false, errorKind: 'REJECTED', status: res.status, error: desc };
      if (!r.ok) this.log.warn(`슬랙 보내기 실패 ${r.errorKind} ${r.status ?? ''}`);
      return r;
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      this.log.warn(`슬랙 보내기 실패 ${aborted ? 'TIMEOUT' : 'NETWORK'}`);
      return { ok: false, errorKind: aborted ? 'TIMEOUT' : 'NETWORK', error: aborted ? `${timeout}ms 안에 응답 없음` : String((e as Error)?.name ?? 'error') };
    } finally { clearTimeout(timer); }
  }
}

/** 슬랙 글 — & < > 만 바꿈(슬랙 문서의 「제어 문자」 셋) */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
