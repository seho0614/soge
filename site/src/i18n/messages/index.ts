/**
 * 사전 묶기 (v10.97 · 2-2 · docs/155 · v10.98 2-3 · docs/156 · v10.99 2-4 · docs/157)
 *
 *   ko.json · en.json    — 2-1 사전(머리줄 · 바닥줄 · 로그인 · 가입). 모든 화면에 내려보냅니다.
 *   ko/<묶음>.json        — 2-2 부터 묶음(이름공간)마다 파일 하나.
 *     SHARED  여러 화면이 쓰는 묶음 — 모든 화면에 내려보냅니다.
 *     PAGE    그 화면에서만 쓰는 묶음 — 그 화면이 <Msgs ns={[…]}> 로 감싼 곳에만 내려보냅니다(손님 화면 무게).
 *   서버 화면(getTranslations)은 묶음과 상관없이 모든 사전을 봅니다 — 가리는 것은 브라우저로 보내는 사전뿐입니다.
 */
import base from './ko.json';
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

const SHARED = { gwan, money, shop, listing, searchPop, consult, refcode };   // v10.98 consult · refcode
const PAGE = { main, search, detail, request, order, hlt, my, myDeal };   // v10.98 detail · request · v10.99 order · hlt · my · myDeal

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
  const over: Dict = { ...(await load(locale)) };
  const parts = await Promise.all(NS.map((n) => load(`${locale}/${n}`)));
  NS.forEach((n, i) => { over[n] = parts[i] ?? {}; });
  return merge(KO as unknown as Dict, over);
}

export function pick(all: Record<string, unknown>, ns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(ns.filter((n) => n in all).map((n) => [n, all[n]]));
}
