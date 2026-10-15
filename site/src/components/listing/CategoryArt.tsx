/**
 * 매물 사진 자리의 분류 그림 (v10.21).
 *
 * 사진 등록 기능이 아직 없습니다. 빈 칸으로 두면 화면이 덜 된 것처럼 보이고, 견본 사진을 쓰면
 * **실제 매물 사진으로 오해**합니다. 그래서 분류 이름으로 고른 단순한 그림을 두고 「사진 준비 중」이라고 적습니다.
 * 사진 등록이 붙으면 mediaUrls 의 첫 장으로 바꿉니다(page.tsx).
 */
const GROUPS: { key: string; words: string[]; tone: [string, string]; path: string }[] = [
  { key: 'car', words: ['자동차', '중고차', '상용차', '화물', '특장', '오토바이', '지게차'], tone: ['#DCE6F2', '#B9CCE3'],
    path: 'M52 150h12a14 14 0 0 0 28 0h56a14 14 0 0 0 28 0h12v-26l-22-8-18-26H88l-20 26-16 6zm40-58h48l12 20H78z' },
  { key: 'realty', words: ['부동산', '상가', '건물', '아파트', '주택', '토지', '부지', '공장', '창고', '오피스', '사무실', '임대', '점포', '매장', '양수도', '출점'], tone: ['#E3ECE6', '#C2D6C9'],
    path: 'M60 160V84l44-28 44 28v76h-28v-36H88v36zm96 0v-60h28v60zm-80-64h20v16H76zm36 0h20v16h-20z' },
  { key: 'machine', words: ['기계', '설비', '장비', '부품', '공작', '산업', '집기', '주방', '진열', '가전', '디지털', '제빙'], tone: ['#E8E6EF', '#CBC6DD'],
    path: 'M120 76a12 12 0 0 1 12 12l10 4 9-7 12 12-7 9 4 10a12 12 0 0 1 0 24l-4 10 7 9-12 12-9-7-10 4a12 12 0 0 1-24 0l-10-4-9 7-12-12 7-9-4-10a12 12 0 0 1 0-24l4-10-7-9 12-12 9 7 10-4a12 12 0 0 1 12-12zm0 34a18 18 0 1 0 0 36 18 18 0 0 0 0-36z' },
  { key: 'food', words: ['식자재', '식품', '농수', '청과', '외식', '음식', '식당', '고깃집', '분식', '카페', '배달', '반찬', '과일'], tone: ['#F3EADC', '#E3CFAE'],
    path: 'M72 84h8v32a10 10 0 0 0 8 10v36h10v-36a10 10 0 0 0 8-10V84h8v30h-6V84h-8v30h-6V84h-8v30h-6zm76 0c14 0 24 16 24 38 0 12-6 20-14 22v18h-10z' },
  { key: 'energy', words: ['태양광', '에너지', '발전', '플랜트', '신재생'], tone: ['#F4EFD6', '#E6DA9C'],
    path: 'M64 104h112l12 52H52zm14 8-6 16h28l2-16zm34 0-2 16h20l-2-16zm28 0 2 16h28l-6-16zM70 136l-4 12h32l2-12zm40 0-2 12h24l-2-12zm30 0 2 12h32l-4-12zM120 60l6 14h-12z' },
  { key: 'biz', words: ['창업', '프랜차이즈', '가맹', '인수', '합병', '지분', '총판', '기업', '무인', '온라인', '소자본', '세무', '법무'], tone: ['#DFE9F5', '#BCD0EA'],
    path: 'M68 96h104v64H68zm34-20h36v20h-10v-10h-16v10h-10zm-34 44h44v10h16v-10h44v-8H68z' },
];
const DEFAULT = { key: 'etc', tone: ['#E9ECEF', '#CFD5DB'] as [string, string],
  path: 'M72 84h96v72H72zm10 10v52h76V94zm8 44 18-22 14 16 10-10 16 16z' };

export function categoryGroup(name: string): string {
  const g = GROUPS.find((x) => x.words.some((w) => name.includes(w)));
  return g ? g.key : DEFAULT.key;
}

export function CategoryArt({ name }: { name: string }) {
  const g = GROUPS.find((x) => x.words.some((w) => name.includes(w))) ?? DEFAULT;
  const id = `ca-${g.key}`;
  return (
    <svg viewBox="0 0 240 180" preserveAspectRatio="xMidYMid slice" role="img"
         aria-label={`${name} — 사진 준비 중`} data-art={g.key}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={g.tone[0]} /><stop offset="1" stopColor={g.tone[1]} />
        </linearGradient>
      </defs>
      <rect width="240" height="180" fill={`url(#${id})`} />
      {/* 그림은 240×180 칸의 가운데(120, 90)에 오도록 그려 둔 것을 위로 올립니다 */}
      <path d={g.path} transform="translate(0 -28)" fill="#fff" fillOpacity=".78" fillRule="evenodd" />
    </svg>
  );
}
