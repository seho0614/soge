/**
 * 사전 묶기 (v10.97 · 2-2 · docs/155 · v10.98 2-3 · docs/156 · v10.99 2-4 · docs/157 · v10.100 2-5a · docs/158 · v10.101 2-5b · docs/159 · v10.102 2-5c · docs/160)
 *
 *   ko.json · en.json    — 2-1 사전(머리줄 · 바닥줄 · 로그인 · 가입). 모든 화면에 내려보냅니다.
 *   ko/<묶음>.json        — 2-2 부터 묶음(이름공간)마다 파일 하나.
 *     SHARED  여러 화면이 쓰는 묶음 — 모든 화면에 내려보냅니다.
 *     PAGE    그 화면에서만 쓰는 묶음 — 그 화면이 <Msgs ns={[…]}> 로 감싼 곳에만 내려보냅니다(손님 화면 무게).
 *   서버 화면(getTranslations)은 묶음과 상관없이 모든 사전을 봅니다 — 가리는 것은 브라우저로 보내는 사전뿐입니다.
 */
import base from './ko.json';
import { LANG_FALLBACK } from '../drafts';   // v10.523 (D278) 일본어 · 중국어 — 빠진 문장은 영어로
import main from './ko/main.json';
import search from './ko/search.json';
import gwan from './ko/gwan.json';
import money from './ko/money.json';
import shop from './ko/shop.json';
import listing from './ko/listing.json';
import searchPop from './ko/searchPop.json';
import detail from './ko/detail.json';
import consult from './ko/consult.json';
import request from './ko/request.json';
import refcode from './ko/refcode.json';
import order from './ko/order.json';
import hlt from './ko/hlt.json';
import my from './ko/my.json';
import myDeal from './ko/myDeal.json';
import partner from './ko/partner.json';
import partnerOps from './ko/partnerOps.json';
import affiliate from './ko/affiliate.json';
import billing from './ko/billing.json';
import plaza from './ko/plaza.json';
import forms from './ko/forms.json';
import deal from './ko/deal.json';
import join from './ko/join.json';
import policy from './ko/policy.json';
import aiChat from './ko/aiChat.json';
import safety from './ko/safety.json';
import codes from './ko/codes.json';
import lpx from './ko/lpx.json';   // v10.549 ~ 552 (D286) 가격 제안 · 자리 비움 · 지역별 시세(화면 전용 묶음)
import lsx from './ko/lsx.json';   // v10.513 ~ 516 (D276) 저장한 검색 · 매물 관리 도구 · AI 요약
import smx from './ko/smx.json';   // v10.555 (D287) 판매자센터 리뷰 답글(화면 전용 묶음 · 서버 화면만 씀)
import lsy from './ko/lsy.json';   // v10.525 · 526 (D279) 매물 동영상 · 사진 점검
import mbx from './ko/mbx.json';   // v10.501 ~ 504 (D273) 최근 본 · 비교하기 · 가격 알림 · 회원 대화(화면 전용 묶음)
import vsx from './ko/vsx.json';   // v10.542 · 544 (D284) 방문 예약 · 파트너 자료 내려받기(화면 전용 묶음)
import mkx from './ko/mkx.json';   // v10.538 · 540 (D283) 웹 푸시 · 소개몰 공동구매(화면 전용 묶음 · 서버 화면만 씀)
import slx from './ko/slx.json';   // v10.532 · 534 (D281) 판매자센터 월 정산서 · 파트너센터 성과 추이(화면 전용 묶음 · 서버 화면만 씀)

const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode, aiChat };   // v10.98 consult · refcode · v10.110 aiChat(사이트 공통 AI 상담 단추)
const PAGE = { main, search, detail, request, order, hlt, my, myDeal, partner, partnerOps, affiliate, billing, plaza, forms, deal, join, policy, safety, codes, mbx, lsx, lsy, slx, mkx, vsx, lpx, smx };   // v10.122 codes(서버 코드 이름표 code_labels — 다른 언어 화면 글자) · v10.119 safety(안전 수칙 · 사기 유형 · 서버 화면만) · v10.98 detail · request · v10.99 order · hlt · my · myDeal · v10.100 partner · partnerOps · affiliate · billing · v10.101 plaza · forms · deal · join · v10.102 policy · 새 묶음은 끝에 더함(main · search 가 맨 앞 — test_v1097)

export const KO = { ...base, ...SHARED, ...PAGE };
export type PageNs = keyof typeof PAGE;
/** 모든 화면에 내려보내는 묶음 */
export const GLOBAL_NS = [...Object.keys(base), ...Object.keys(SHARED)];

type Dict = { [k: string]: string | Dict };
function merge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? merge(b, v) : v;
  }
  return out;
}

const NS = [...Object.keys(SHARED), ...Object.keys(PAGE)];
const load = (path: string) => import(`./${path}.json`).then((m) => m.default as Dict).catch(() => ({}) as Dict);

/** 그 언어 사전 — 한국어를 바탕으로 덮습니다(빠진 문장은 한국어 · 빈칸 금지) */
export async function messagesFor(locale: string): Promise<Dict> {
  if (locale === 'ko') return KO as unknown as Dict;
  /* v10.523 (D278 · docs/661) 일본어 · 중국어(간체) — 기계 번역 초안(drafts.ts) · 빠진 문장은 영어 → 한국어 순 */
  const fb = LANG_FALLBACK[locale];
  if (fb) return merge(await messagesFor(fb), await draftOver(locale));
  const over: Dict = { ...(await load(locale)) };
  const parts = await Promise.all(NS.map((n) => load(`${locale}/${n}`)));
  NS.forEach((n, i) => { over[n] = parts[i] ?? {}; });
  return merge(KO as unknown as Dict, over);
}

export function pick(all: Record<string, unknown>, ns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(ns.filter((n) => n in all).map((n) => [n, all[n]]));
}

/* v10.523 (D278) — 초안 언어(ja · zh)의 덮을 사전 · 맨 위 "_draft" 표시 칸은 화면으로 내려보내지 않음 · 묶음 파일이 없으면 그 묶음은 영어 그대로 */
async function draftOver(locale: string): Promise<Dict> {
  const over: Dict = { ...(await load(locale)) };
  delete over._draft;
  const parts = await Promise.all(NS.map((n) => load(`${locale}/${n}`)));
  NS.forEach((n, i) => { const p = parts[i]; if (p && Object.keys(p).length) over[n] = p; });
  return over;
}
