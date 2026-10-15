#!/usr/bin/env node
/**
 * 배치 등록 대조.
 *
 * EventBridge 는 tick 하나만 부르고, 무엇을 언제 돌릴지는
 * DB(job_schedules)가 정합니다. 그래서 대조 대상은 두 곳입니다.
 *
 *   코드(JOBS 목록)  ↔  DB(job_schedules)
 *
 * DB 에서 빠진 배치는 tick 이 부르지 않습니다. **영원히 안 돕니다.**
 * 오류도 나지 않습니다 — 그냥 아무 일도 일어나지 않습니다.
 * 구독 청구가 그렇게 되면 매출이 멈추고, 개인정보 파기가 그렇게 되면
 * 법적 문제가 됩니다.
 *
 * 배치를 새로 만들면 이 검정이 실패합니다. 그때 job_schedules 에 넣으십시오.
 */
const fs = require('fs');
const ctl = fs.readFileSync('src/worker/worker.controller.ts', 'utf8');
const block = ctl.split('const JOBS = [')[1].split(']')[0];
const inCode = new Set([...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));

console.log('== 배치 등록 대조 ==');
let checks = 1, fail = 0;

// 템플릿은 tick 하나만 있어야 합니다. 개별 스케줄이 남아 있으면
// 주기가 두 곳에 있게 되고, 둘이 갈립니다.
const tpl = fs.readFileSync('infra/eventbridge-jobs.yaml', 'utf8');
const nSched = (tpl.match(/Type: AWS::Scheduler::Schedule\b/g) || []).length;
if (nSched === 1) console.log('  ok   EventBridge 스케줄 1건 (tick)');
else { console.log(`  FAIL EventBridge 스케줄 ${nSched}건 — tick 하나여야 합니다`); fail++; }

if (process.env.DATABASE_URL) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `psql "${process.env.DATABASE_URL}" -t -A -c "SELECT job FROM job_schedules WHERE is_active"`,
      { encoding: 'utf8' });
    const inDb = new Set(out.split('\n').map(x => x.trim()).filter(Boolean));
    const missDb = [...inCode].filter(j => !inDb.has(j));
    const extra  = [...inDb].filter(j => !inCode.has(j));
    checks = 3;
    if (missDb.length) {
      console.log(`  FAIL job_schedules 에 없음 → ${missDb.join(', ')} (tick 이 부르지 않습니다)`);
      fail++;
    } else console.log(`  ok   모든 배치가 job_schedules 에 있음 (${inDb.size}건)`);
    if (extra.length) {
      console.log(`  FAIL 코드에 없는 배치 → ${extra.join(', ')} (부르면 오류가 납니다)`);
      fail++;
    } else console.log('  ok   job_schedules 의 배치가 모두 코드에 있음');
  } catch { console.log('  --   job_schedules 확인 건너뜀 (DB 없음)'); }
}

console.log(`\n통과 ${checks - fail} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
