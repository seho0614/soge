'use client';
/**
 * v10.327 (docs/455) — 주소 끝이 #n-<id> 인데 그 공지가 지금 쪽(30개)에 없으면(오래된 공지 · 알림에서 옴) GET /notices/{id} 로 한 건만 불러
 *   목록 위에 「지난 공지」로 펼친 채 보여 줌(NoticeDetails 가 주소를 보고 펼침 → 읽음 기록). 볼 수 없는 공지(등급 · 내림 · 끝남)면 안내 한 줄.
 *   소개광장 › 공지 · 제휴 파트너센터 › 공지사항 · 안심 파트너센터 › 공지사항 탭이 같이 씀.
 * v10.331 (docs/461) onePath(한 건 부르는 주소 · {id} 자리) · readPath(읽음 기록 주소 · {id} 자리) — 판매자센터 › 소개몰 공지가 씀. 비우면 지금처럼.
 */
import { useEffect, useState } from 'react';
import { NoticeDetails } from './NoticeDetails';
import { NoticeFiles, type NoticeFile } from './NoticeFiles';

interface One { id: string; title: string; body: string | null; isPinned: boolean; publishedAt: string | null; unread?: boolean; files?: NoticeFile[] }
const HASH = /^#n-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function NoticeHashOpen({ shown, login, labels, onePath, readPath }: {
  shown: string[]; login: boolean; labels: { old: string; isNew: string; files: string; gone: string };
  onePath?: string; readPath?: string;
}) {
  const [one, setOne] = useState<One | null>(null);
  const [gone, setGone] = useState(false);
  const key = shown.map((x) => x.toLowerCase()).join(',');
  useEffect(() => {
    const ids = new Set(key ? key.split(',') : []);
    const load = () => {
      const m = HASH.exec(window.location.hash);
      const id = m?.[1]?.toLowerCase() ?? '';
      if (!id || ids.has(id)) { setOne(null); setGone(false); return; }
      const lang = /(?:^|;\s*)sgb_lang=([a-z]{2})(?:;|$)/.exec(document.cookie)?.[1];
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (lang && lang !== 'ko') headers['X-Lang'] = lang;
      void fetch((onePath ?? '/api/v1/notices/{id}').replace('{id}', id), { headers })
        .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as One; })
        .then((x) => { setOne(x); setGone(false); })
        .catch(() => { setOne(null); setGone(true); });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => window.removeEventListener('hashchange', load);
  }, [key, onePath]);
  if (gone) return <p className="nt-gone" role="status" data-notice-hash-gone>{labels.gone}</p>;
  if (!one) return null;
  return (
    <div id={`n-${one.id}`} className="card nt-old" data-notice-hash-open={one.id}>
      <NoticeDetails id={one.id} unread={one.unread === true} newLabel={labels.isNew} login={login} readPath={readPath?.replace('{id}', one.id)} summary={<>
        <span className="nt-oldb">{labels.old}</span> <strong>{one.title}</strong>{' '}
        <span className="dim">{String(one.publishedAt ?? '').slice(0, 10)}</span>
      </>}>
        <p style={{ whiteSpace: 'pre-line' }}>{one.body}</p>
        <NoticeFiles id={one.id} files={one.files} label={labels.files} />
      </NoticeDetails>
    </div>
  );
}
