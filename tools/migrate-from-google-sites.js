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

const stripTags = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

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
    return stripTags(html.slice(img.pos, end)).split('\n').filter(Boolean);
  });
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

  // --- 프로필 사진 ---
  const imgs = profileImages(html.members);
  const blocks = sliceByImages(html.members, imgs);
  console.log(`\n프로필 사진 ${imgs.length}장 다운로드 중...`);

  const rows = [['index', 'file', 'extracted_text'].map(csvCell).join(',')];
  for (let i = 0; i < imgs.length; i++) {
    const file = `${String(i + 1).padStart(3, '0')}.jpg`;
    const dest = path.join(OUT, 'images', 'members', file);
    const size = await download(imgs[i].original, dest, imgs[i].url);
    const bytes = fs.statSync(dest).size;
    console.log(`  ${file}  ${size.padEnd(6)} ${bytes} bytes  ${(blocks[i][0] || '').slice(0, 40)}`);
    rows.push([i + 1, file, blocks[i].join(' | ')].map(csvCell).join(','));
    await new Promise((r) => setTimeout(r, 200)); // 예의상 간격
  }
  fs.writeFileSync(path.join(OUT, 'members.csv'), rows.join('\n'));

  // --- Publications: 연도 헤딩과 항목을 순서대로 담는다 ---
  const pubLines = stripTags(html.publications).split('\n').map((s) => s.trim()).filter(Boolean);
  const pubs = [['year', 'entry'].map(csvCell).join(',')];
  let year = '';
  for (const line of pubLines) {
    const y = line.match(/^(19|20)\d{2}$/);
    if (y) { year = line; continue; }
    if (line.length > 30) pubs.push([year, line].map(csvCell).join(','));
  }
  fs.writeFileSync(path.join(OUT, 'publications.csv'), pubs.join('\n'));

  // --- Archives 백업 ---
  const links = [...html.archives.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, url, text]) => ({ url, text: stripTags(text) }))
    .filter((l) => l.text && !l.url.includes('cvlab.khu.ac.kr'));
  fs.writeFileSync(path.join(OUT, 'archives-backup.json'), JSON.stringify(links, null, 2));

  // 원본 HTML 보존
  for (const p of PAGES) fs.writeFileSync(path.join(OUT, `raw_${p}.html`), html[p]);

  console.log(`\n완료`);
  console.log(`  사진      ${imgs.length}장  -> tools/out/images/members/`);
  console.log(`  논문      ${pubs.length - 1}건 -> tools/out/publications.csv`);
  console.log(`  Archives  ${links.length}건 -> tools/out/archives-backup.json`);
  console.log(`\nmembers.csv의 extracted_text를 눈으로 검수한 뒤 Notion에 입력할 것.`);
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
