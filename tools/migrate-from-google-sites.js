#!/usr/bin/env node
// 현행 Google Sites(cvlab.khu.ac.kr)에서 콘텐츠와 이미지를 추출한다.
// 일회성 도구. 본 빌드 파이프라인(scripts/)과 무관하며 의존성이 없다.
//
//   node tools/migrate-from-google-sites.js
//
// 산출물은 tools/out/ 에 생성된다.
//   images/members/NNN.jpg   프로필 사진 원본
//   members.csv              사진과 나란히 놓은 텍스트 (수동 검수용)
//   publications.csv         논문 목록
//   archives-backup.json     폐기되는 Archives 링크 백업
//
// Google Sites를 내리면 이미지 CDN URL이 소멸하므로, 전환 전에 반드시 실행할 것.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://cvlab.khu.ac.kr';
const PAGES = ['home', 'members', 'publications', 'photos', 'archives'];
const OUT = path.join(__dirname, 'out');

const get = (url, binary = false) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(get(res.headers.location, binary));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });

const dropCode = (html) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');

const entities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

const stripTags = (html) =>
  entities(
    dropCode(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

// 한 줄로 눌러 담은 문단 텍스트
const inline = (html) => entities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csvRow = (arr) => arr.map(csvCell).join(',');

// 프로필 사진: aria-label 없는 sitesv 이미지. 로고는 aria-label="Site home".
function profileImages(html) {
  const out = [];
  const seen = new Set();
  const re = /<img\s+src="(https:\/\/lh3\.googleusercontent\.com\/sitesv\/[^"]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, url, attrs] = m;
    if (/aria-label="Site home"/.test(attrs)) continue;
    const key = url.split('=')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pos: m.index, url, original: `${key}=s0` });
  }
  return out;
}

// 이미지 사이의 텍스트를 그 이미지의 소유자 정보로 본다.
function sliceByImages(html, imgs) {
  return imgs.map((img, i) => {
    const end = i + 1 < imgs.length ? imgs[i + 1].pos : html.length;
    return stripTags(html.slice(img.pos, end))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  });
}

const FOOTER = /^(Report abuse|Page details|Page updated|Google Sites)$/i;
const emailOf = (line) => line.replace(/^Email\s*:?\s*/i, '').trim();

// 구성원 블록은 세 가지 형태로 나타난다.
//   지도교수 : [이름, "Email: …", Education, …]
//   재학생   : [역할, 이름, "Email: …", Research Interests, …]
//   졸업생   : [역할, 이름, 현재 소속]          이메일이 없다
function parseMember(lines) {
  const l = lines.filter((x) => !FOOTER.test(x));
  const e = l.findIndex((x) => /^Email/i.test(x));

  if (e === 1) return { role: 'Professor', name: l[0], email: emailOf(l[1]), position: '', rest: l.slice(2) };
  if (e >= 2) return { role: l[e - 2], name: l[e - 1], email: emailOf(l[e]), position: '', rest: l.slice(e + 1) };
  return { role: l[0] || '', name: l[1] || '', email: '', position: l[2] || '', rest: l.slice(3) };
}

// 재학생은 "M.S course" / "Ph.D Course" / "Undergraduate course",
// 졸업생은 "M.S" / "Ph.D" / "B.S" 처럼 course가 빠진다.
const isAlumni = (role) => !!role && !/course/i.test(role);

const JOURNAL = /Transactions|Journal|IEEE Access|Letters|Sensors|Neurocomputing|Applied Sciences|Remote Sensing|Electronics|Symmetry/i;

function venueType(venue) {
  if (/^arXiv/i.test(venue)) return 'Preprint';
  if (/Workshop/i.test(venue)) return 'Workshop';
  return JOURNAL.test(venue) ? 'Journal' : 'Conference';
}

// venue에 연도가 없는 논문이 있다. 원본은 연도별 섹션 헤딩으로 구분하므로 그것을 추적한다.
// arXiv 식별자는 YYMM 형식이라 arXiv:2011.08408은 2011년이 아니라 2020년 11월이다.
// 연도로 오인되지 않도록 식별자 부분을 먼저 걸러낸다.
function yearOf(venue, sectionYear) {
  const inVenue = (venue.match(/(19|20)\d{2}/g) || []).filter((y) => !venue.includes(`arXiv:${y}`));
  if (inVenue.length) return inVenue.pop();
  if (sectionYear) return sectionYear; // 원본 사이트의 분류가 가장 믿을 만하다
  const ax = venue.match(/arXiv:(\d{2})\d{2}/i);
  return ax ? `20${ax[1]}` : '';
}

// 논문은 [굵은 제목] [저자] [venue] 문단이 반복되며, 그 앞에 연도 헤딩이 있다.
function parsePublications(html) {
  const paras = [...dropCode(html).matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => ({ bold: /font-weight:\s*700/.test(m[2]), text: inline(m[2]) }))
    .filter((p) => p.text);

  const out = [];
  let cur = null;
  let sectionYear = '';
  for (const p of paras) {
    if (/^(19|20)\d{2}$/.test(p.text)) {
      if (cur) { out.push(cur); cur = null; }
      sectionYear = p.text;
      continue;
    }
    if (p.bold) {
      if (p.text.length < 12) continue; // 네비게이션 등
      if (cur) out.push(cur);
      cur = { title: p.text, authors: '', venue: '', sectionYear };
    } else if (cur) {
      if (!cur.authors) cur.authors = p.text;
      else cur.venue = cur.venue ? `${cur.venue} ${p.text}` : p.text;
    }
  }
  if (cur) out.push(cur);

  return out
    .filter((r) => r.venue)
    .map(({ sectionYear: sy, ...r }) => ({ ...r, year: yearOf(r.venue, sy), type: venueType(r.venue) }));
}

// Archives는 하이퍼링크가 아니라 평문 목록이다.
const NAV = new Set(['Home', 'Members', 'Publications', 'Photos', 'Archives']);
function parseArchives(html) {
  return [...dropCode(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
    .map((m) => inline(m[1]))
    .filter((t) => t && !NAV.has(t));
}

async function download(url, dest, fallback) {
  try {
    fs.writeFileSync(dest, await get(url, true));
    return 's0';
  } catch {
    fs.writeFileSync(dest, await get(fallback, true));
    return 'w1280';
  }
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'images', 'members'), { recursive: true });

  const html = {};
  for (const p of PAGES) {
    html[p] = await get(`${BASE}/${p}`);
    console.log(`fetched /${p}  ${html[p].length} bytes`);
  }

  // --- 구성원과 프로필 사진 ---
  const imgs = profileImages(html.members);
  const blocks = sliceByImages(html.members, imgs);
  console.log(`\n구성원 ${imgs.length}명 처리 중...`);

  const hashes = new Map(); // 동일 해시 = 기본 아바타(사진 없음)
  const members = [];
  for (let i = 0; i < imgs.length; i++) {
    const file = `${String(i + 1).padStart(3, '0')}.jpg`;
    const dest = path.join(OUT, 'images', 'members', file);
    if (!fs.existsSync(dest)) {
      await download(imgs[i].original, dest, imgs[i].url);
      await new Promise((r) => setTimeout(r, 200)); // 예의상 간격
    }
    const hash = crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex');
    hashes.set(hash, (hashes.get(hash) || 0) + 1);

    const m = parseMember(blocks[i]);
    members.push({ index: i + 1, file, hash, ...m });
  }

  // 두 번 이상 나타난 해시는 사진이 아니라 기본 아바타다.
  const placeholders = new Set([...hashes].filter(([, n]) => n > 1).map(([h]) => h));
  const rows = [csvRow(['index', 'file', 'has_photo', 'role', 'is_alumni', 'name', 'email', 'position', 'rest'])];
  for (const m of members) {
    const hasPhoto = !placeholders.has(m.hash);
    rows.push(
      csvRow([m.index, m.file, hasPhoto, m.role, isAlumni(m.role), m.name, m.email, m.position, m.rest.join(' | ')])
    );
    const tail = m.email || m.position || '';
    console.log(`  ${m.file} ${hasPhoto ? '  ' : '무 '} ${(m.role || '?').padEnd(20)} ${m.name.padEnd(24)} ${tail}`);
  }
  fs.writeFileSync(path.join(OUT, 'members.csv'), rows.join('\n'));

  // --- 논문 ---
  const pubs = parsePublications(html.publications);
  const pubRows = [csvRow(['year', 'type', 'title', 'authors', 'venue'])];
  for (const p of pubs) pubRows.push(csvRow([p.year, p.type, p.title, p.authors, p.venue]));
  fs.writeFileSync(path.join(OUT, 'publications.csv'), pubRows.join('\n'));

  // --- Archives 백업 (사이트에는 싣지 않는다) ---
  const archives = parseArchives(html.archives);
  fs.writeFileSync(path.join(OUT, 'archives-backup.json'), JSON.stringify(archives, null, 2));

  // 원본 HTML 보존
  for (const p of PAGES) fs.writeFileSync(path.join(OUT, `raw_${p}.html`), html[p]);

  const noPhoto = members.filter((m) => placeholders.has(m.hash)).length;
  const byYear = pubs.reduce((a, p) => ((a[p.year] = (a[p.year] || 0) + 1), a), {});
  console.log(`\n완료`);
  console.log(`  구성원    ${members.length}명 (사진 없음 ${noPhoto}명) -> tools/out/members.csv`);
  console.log(`  논문      ${pubs.length}편, 연도 ${Object.keys(byYear).length}개 -> tools/out/publications.csv`);
  console.log(`  Archives  ${archives.length}건 -> tools/out/archives-backup.json (백업용)`);
  console.log(`\nmembers.csv와 publications.csv를 눈으로 검수한 뒤 Notion에 입력할 것.`);
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
