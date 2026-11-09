#!/usr/bin/env node
/**
 * v10.221 (docs/356) — 외부 묶음(npm 패키지) 약점 검사
 *
 *   서비스에 들어가는 묶음만(개발 도구 빼고 · --omit=dev) 공개 약점 목록(npm audit)과 대조합니다.
 *   곳: API(.) · 사용자 웹(site) · 운영 화면(web). 잠금 파일(package-lock.json)만 읽고 설치하지 않습니다(--package-lock-only).
 *
 *   판정: 「아주 심각(critical)」 → 실패(종료 코드 1) · 「심각(high)」 이하 → 보고만.
 *         예외(scripts/deps-audit-allow.json — 묶음 이름 · 까닭 · 날짜)에 있는 것은 등급과 상관없이 「예외」로 보이고 실패에서 뺍니다.
 *         공개 목록에 닿지 못하면(인터넷 · npm 서버) 종료 코드 2 — 「검사 못 함」은 통과가 아닙니다.
 *
 *   쓰는 법: node scripts/deps-audit.js [폴더(기본: 이 파일 위)]   · 운영 서버에서는 돌리지 않음(개발 서버 점검용)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const PLACES = [['API', '.'], ['사용자 웹', 'site'], ['운영 화면', 'web']];
const SEV = ['critical', 'high', 'moderate', 'low'];
const KO = { critical: '아주 심각', high: '심각', moderate: '중간', low: '낮음' };

let allow = [];
try { allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'deps-audit-allow.json'), 'utf8')).allow || []; }
catch { /* 예외 파일이 없으면 예외 없음 */ }
const allowed = (name) => allow.find((a) => a.package === name);

let critical = 0, unreachable = 0;
for (const [label, rel] of PLACES) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(path.join(dir, 'package-lock.json'))) { console.log(`${label} | 잠금 파일 없음 — 건너뜀`); continue; }
  const r = spawnSync('npm', ['audit', '--package-lock-only', '--omit=dev', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let d;
  try { d = JSON.parse(r.stdout); } catch { d = null; }
  if (!d || d.error || !d.metadata) {
    unreachable += 1;
    console.log(`${label} | 검사 못 함 — ${(d && d.error && d.error.summary) || (r.stderr || '').trim().split('\n')[0] || '응답 없음'}`);
    continue;
  }
  const m = d.metadata.vulnerabilities || {};
  console.log(`${label} | ${SEV.map((s) => `${KO[s]} ${m[s] || 0}`).join(' · ')} | 묶음 ${d.metadata.dependencies?.prod ?? '?'}개`);
  for (const [name, v] of Object.entries(d.vulnerabilities || {})) {
    if (!['critical', 'high'].includes(v.severity)) continue;
    const fix = typeof v.fixAvailable === 'object' ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? '(큰 판)' : ''}` : v.fixAvailable ? '있음' : '없음';
    const title = (v.via || []).find((x) => typeof x === 'object')?.title ?? `${(v.via || []).join(', ')} 때문`;
    const a = allowed(name);
    if (a) { console.log(`  예외 ${KO[v.severity]} ${name} — ${title} · 까닭: ${a.reason} (${a.date})`); continue; }
    console.log(`  ${v.severity === 'critical' ? 'FAIL' : '보고'} ${KO[v.severity]} ${name} ${v.range} — ${title} · 고친 판 ${fix}`);
    if (v.severity === 'critical') critical += 1;
  }
}
console.log(`외부 묶음 검사 | ${unreachable ? `검사 못 한 곳 ${unreachable}` : critical ? `아주 심각 ${critical}건 — 실패` : '아주 심각 없음 — 통과'}`);
process.exit(unreachable ? 2 : critical ? 1 : 0);
