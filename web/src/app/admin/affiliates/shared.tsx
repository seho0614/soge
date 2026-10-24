import { openFile, fmtSize, TYPE_LABEL } from '../../../lib/files';

export interface FileRef { fileId: string | null; fileName: string | null; fileType: string | null; fileSize: number | string | null; fileKey?: string | null }

/** 첨부 열기 버튼 — 5분짜리 주소를 받아 새 창으로 */
export function FileCell({ f, onErr }: { f: FileRef; onErr: (m: string) => void }) {
  if (!f.fileId) return f.fileKey ? <span className="dim mono">{f.fileKey} (파일 없음)</span> : <span className="dim">—</span>;
  return (
    <>
      <button className="btn-sm" data-file-id={f.fileId}
              onClick={() => void openFile(f.fileId!).catch((e) => onErr(e instanceof Error ? e.message : '파일을 열지 못했습니다.'))}>파일 열기</button>
      <div className="dim">{f.fileName} · {TYPE_LABEL[f.fileType ?? ''] ?? ''} {fmtSize(f.fileSize)}</div>
    </>
  );
}
