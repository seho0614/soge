/** SB-HLT-MYO-040 택배사 조회 · v10.27 (G-130) — 시안 「택배사 조회」와 같은 화면 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltShipment } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import { CopyText } from '@/components/health/CopyText';

export const metadata: Metadata = { title: '택배사 조회 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 택배사 조회 — 택배사 조회 창으로 넘길 값(택배사 · 송장번호)을 보입니다.
 * 택배사 연동 전에는 바깥 창을 열지 않고 송장번호 복사로 대신합니다. 이름 · 주소 · 연락처는 넘기지 않습니다.
 * v10.31 (시안 「택배사에서 보기」 — 실제 서비스는 택배사 조회 창을 새 창으로 엶) — 서버가 택배사 공개 조회 주소에 송장번호만 넣어 준
 *   trackUrl 을 새 창으로 엽니다(보던 소개몰 화면은 그대로). 주소를 모르는 택배사면 송장번호 복사로 대신합니다.
 */
export default async function MyHltCarrier({ params }: Props) {
  if (!(await me())) redirect('/login');
  const no = decodeURIComponent((await params).no);
  const enc = encodeURIComponent(no);
  let o: HltOrder | null = null; let ships: HltShipment[] = []; let err: string | null = null;
  try {
    [o, ships] = await Promise.all([
      apiGetPersonal<HltOrder>(`/me/health/orders/${enc}`),
      apiGetPersonal<HltShipment[]>(`/me/health/orders/${enc}/shipments`),
    ]);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '배송 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }
  if (!o) {
    return (<><div className="hlt"><MyHltNav on="orders" /><div className="page-head"><h1>택배사 조회</h1></div>
      <HltEmpty msg={err ?? '주문을 찾을 수 없습니다.'} href="/my/health/orders" label="내 주문" /></div><i hidden data-root-end="" /></>);
  }
  const last = ships.find((s) => s.trackingNo) ?? null;
  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">내 주문</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › <Link href={`/my/health/orders/${enc}/ship`}>배송 조회</Link> › 택배사 조회
      </div>
      <div className="page-head"><h1>택배사 조회</h1></div>
      <section className="hlt-box" data-carrier="">
        {last ? (
          <>
            <p className="hint">아래 값으로 <b>택배사 조회 창을 새 창</b>으로 엽니다. 보던 소개몰 화면은 그대로 남습니다.</p>
            <table className="tbl hlt-tbl"><tbody>
              <tr><th>택배사</th><td>{last.carrier ?? '—'}</td></tr>
              <tr><th>송장번호</th><td className="mono">{last.trackingNo}</td></tr>
              <tr><th>넘기는 값</th><td>택배사 코드 · 송장번호만 — 이름 · 주소 · 연락처는 넘기지 않습니다</td></tr>
              <tr><th>연동 전</th><td>택배사 조회 창이 열리지 않으면 송장번호를 복사해 택배사 누리집에서 직접 조회하십시오</td></tr>
            </tbody></table>
            <div className="hlt-btns">
              {last.trackUrl && <a className="hlt-btn sm pri" href={last.trackUrl} target="_blank" rel="noopener noreferrer" data-carrier-open="">택배사 조회 창 열기 ↗</a>}
              <CopyText text={last.trackingNo ?? ''} label="송장번호 복사" />
              <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship`}>← 배송 조회</Link></div>
          </>
        ) : (
          <>
            {/* v10.32 — 발송 전에도 시안의 표 · 단추 2 모양(값은 비어 있음 · 단추는 누를 수 없음) */}
            <p className="hint">아직 발송 전이라 송장번호가 없습니다. 보내면 여기서 택배사와 송장번호를 볼 수 있습니다.</p>
            <table className="tbl hlt-tbl" data-carrier-empty=""><tbody>
              <tr><th>택배사</th><td className="hint">발송 전</td></tr>
              <tr><th>송장번호</th><td className="hint">발송 전</td></tr>
              <tr><th>넘기는 값</th><td>택배사 코드 · 송장번호만 — 이름 · 주소 · 연락처는 넘기지 않습니다</td></tr>
              <tr><th>연동 전</th><td>택배사 조회 창이 열리지 않으면 송장번호를 복사해 택배사 누리집에서 직접 조회하십시오</td></tr>
            </tbody></table>
            <div className="hlt-btns">
              <button type="button" className="hlt-btn sm pri" disabled title="발송 뒤에 열 수 있습니다">택배사 조회 창 열기 ↗</button>
              <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship`}>← 배송 조회</Link></div>
          </>
        )}
      </section>
    </div><i hidden data-root-end="" /></>
  );
}
