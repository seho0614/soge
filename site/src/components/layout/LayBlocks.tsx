import { GwanBlocks } from '@/components/gwan/GwanBlocks';

/* v10.696 (D321 · docs/804) 꾸밀 페이지의 구역 사이 블록 — 관 페이지 블록 그리기(GwanBlocks)를 그대로 씀 · 매물 · 업종 · 공지 블록은 code 관 기준 */
export function LayBlocks({ code, blocks, at, k }: { code: string; blocks?: Array<Record<string, any>>; at: string; k?: string }) {
  if (!blocks?.length) return null;
  /* v10.729 손님 한 줄 의견 블록은 꾸밀 페이지 열쇠(k · 없으면 code)로 모음 — slug 「lay:<열쇠>:<자리>」 */
  return <div className="lay-ins" data-lay-ins={at}><GwanBlocks code={code} page={{ slug: `lay:${k ?? code}:${at}`, title: '', blocks, version: 0, publishedAt: '' }} /></div>;
}
