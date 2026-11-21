import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';

/**
 * v10.601 (docs/743) SB-MYP-GRW-040 매물 고치기 화면 「등록 도우미」 상자 — GET /me/grw/listings/{id}/fill
 *   충실도 점수와 더 적으면 좋은 칸만(본인 매물 · grw.fill_helper off 면 그리지 않음)
 *   ★ 노출 순서 · 검색 순위 · 소개비에 쓰지 않는다고 함께 적음
 */
type Code = 'TITLE' | 'SUMMARY' | 'BODY' | 'PHOTO1' | 'PHOTO3' | 'REGION' | 'AMOUNT' | 'FEE' | 'HOURS';

export async function GrwFillBox({ id }: { id: string }) {
  const d = await apiGetPersonal<{ on: boolean; score: number; grade: string; todo: Code[] }>(`/me/grw/listings/${encodeURIComponent(id)}/fill`).catch(() => null);
  if (!d?.on) return null;
  const t = await getTranslations('grw.fill');
  return (
    <div className="card p2pad" style={{ marginTop: 12 }} data-screen="SB-MYP-GRW-040" data-grw-fill-box={d.score}>
      <p><b>{t('boxTitle')}</b> {t('score', { score: String(d.score) })} · {t(`grade.${d.grade as 'A' | 'B' | 'C' | 'D'}`)}</p>
      {d.todo.length ? (
        <ul style={{ paddingLeft: 18 }}>{d.todo.map((c) => <li key={c} data-grw-fill-todo={c}>{t(`tip.${c}`)}</li>)}</ul>
      ) : <p>{t('allDone')}</p>}
      <p className="my-ps">{t('notRank')} <Link href="/my/listing-fill">{t('allLink')}</Link></p>
    </div>
  );
}
