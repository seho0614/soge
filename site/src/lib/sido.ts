/**
 * v10.119 — 시 · 도 짧은 이름. 값(서버에 보내는 글자 · 업체 활동 지역과 같은 이름)은 한국어 그대로이고,
 * 화면에 보이는 글자만 사전(region.<코드>)에서 꺼냅니다.  예) const tr = useTranslations('region'); tr(sidoCode('서울'))
 */
export const SIDO_CODE = {
  '서울': 'seoul',
  '부산': 'busan',
  '대구': 'daegu',
  '인천': 'incheon',
  '광주': 'gwangju',
  '대전': 'daejeon',
  '울산': 'ulsan',
  '세종': 'sejong',
  '경기': 'gyeonggi',
  '강원': 'gangwon',
  '충북': 'chungbuk',
  '충남': 'chungnam',
  '전북': 'jeonbuk',
  '전남': 'jeonnam',
  '경북': 'gyeongbuk',
  '경남': 'gyeongnam',
  '제주': 'jeju',
} as const;
export type SidoCode = (typeof SIDO_CODE)[keyof typeof SIDO_CODE];
/** 한국어 짧은 이름 → 사전 키(모르는 이름이면 null — 화면은 원래 글자를 그대로 보입니다) */
export const sidoCode = (ko: string): SidoCode | null => (SIDO_CODE as Record<string, SidoCode>)[ko] ?? null;
