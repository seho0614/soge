import { HealthTenantApply } from './HealthTenantApply';
import { HealthSellers } from './HealthSellers';
import { HealthTenantReady } from './HealthTenantReady';
import { HealthRateSim } from './HealthRateSim';

/**
 * SB-ADM-HSL-010 소개몰 판매자 (v10.224 · D194 · docs/359) — 「소개몰」 묶음의 탭 · 운영자 ADMIN · SUPER 만(서버 @Roles 와 같음)
 *
 *   전에는 「소개몰 정산」 안에 입점 심사 · 판매자 표가 함께 있었습니다. 심사 · 관리를 한 화면으로 나눴습니다(결정 partner-center-account-basis #19 보충).
 *   v10.229 (docs/367) — 맨 위 입점 열기 준비 점검(HealthTenantReady · 읽기만).
 *   v10.270 (docs/402) — 그 아래 판매수수료율 시뮬레이션(HealthRateSim · 계산만).
 *   위: 입점 신청 받기 · 입점 판매 열기 스위치 · 심사 대기 · 반려 기록 / 아래: 판매자 목록 · 관리 · 정보 변경 요청.
 */
export function HealthSellerTab() {
  return (
    <section data-hlt-seller-tab="">
      <HealthTenantReady />
      <HealthRateSim />
      <HealthTenantApply />
      <HealthSellers />
    </section>
  );
}
