/** SB-HLT-ADR-010 배송지 관리 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltAddress } from '@/components/health/types';
import { MyHltNav } from '@/components/health/MyHltNav';
import { AddressForm } from '@/components/health/AddressForm';
import { AddressActions } from '@/components/health/AddressActions';

export const metadata: Metadata = { title: '배송지 관리 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ next?: string }> };

/**
 * 배송지 관리 — GET · POST /me/health/addresses,
 * PATCH /me/health/addresses/{id}/default (기본으로) · DELETE /me/health/addresses/{id} (삭제) — D002.
 * 진행 중인 주문이 가리키는 배송지는 지울 수 없습니다(서버가 막고 사유를 줍니다).
 */
export default async function MyHltAddresses({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  /* 돌아갈 곳은 사이트 안 경로만 받습니다 — 바깥 주소로 튕기지 않게 */
  const raw = (await searchParams).next;
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;

  let rows: HltAddress[] | null = null;
  let err: string | null = null;
  try {
    rows = await apiGetPersonal<HltAddress[]>('/me/health/addresses');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '배송지를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  return (
    <><div className="hlt">
      <MyHltNav on="addresses" />
      <div className="page-head">
        <h1>배송지 관리</h1>
        {next && <Link className="hlt-btn sm" href={next}>주문서로 돌아가기</Link>}
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows.length === 0 ? (
        <p className="empty">등록된 배송지가 없습니다. 아래에서 첫 배송지를 등록해 주십시오 — 첫 배송지가 기본 배송지가 됩니다.</p>
      ) : (
        <div className="rows">
          {rows.map((a) => (
            <div key={a.id} className="hlt-box">
              <div className="hlt-ord-h">
                <span>{a.isDefault && <span className="hlt-bdg">기본</span>} <b>{a.label || '배송지'}</b></span>
                <span className="hint">{a.receiver} · {a.phone}</span>
              </div>
              <p>({a.zipcode}) {a.addr1} {a.addr2 ?? ''}</p>
              <AddressActions id={a.id} isDefault={a.isDefault} label={a.label || a.addr1} />
            </div>
          ))}
        </div>
      )}

      <section className="hlt-box hlt-gap">
        <h3>새 배송지</h3>
        <AddressForm next={next} />
      </section>
    </div><i hidden data-root-end="" /></>
  );
}
