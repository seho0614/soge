import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { FirstStepsHide } from './FirstStepsHide';

/**
 * v10.598 (docs/740) SB-MYP-GRW-010 나의공간 첫 화면 「첫 거래 안내」 카드 — GET /me/grw/first-steps
 *   본인 기록만 셈(새로 모으는 정보 없음) · 서버가 show=false 면(스위치 꺼짐 · 그만 보기 · 가입 오래됨 · 다 끝냄) 그리지 않음
 *   단계마다 바로 가기 · 「그만 보기」(POST /me/grw/first-steps/hide)
 */
interface Step { code: 'VERIFY' | 'PROFILE' | 'LIKE' | 'ASK' | 'POST' | 'DEAL' | 'NOTIFY' | 'SHARE'; href: string; done: boolean }

export async function GrwFirstSteps() {
  const d = await apiGetPersonal<{ show: boolean; steps: Step[]; done: number; total: number }>('/me/grw/first-steps').catch(() => null);
  if (!d?.show) return null;
  const t = await getTranslations('grw.first');
  const next = d.steps.find((s) => !s.done);
  return (
    <section className="card p2pad" data-screen="SB-MYP-GRW-010" data-grw-first={`${d.done}/${d.total}`}>
      <h2 className="my-s2" style={{ marginTop: 0 }}>{t('title')} <em>{t('progress', { done: String(d.done), total: String(d.total) })}</em></h2>
      <p className="my-ps">{t('lead')}</p>
      <ol className="grw-steps" style={{ paddingLeft: 18 }}>
        {d.steps.map((s) => (
          <li key={s.code} data-grw-step={s.code} data-done={s.done ? '1' : '0'}>
            {s.done ? <s>{t(`step.${s.code}`)}</s> : <Link href={s.href}>{t(`step.${s.code}`)}</Link>}
            {!s.done && s === next && <> — <span className="my-ps">{t(`why.${s.code}`)}</span></>}
          </li>
        ))}
      </ol>
      <FirstStepsHide labels={{ hide: t('hide'), failed: t('failed') }} />
    </section>
  );
}
