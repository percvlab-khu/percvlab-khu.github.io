#!/usr/bin/env node
// 구성원의 원본 역할 표기를 복원한다.
//
//   node tools/fix-member-roles.js [--dry-run]
//
// 최초 시드에서 Role(select) 하나에 그룹핑 기준과 표시 라벨을 겸하게 만든 탓에
// "M.S - Ph.D Course"(통합과정)와 "Ph.D Candidate"(박사수료) 같은 표기가 사라졌다.
// Role은 그룹핑용으로 두고, 원본 표기는 Role Detail에 담는다.
//
// 지도교수의 Interests에는 Education과 Experience까지 통째로 들어갔다.
// Research Interests 이후만 남긴다.

const fs = require('fs');
const path = require('path');
const api = require('../scripts/lib/notion-api');
const ids = require('../notion-db-ids.json');

const DRY = process.argv.includes('--dry-run');

// 원본 표기 → 사이트에 보여줄 표기
const LABEL = {
  Professor: 'Professor',
  'Ph.D Course': 'Ph.D. Course',
  'M.S - Ph.D Course': 'M.S.–Ph.D. Integrated Course',
  'M.S course': 'M.S. Course',
  'M.S Course': 'M.S. Course',
  'Undergraduate course': 'Undergraduate',
  'Ph.D Candidate': 'Ph.D. Candidate',
  'Ph.D candidate': 'Ph.D. Candidate',
  'Ph.D': 'Ph.D.',
  'M.S': 'M.S.',
  'B.S': 'B.S.',
};

// "Education | … | Research Interests | A | B" 에서 A, B 만 남긴다.
function cleanInterests(rest) {
  const i = rest.search(/Research Interests?/i);
  const tail = i >= 0 ? rest.slice(i) : rest;
  return tail
    .replace(/^Research Interests?\s*\|?\s*/i, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

function readCsv() {
  const lines = fs.readFileSync(path.join(__dirname, 'out', 'members.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
  return lines.map((l) => {
    const c = l.match(/"((?:[^"]|"")*)"/g).map((x) => x.slice(1, -1).replace(/""/g, '"'));
    return { index: Number(c[0]), role: c[3], name: c[5], rest: c[8] };
  });
}

async function main() {
  const csv = new Map(readCsv().map((r) => [r.index, r]));
  const rows = await api.queryAll(ids.Members.dataSourceId);
  console.log(`Notion ${rows.length}명 / CSV ${csv.size}명\n`);

  const unknown = [...csv.values()].filter((r) => !LABEL[r.role]);
  if (unknown.length) throw new Error(`매핑 없는 역할: ${unknown.map((r) => r.role).join(', ')}`);

  let changed = 0;
  for (const row of rows) {
    const order = row.properties.Order.number;
    const src = csv.get(order);
    if (!src) {
      console.log(`  CSV에 없음 (Order ${order}): ${row.properties.Name.title[0]?.plain_text}`);
      continue;
    }

    const detail = LABEL[src.role];
    const props = { 'Role Detail': { rich_text: api.text(detail) } };

    // 지도교수만 Interests가 약력 전체로 오염되어 있다.
    if (src.role === 'Professor') {
      props.Interests = { rich_text: api.text(cleanInterests(src.rest)) };
    }

    if (DRY) {
      console.log(`  ${src.name.padEnd(24)} ${src.role.padEnd(22)} -> ${detail}`);
      if (props.Interests) console.log(`    Interests: ${cleanInterests(src.rest).slice(0, 80)}…`);
    } else {
      await api.updatePage(row.id, props);
      changed++;
      process.stdout.write(`\r  갱신 ${changed}/${rows.length}`);
    }
  }

  if (DRY) console.log('\n--dry-run 이므로 아무것도 바꾸지 않았다.');
  else console.log(`\n  ${changed}명 갱신 완료`);
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exit(1);
});
