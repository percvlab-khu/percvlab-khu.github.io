#!/usr/bin/env node
// Notion에 데이터베이스 7개를 만들고, tools/out/ 의 추출 결과를 채워 넣는다.
// 일회성 도구. 의존성 없음.
//
//   node tools/seed-notion.js --page <PAGE_ID> [--dry-run]
//
// 상위 페이지에 통합(integration)이 연결되어 있어야 한다. 그러면 그 아래 만들어지는
// 데이터베이스는 접근 권한을 자동으로 상속하므로 개별 연결이 필요 없다.
//
// 생성된 database ID는 notion-db-ids.json에 기록된다(gitignore 대상).
// 이 파일이 이미 있으면 중복 생성을 막기 위해 실행을 거부한다.

const fs = require('fs');
const path = require('path');
const api = require('../scripts/lib/notion-api');

const OUT = path.join(__dirname, 'out');
const IDS_FILE = path.join(__dirname, '..', 'notion-db-ids.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PAGE_ID = args[args.indexOf('--page') + 1];

// --- CSV 파서 (따옴표 이스케이프 처리) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const readCsv = (name) => parseCsv(fs.readFileSync(path.join(OUT, name), 'utf8'));

// --- 속성 값 헬퍼 ---
const P = {
  title: (v) => ({ title: api.text(v) }),
  text: (v) => (v ? { rich_text: api.text(v) } : { rich_text: [] }),
  number: (v) => ({ number: v === '' || v == null ? null : Number(v) }),
  select: (v) => (v ? { select: { name: v } } : { select: null }),
  check: (v) => ({ checkbox: v === true || v === 'true' }),
  url: (v) => ({ url: v || null }),
  email: (v) => ({ email: v || null }),
};

const opts = (...names) => ({ select: { options: names.map((name) => ({ name })) } });

// --- 데이터베이스 스키마 ---
const SCHEMAS = {
  News: {
    Title: { title: {} },
    Date: { date: {} },
    Published: { checkbox: {} },
  },
  'Research Areas': {
    Title: { title: {} },
    Description: { rich_text: {} },
    Image: { files: {} },
    Order: { number: {} },
  },
  Members: {
    Name: { title: {} },
    Role: opts('Professor', 'PhD', 'MS', 'BS'),
    Alumni: { checkbox: {} },
    Photo: { files: {} },
    Email: { email: {} },
    Interests: { rich_text: {} },
    'Current Position': { rich_text: {} },
    Graduated: { number: {} },
    Order: { number: {} },
  },
  Publications: {
    Title: { title: {} },
    Authors: { rich_text: {} },
    Venue: { rich_text: {} },
    Year: { number: {} },
    Type: opts('Journal', 'Conference', 'Workshop', 'Preprint'),
    Link: { url: {} },
  },
  Photos: {
    Title: { title: {} },
    Date: { date: {} },
    Image: { files: {} },
    Caption: { rich_text: {} },
  },
  'Members Only': {
    Title: { title: {} },
    Category: opts('공지', '세미나', '일정', '공용자료'),
    Date: { date: {} },
    Author: { rich_text: {} },
    'Drive Link': { url: {} },
    Published: { checkbox: {} },
  },
};

// 원본 표기가 제각각이다: "M.S course", "M.S Course", "M.S - Ph.D Course", "Ph.D candidate" …
function normalizeRole(raw) {
  const r = raw.toLowerCase();
  if (r.includes('professor')) return 'Professor';
  if (r.includes('ph.d')) return 'PhD';
  if (r.includes('m.s')) return 'MS';
  if (r.includes('undergraduate') || r.includes('b.s')) return 'BS';
  return null;
}

async function main() {
  if (!PAGE_ID) throw new Error('--page <PAGE_ID> 가 필요하다.');
  if (fs.existsSync(IDS_FILE) && !DRY) {
    throw new Error(`${IDS_FILE} 가 이미 있다. 중복 생성을 막기 위해 중단한다. 다시 만들려면 이 파일을 지울 것.`);
  }

  const members = readCsv('members.csv');
  const pubs = readCsv('publications.csv');
  console.log(`입력: 구성원 ${members.length}명, 논문 ${pubs.length}편\n`);

  if (DRY) {
    const roles = {};
    for (const m of members) {
      const key = `${normalizeRole(m.role) || '???'}${m.is_alumni === 'true' ? ' (졸업)' : ''}`;
      roles[key] = (roles[key] || 0) + 1;
    }
    console.log('역할 매핑 결과:');
    for (const [k, v] of Object.entries(roles).sort()) console.log(`  ${String(v).padStart(2)}  ${k}`);
    const unmapped = members.filter((m) => !normalizeRole(m.role));
    if (unmapped.length) console.log('\n매핑 실패:', unmapped.map((m) => `${m.name}(${m.role})`).join(', '));
    console.log('\n생성될 데이터베이스:', Object.keys(SCHEMAS).join(', '));
    console.log('--dry-run 이므로 아무것도 만들지 않았다.');
    return;
  }

  // --- 데이터베이스 생성 ---
  const ids = {};
  for (const [title, properties] of Object.entries(SCHEMAS)) {
    const { databaseId, dataSourceId } = await api.createDatabase(PAGE_ID, title, properties);
    ids[title] = { databaseId, dataSourceId };
    console.log(`DB 생성  ${title.padEnd(16)} ${databaseId}`);
  }
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
  fs.chmodSync(IDS_FILE, 0o600);
  console.log(`\nID 기록 -> ${IDS_FILE}\n`);

  // --- 구성원 ---
  const ms = ids.Members.dataSourceId;
  for (const [i, m] of members.entries()) {
    const role = normalizeRole(m.role);
    if (!role) { console.log(`  건너뜀 (역할 불명): ${m.name} "${m.role}"`); continue; }
    await api.createRow(ms, {
      Name: P.title(m.name),
      Role: P.select(role),
      Alumni: P.check(m.is_alumni),
      Email: P.email(m.email),
      Interests: P.text(m.rest.replace(/^Research Interests?\s*\|\s*/i, '').replace(/\s*\|\s*/g, ', ')),
      'Current Position': P.text(m.position),
      Order: P.number(i + 1),
    });
    process.stdout.write(`\r구성원 ${i + 1}/${members.length}`);
  }
  console.log('  완료');

  // --- 논문 ---
  const ps = ids.Publications.dataSourceId;
  for (const [i, p] of pubs.entries()) {
    const arxiv = p.venue.match(/arXiv:([\d.]+)/i);
    await api.createRow(ps, {
      Title: P.title(p.title),
      Authors: P.text(p.authors),
      Venue: P.text(p.venue),
      Year: P.number(p.year),
      Type: P.select(p.type),
      Link: P.url(arxiv ? `https://arxiv.org/abs/${arxiv[1]}` : ''),
    });
    process.stdout.write(`\r논문 ${i + 1}/${pubs.length}`);
  }
  console.log('  완료');

  console.log('\n남은 작업: 프로필 사진 45장 업로드, Site Config 페이지 작성, News/Research Areas 입력');
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exit(1);
});
