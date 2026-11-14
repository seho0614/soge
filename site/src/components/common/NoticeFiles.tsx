/**
 * v10.295 (D217 · docs/416) — 공지 첨부(그림 · PDF · 3개까지).
 *   그림은 공지 본문 아래에 바로 보임(누르면 새 창에서 크게) · PDF 는 내려받기 링크.
 *   바이트는 GET /api/v1/notices/{id}/files/{n} — 공지 목록과 같은 기준(보는 사람의 등급)으로 서버가 다시 봄.
 *   고객센터 › 공지사항 · 제휴 파트너센터 › 공지사항 · 안심 파트너센터 › 공지 · 알림 · 판매자센터 「소개몰 공지」가 같이 씀.
 */
export interface NoticeFile { n: number; name: string; contentType: string; size: number }

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

export function NoticeFiles({ id, files, label }: { id: string; files?: NoticeFile[] | null; label: string }) {
  if (!files || !files.length) return null;
  const src = (f: NoticeFile) => `/api/v1/notices/${id}/files/${f.n}`;
  const imgs = files.filter((f) => f.contentType.startsWith('image/'));
  const docs = files.filter((f) => !f.contentType.startsWith('image/'));
  return (
    <div className="nt-files" data-notice-files={files.length}>
      {imgs.map((f) => (
        <a key={f.n} href={src(f)} target="_blank" rel="noopener noreferrer" title={f.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(f)} alt={f.name} loading="lazy" data-notice-img={f.n} />
        </a>
      ))}
      {docs.length > 0 && (
        <p className="nt-docs">
          <span className="dim">{label}</span>{' '}
          {docs.map((f) => (
            <a key={f.n} href={src(f)} download={f.name} data-notice-doc={f.n}>📄 {f.name} <span className="dim">({size(f.size)})</span></a>
          ))}
        </p>
      )}
    </div>
  );
}
