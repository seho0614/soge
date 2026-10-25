import { ymdKst } from '@/lib/format';
/* 소개광장 응답 모양 — /community/* (2026-10-02 실측) */

/* 게시판 이름은 사전(plaza.board.*) — v10.101 2-5b. 모르는 코드는 코드 그대로 보입니다(isBoard 로 거름)
 * v10.47 (D100) — FOOD 우리동네 맛집 글(글 하나 보기 · 고치기에서만 보임 · 「전체」 목록에는 섞이지 않음) */
export const BOARDS = ['REVIEW', 'TRADE', 'QNA', 'NOTICE', 'FOOD'] as const;
export type BoardCode = (typeof BOARDS)[number];
export const isBoard = (c: string | null | undefined): c is BoardCode => !!c && (BOARDS as readonly string[]).includes(c);
/** 회원이 고를 수 있는 게시판 (공지는 운영만 씁니다) */
export const WRITABLE = ['REVIEW', 'TRADE', 'QNA'] as const;

export interface PostRow {
  id: string; board: string; title: string; state: string; views: number;
  commentCount: number; isPinned: boolean; createdAt: string; author: string; pendingMine: boolean;
}

export interface PostComment {
  id: string; parentId: string | null; body: string | null; createdAt: string; author: string; hidden: boolean;
  /** v10.80 — 내 댓글(신고 단추 숨김) · 가린 까닭(REPORT 신고 3건 · ADMIN 운영자) */
  mine?: boolean; hiddenBy?: 'REPORT' | 'ADMIN' | null;
  /** v10.105 (3-3) — 기계 번역이 얹힘 */
  translated?: boolean;
}

/** GET /community/posts/{id} — 없으면 ok:false, 가려진/검수 중인 남의 글은 hidden/pending 만, 지운 글은 deleted 와 댓글만 옵니다(v10.26 · G-173) */
export interface PostDetail {
  ok: boolean; note?: string;
  id?: string; board?: string; title?: string; body?: string; state?: string; views?: number;
  classifiedBy?: string | null; classifyTerms?: string[] | null; hiddenReason?: string | null;
  createdAt?: string; author?: string; mine?: boolean;
  hidden?: boolean; pending?: boolean; deleted?: boolean;
  comments?: PostComment[];
  /** v10.105 (3-3) — 기계 번역이 얹힘 · 「번역 보기」를 보여 줄지 */
  translated?: boolean; i18nAvailable?: boolean;
}

export interface ClassifyResult {
  board: string | null; score: number; matched: string[]; confident: boolean; note: string | null;
}

export const dt = (iso?: string | null) =>
  iso ? ymdKst(iso) : '';
