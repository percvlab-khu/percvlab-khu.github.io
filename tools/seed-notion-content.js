#!/usr/bin/env node
// Notion에 나머지 콘텐츠를 채운다: 프로필 사진, 공지, Site Config 페이지.
// seed-notion.js 를 먼저 실행해 notion-db-ids.json 이 있어야 한다.
//
//   node tools/seed-notion-content.js --page <PAGE_ID> [--only photos|news|config]
//
// 재실행해도 안전하다. 이미 채워진 항목은 건너뛴다.

const fs = require('fs');
const path = require('path');
const api = require('../scripts/lib/notion-api');

const OUT = path.join(__dirname, 'out');
const ids = require('../notion-db-ids.json');

const args = process.argv.slice(2);
const PAGE_ID = args[args.indexOf('--page') + 1];
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const want = (name) => !ONLY || ONLY === name;

// --- Home 페이지에서 소개문·공지·연락처를 뽑는다 ---
function extractHome() {
  let h = fs.readFileSync(path.join(OUT, 'raw_home.html'), 'utf8');
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const lines = h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const at = (needle) => lines.findIndex((l) => l.startsWith(needle));
  const congrats = at('Congratulation!');
  const aboutStart = at('Our research encompasses');
  const contactIntro = at("If you are interested");
  const professor = at('Professor');
  const footer = at('Report abuse');

  // 공지는 [제목, 논문명] 쌍으로 이어진다.
  const news = [];
  for (let i = congrats + 1; i < aboutStart - 1; i += 2) {
    news.push({ title: lines[i], detail: lines[i + 1] });
  }

  return {
    about: lines.slice(aboutStart, contactIntro),
    invite: lines[contactIntro],
    contact: lines.slice(professor, footer),
    news,
  };
}

const para = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: api.text(t) } });
const head = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: api.text(t) } });

// --- 1. 프로필 사진 ---
async function seedPhotos() {
  const csv = fs.readFileSync(path.join(OUT, 'members.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
  const meta = new Map(); // Order -> { file, hasPhoto }
  for (const line of csv) {
    const cells = line.match(/"((?:[^"]|"")*)"/g).map((c) => c.slice(1, -1).replace(/""/g, '"'));
    meta.set(Number(cells[0]), { file: cells[1], hasPhoto: cells[2] === 'true', name: cells[5] });
  }

  const rows = await api.queryAll(ids.Members.dataSourceId);
  let uploaded = 0;
  let skipped = 0;

  for (const row of rows) {
    const order = row.properties.Order.number;
    const m = meta.get(order);
    if (!m) continue;
    if (!m.hasPhoto) { skipped++; continue; } // 기본 아바타는 올리지 않는다
    if (row.properties.Photo.files.length) { skipped++; continue; } // 이미 있음

    const file = path.join(OUT, 'images', 'members', m.file);
    const uploadId = await api.uploadFile(file);
    await api.updatePage(row.id, { Photo: api.fileProp(uploadId, `${m.name.replace(/[^\w -]/g, '')}.jpg`) });
    uploaded++;
    process.stdout.write(`\r  사진 업로드 ${uploaded}장 (건너뜀 ${skipped})`);
  }
  console.log(`\r  사진 업로드 ${uploaded}장, 건너뜀 ${skipped}장 (기본 아바타 또는 이미 존재)`);
}

// --- 2. 공지 ---
async function seedNews(home) {
  const existing = await api.queryAll(ids.News.dataSourceId);
  if (existing.length) return console.log(`  공지 ${existing.length}건이 이미 있다. 건너뛴다.`);

  const today = new Date().toISOString().slice(0, 10);
  for (const n of home.news) {
    const page = await api.createRow(ids.News.dataSourceId, {
      Title: { title: api.text(n.title) },
      Date: { date: { start: today } },
      Published: { checkbox: true },
    });
    await api.appendBlocks(page.id, [para(n.detail)]);
    console.log(`  공지 추가: ${n.title.slice(0, 56)}`);
  }
}

// --- 3. Site Config ---
async function seedConfig(home) {
  const children = [
    head('About'),
    ...home.about.map(para),
    head('Join Us'),
    para(home.invite),
    head('Contact'),
    ...home.contact.map(para),
  ];
  const page = await api.createPage(PAGE_ID, 'Site Config', children);
  console.log(`  Site Config 페이지 생성: ${page.id}`);
  console.log(`    About ${home.about.length}문단, Contact ${home.contact.length}줄`);
}

async function main() {
  const home = extractHome();

  if (args.includes('--dump')) {
    console.log('공지:');
    home.news.forEach((n) => console.log(`  - ${n.title}\n      ${n.detail}`));
    console.log(`\nAbout (${home.about.length}문단):`);
    home.about.forEach((p) => console.log(`  - ${p.slice(0, 88)}`));
    console.log(`\nJoin Us:\n  - ${home.invite}`);
    console.log(`\nContact (${home.contact.length}줄):`);
    home.contact.forEach((c) => console.log(`  - ${c}`));
    return;
  }

  if (!PAGE_ID) throw new Error('--page <PAGE_ID> 가 필요하다.');

  if (want('photos')) { console.log('프로필 사진'); await seedPhotos(); }
  if (want('news')) { console.log('공지'); await seedNews(home); }
  if (want('config')) { console.log('Site Config'); await seedConfig(home); }

  console.log('\n완료. Research Areas는 항목 정의가 필요해 비워두었다 (원본은 서술형 문단이었다).');
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exit(1);
});
