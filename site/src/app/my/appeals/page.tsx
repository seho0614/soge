import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { me } from '@/lib/session';
import { MyHead, Note, Empty, Badge, type Tone } from '@/components/my/ui';
import { Msgs } from '@/i18n/Msgs';
import { AppealForm } from '@/components/mtr/AppealForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mtr'))('appealTitle') };
}
export const dynamic = 'force-dynamic';

interface Appeal { id: string; state: string; createdAt: string; dueAt: string; decisionNote: string | null; decidedAt: string | null; restored: string | null }
interface Down {
  targetType: string; targetId: string; title: string; targetState: string; downAt: string | null;
  reasons: Array<{ reasonCode: string; label: string | null; n: number }>; resolutions: string[]; hiddenReason: string | null;
  appealUntil: string | null; canAppeal: boolean; appeal: Appeal | null;
}
interface View { on: boolean; appealDays: number; slaHours: number; bodyMin: number; bodyMax: number; down: Down[]; past: Array<Appeal & { targetType: string; targetId: string }> }

const TONE: Record<string, Tone> = { OPEN: 'wait', ACCEPTED: 'ok', REJECTED: 'no' };

/**
 * SB-MYP-MTR-010 신고로 내려간 내 글 · 이의 제기 (v10.573 · docs/715) — GET · POST /me/mtr/appeals
 *   내려간 매물 · 글 · 댓글 · 신고 사유 이름 · 건수 · 운영 처리 내용(신고한 사람은 안 보임) · 대상마다 한 번 이의 · 결과
 *   나의공간 메뉴(MyShell)는 고치지 않음 — 내 신고 내역 화면 아래 안내에서 들어옴
 */
export default async function MyAppealsPage() {
  if (!(await me())) redirect('/login?next=/my/appeals');
  const t = await getTranslations('mtr');
  const d = await apiGetPersonal<View>('/me/mtr/appeals').catch(() => null);
  /* 열쇠는 글자 그대로(next build 형 검사 — 템플릿 열쇠 금지) */
  const TT: Record<string, string> = { LISTING: t('ttLISTING'), POST: t('ttPOST'), COMMENT: t('ttCOMMENT') };
  const ST: Record<string, string> = { REJECTED: t('stREJECTED'), SUSPENDED: t('stSUSPENDED'), HIDDEN: t('stHIDDEN') };
  const AP: Record<string, string> = { OPEN: t('apOPEN'), ACCEPTED: t('apACCEPTED'), REJECTED: t('apREJECTED') };
  const RS: Record<string, string> = { IN_REVIEW: t('restoredIN_REVIEW'), PUBLISHED: t('restoredPUBLISHED') };
  const appealBox = (a: Appeal) => (
    <div data-mtr-appeal-state={a.state}>
      <p><Badge tone={TONE[a.state] ?? 'off'}>{t('appealState', { state: AP[a.state] ?? a.state })}</Badge> {ymdKst(a.createdAt)}</p>
      {a.decisionNote && <p>{t('decisionNote', { note: a.decisionNote })}</p>}
      {a.restored && <p>{RS[a.restored] ?? ''}</p>}
    </div>
  );
  return (
    <div data-screen="SB-MYP-MTR-010">
      <MyHead title={t('appealTitle')} sub={t('appealSub', { days: String(d?.appealDays ?? 30), hours: String(d?.slaHours ?? 72) })} />
      {d && !d.on && <Note kind="warn" data-mtr-appeal-off="">{t('appealOff')}</Note>}
      {!d || d.down.length === 0 ? <Empty data-mtr-appeal-empty="">{t('appealEmpty')}</Empty> : (
        <Msgs ns={['mtr']}>
          <div data-mtr-appeals={d.down.length}>
            {d.down.map((it) => (
              <div key={`${it.targetType}:${it.targetId}`} className="my-lrow" data-mtr-down={it.targetType}>
                <b className="my-lt">{TT[it.targetType] ?? it.targetType} · {it.title || '—'}</b>
                <p><Badge tone="no">{ST[it.targetState] ?? it.targetState}</Badge> {it.downAt ? ymdKst(it.downAt) : ''}</p>
                {it.reasons.length > 0 && <p>{t('reasons')}: {it.reasons.map((r) => t('reasonN', { label: r.label ?? r.reasonCode, n: String(r.n) })).join(' · ')}</p>}
                {it.hiddenReason && <p>{t('hiddenReason')}: {it.hiddenReason}</p>}
                {it.resolutions.length > 0 && <ul aria-label={t('resolution')}>{it.resolutions.map((x, i) => <li key={i}>{t('resolution')}: {x}</li>)}</ul>}
                {it.appeal ? appealBox(it.appeal)
                  : it.canAppeal ? (
                    <>
                      {it.appealUntil && <p><small>{t('until', { date: ymdKst(it.appealUntil) })}</small></p>}
                      <AppealForm targetType={it.targetType} targetId={it.targetId} min={d.bodyMin} max={d.bodyMax} />
                    </>
                  ) : d.on && <p><small>{t('late')}</small></p>}
              </div>
            ))}
          </div>
        </Msgs>
      )}
      {d && d.past.length > 0 && (
        <section data-mtr-appeal-past={d.past.length}>
          <h2>{t('pastHead')}</h2>
          {d.past.map((a) => <div key={a.id} className="my-lrow"><b className="my-lt">{TT[a.targetType] ?? a.targetType}</b>{appealBox(a)}</div>)}
        </section>
      )}
      <Note kind="info">{t('noteText')}</Note>
    </div>
  );
}
