/**
 * v10.555 (D287 · docs/693) 상품 상세 「리뷰」 줄 아래 답글 — 서버 부품(사전 열쇠를 새로 쓰지 않음)
 *   운영자 답글은 hlt.common 의 「소개몰」 글자 · 입점 판매자 답글은 판매자 이름 · 상품 문의 답과 같은 모양(hlt-ans)
 *   답글 스위치(smx.review_reply)가 꺼져 있거나 답글이 없으면 서버가 reply 를 주지 않아 아무것도 그리지 않음
 */
export type SmxReplyView = { kind: string; byName: string | null; body: string; createdAt: string; updatedAt: string; edited: boolean };

export function SmxReplyLine({ reply, mallLabel }: { reply?: SmxReplyView | null; mallLabel: string }) {
  if (!reply || !reply.body) return null;
  const by = reply.kind === 'SELLER' && reply.byName ? reply.byName : mallLabel;
  return <p className="hlt-ans" data-smx-reply={reply.kind}><b>{by}</b> {reply.body}</p>;
}
