import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { SlackService } from '../../common/slack/slack.service';

/* ---------------------------------------------------------------------
 * v10.238 (docs/379) — 급한 알림 받는 길(메일 · 텔레그램 · 슬랙)이 몇 개 준비됐는지
 *   운영 상태 한눈에 「급한 알림 받는 길」 줄 · 하루 요약 한 줄 · 대표 할 일(v10.240)이 같은 셈을 씀.
 *   메일은 메일 설정(status) + 받는 주소(ops.digest_to)가 다 있어야 「준비됨」.
 *
 * v10.239 (docs/379) — 알림 길 연속 실패 경보 ALERT_CHANNEL_FAIL(CRITICAL)
 *   켜 둔 길이 보내기에 실패(SEND_…)한 채 60분(시험은 ALERT_FAIL_MINUTES) 넘게 이어지면 길마다 한 건.
 *   CRITICAL 이라 살아 있는 다른 길로 저절로 감(대상 함수 fn_ops_alert_*_pending 이 CRITICAL 을 받음).
 *   준비 안 됨(주소 · 토큰 없음)은 실패가 아님 — 「받는 길」 줄이 알림. 그 길이 다시 보내지거나 꺼지면 「풀림」.
 *   처음 실패한 시각은 이 프로세스 기억(다시 띄우면 처음부터 셈 — 경보가 늦어질 뿐 잘못 나지 않음).
 * ------------------------------------------------------------------- */
export type ChannelKey = 'mail' | 'telegram' | 'slack';
export type ChannelState = { key: ChannelKey; name: string; ready: boolean; reason: string | null };
export const CHANNEL_NAME: Record<ChannelKey, string> = { mail: '메일', telegram: '텔레그램', slack: '슬랙' };
const REASON_TEXT: Record<string, string> = {
  NO_SMTP: '메일 설정 없음', NOT_VERIFIED: '메일 스위치 꺼짐', NO_FROM: '보내는 주소 없음', NO_TO: '받는 주소(ops.digest_to) 없음',
  NO_TOKEN: '봇 토큰 없음', NO_CHAT: '대화방 없음', NO_WEBHOOK: '웹훅 주소 없음',
};
const SEND_TEXT: Record<string, string> = {
  SEND_AUTH: '받는 쪽이 거절(토큰 · 웹훅 주소가 바뀌었거나 지워짐)', SEND_REJECTED: '보낸 글을 받지 않음', SEND_SERVER: '상대 서버 오류',
  SEND_TIMEOUT: '응답 없음(시간 초과)', SEND_NETWORK: '서버에서 나가는 길이 막힘',
};
export const reasonText = (r: string | null) => (r ? REASON_TEXT[r] ?? SEND_TEXT[r] ?? r : '');

@Injectable()
export class AlertChannelsService {
  private static firstFail: Partial<Record<ChannelKey, { at: number; reason: string }>> = {};

  constructor(private readonly db: DatabaseService, private readonly mail: MailService,
              private readonly telegram: TelegramService, private readonly slack: SlackService) {}

  async channels(): Promise<{ list: ChannelState[]; ready: number }> {
    const [ms, ts] = await Promise.all([this.mail.status(), this.telegram.status()]);
    const [c] = await this.db.query<{ to: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to"`);
    const ss = this.slack.status();
    const list: ChannelState[] = [
      { key: 'mail', name: CHANNEL_NAME.mail, ready: ms.ready && !!(c?.to ?? '').trim(), reason: ms.ready ? ((c?.to ?? '').trim() ? null : 'NO_TO') : ms.reason },
      { key: 'telegram', name: CHANNEL_NAME.telegram, ready: ts.ready, reason: ts.ready ? null : ts.reason },
      { key: 'slack', name: CHANNEL_NAME.slack, ready: ss.ready, reason: ss.ready ? null : ss.reason },
    ];
    return { list, ready: list.filter((x) => x.ready).length };
  }

  /** 하루 요약 · 운영 상태 한 줄 — 「메일 준비 안 됨(메일 설정 없음) · 텔레그램 준비됨 · …」 */
  static line(list: ChannelState[]): string {
    return list.map((x) => x.ready ? `${x.name} 준비됨` : `${x.name} 준비 안 됨(${reasonText(x.reason)})`).join(' · ');
  }

  /** v10.239 — launch_watch 의 보내기 결과로 실패 시각을 세고, 기준을 넘으면 경보 · 다시 되거나 꺼지면 풀림. 돌려줌: 새 경보 · 풀린 수 */
  async failWatch(res: Record<ChannelKey, { pending: number; reason: string | null }>): Promise<{ raised: ChannelKey[]; resolved: number; failing: ChannelKey[] }> {
    const env = process.env.ALERT_FAIL_MINUTES;   /* 시험용(점검판 두 번째 API) — 운영은 비워 둠 = 60분 */
    const limit = env !== undefined && env !== '' && Number.isFinite(Number(env)) ? Number(env) : 60;
    const raised: ChannelKey[] = []; const failing: ChannelKey[] = []; let resolved = 0;
    for (const ch of ['mail', 'telegram', 'slack'] as ChannelKey[]) {
      const r = res[ch];
      const sendFail = !!r?.reason && r.reason.startsWith('SEND_') && r.pending > 0;
      if (!sendFail) {
        /* 보냈거나 보낼 것이 없거나 꺼짐(준비 안 됨) — 실패가 끝남 */
        delete AlertChannelsService.firstFail[ch];
        const u = await this.db.query(
          `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = 'ALERT_CHANNEL_FAIL' AND resolved_at IS NULL AND detail->>'channel' = $1 RETURNING id`,
          [ch, r?.reason ? `${CHANNEL_NAME[ch]} 꺼짐(${reasonText(r.reason)})` : `${CHANNEL_NAME[ch]} 다시 보내짐`]);
        resolved += u.length;
        continue;
      }
      failing.push(ch);
      const f = AlertChannelsService.firstFail[ch] ?? (AlertChannelsService.firstFail[ch] = { at: Date.now(), reason: r.reason! });
      f.reason = r.reason!;
      const min = Math.floor((Date.now() - f.at) / 60_000);
      if (min < limit) continue;
      const [open] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'ALERT_CHANNEL_FAIL' AND resolved_at IS NULL AND detail->>'channel' = $1`, [ch]);
      if ((open?.n ?? 0) > 0) continue;
      await this.db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('ALERT_CHANNEL_FAIL', 'CRITICAL', $1, $2::jsonb) ON CONFLICT DO NOTHING`,
        [`급한 알림 ${CHANNEL_NAME[ch]}이(가) ${min}분 넘게 보내지지 않습니다 — ${reasonText(r.reason)} · 못 보낸 알림 ${r.pending}건 · 운영 화면 › 운영 알림 · 외부 연동 › 연동 키를 확인하십시오`,
         JSON.stringify({ channel: ch, reason: r.reason, minutes: min, pending: r.pending, since: new Date(f.at).toISOString() })]);
      raised.push(ch);
    }
    return { raised, resolved, failing };
  }
}
