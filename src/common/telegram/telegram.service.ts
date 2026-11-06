import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.200 (D178 · docs/316) — 급한 운영 알림을 텔레그램으로
 *
 *   봇 토큰: 외부 연동 › 연동 키 › 메일 칸 「텔레그램 봇 토큰」(TELEGRAM_BOT_TOKEN — IntegrationSecretService 가 process.env 에 얹음 · 없으면 .env)
 *   받을 곳: 설정 ops.telegram_chat(대화방 번호 · 비어 있으면 꺼짐)
 *   주소:    TELEGRAM_API_BASE(기본 https://api.telegram.org — 시험은 가짜 서버)
 *
 *   ★ 토큰은 주소 안에 들어가므로 오류 글 · 로그에 주소를 남기지 않습니다(까닭 코드 · 상태 번호만).
 *   ★ 보내는 글은 알림 제목 · 등급 · 시각뿐 — 알림 내용(detail)은 넣지 않습니다.
 * ------------------------------------------------------------------- */
export type TelegramReason = 'NO_TOKEN' | 'NO_CHAT';
export interface TelegramResult { ok: boolean; errorKind?: 'AUTH' | 'REJECTED' | 'SERVER' | 'TIMEOUT' | 'NETWORK'; status?: number; error?: string }

@Injectable()
export class TelegramService {
  private readonly log = new Logger(TelegramService.name);
  constructor(private readonly db: DatabaseService) {}

  private token() { return process.env.TELEGRAM_BOT_TOKEN?.trim() || ''; }
  private base() { return (process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, ''); }

  async chat(): Promise<string> {
    const [c] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.telegram_chat'), '') AS v`);
    return (c?.v ?? '').trim();
  }

  /** 운영 알림 화면 「텔레그램」 줄 — 준비 여부 · 까닭(NO_TOKEN · NO_CHAT) · 대화방(가운데 가림) */
  async status(): Promise<{ ready: boolean; reason: TelegramReason | null; chat: string | null }> {
    const chat = await this.chat();
    const masked = chat ? maskChat(chat) : null;
    if (!this.token()) return { ready: false, reason: 'NO_TOKEN', chat: masked };
    if (!chat) return { ready: false, reason: 'NO_CHAT', chat: null };
    return { ready: true, reason: null, chat: masked };
  }

  private async call(method: string, body?: unknown): Promise<{ r: TelegramResult; json: any }> {
    const timeout = Math.min(Math.max(Number(process.env.TELEGRAM_TIMEOUT_MS) || 8000, 1000), 30000);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(`${this.base()}/bot${this.token()}/${method}`, {
        method: body === undefined ? 'GET' : 'POST', signal: ac.signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = (await res.text()).slice(0, 20000);
      let json: any = null;
      try { json = JSON.parse(text); } catch { json = null; }
      const desc = String(json?.description ?? '').slice(0, 100);
      if (res.status === 401 || res.status === 403 || res.status === 404) return { r: { ok: false, errorKind: 'AUTH', status: res.status, error: desc }, json };
      if (res.status >= 500) return { r: { ok: false, errorKind: 'SERVER', status: res.status, error: desc }, json };
      if (!res.ok || json?.ok !== true) return { r: { ok: false, errorKind: 'REJECTED', status: res.status, error: desc }, json };
      return { r: { ok: true }, json };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      return { r: { ok: false, errorKind: aborted ? 'TIMEOUT' : 'NETWORK', error: aborted ? `${timeout}ms 안에 응답 없음` : String((e as Error)?.name ?? 'error') }, json: null };
    } finally { clearTimeout(timer); }
  }

  /** 한 통(4,000자에서 자름). 준비 안 됐으면 보내지 않음 — 부르는 쪽이 status() 로 먼저 봄 */
  async send(text: string, chatId?: string): Promise<TelegramResult> {
    const chat = chatId ?? (await this.chat());
    if (!this.token() || !chat) return { ok: false, errorKind: 'REJECTED', error: 'NOT_READY' };
    const { r } = await this.call('sendMessage', { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true });
    if (!r.ok) this.log.warn(`텔레그램 보내기 실패 ${r.errorKind} ${r.status ?? ''}`);
    return r;
  }

  /** 봇에게 최근 말을 건 대화방(getUpdates · 최근 100건) — 「대화방 찾기」. 토큰만 있으면 됨 */
  async findChats(): Promise<{ r: TelegramResult; chats: Array<{ id: string; type: string; title: string }> }> {
    if (!this.token()) return { r: { ok: false, errorKind: 'REJECTED', error: 'NO_TOKEN' }, chats: [] };
    const { r, json } = await this.call('getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
    if (!r.ok) return { r, chats: [] };
    const seen = new Map<string, { id: string; type: string; title: string }>();
    for (const u of Array.isArray(json?.result) ? json.result : []) {
      const c = u?.message?.chat ?? u?.channel_post?.chat ?? u?.my_chat_member?.chat;
      if (!c || c.id === undefined) continue;
      const title = String(c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '').slice(0, 60);
      seen.set(String(c.id), { id: String(c.id), type: String(c.type ?? ''), title });
    }
    return { r, chats: [...seen.values()].slice(-10) };
  }
}

/** 대화방 번호 가운데 가림(-1001234567890 → -100…7890) */
export function maskChat(id: string): string {
  return id.length <= 6 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
