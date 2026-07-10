// 사이트를 _site/ 에 생성한다.
//
//   node scripts/build.js [configPageId]
//
// 산출물은 레포에 커밋하지 않는다. GitHub Actions가 곧바로 Pages로 배포한다.
// 공개 페이지는 완성된 정적 HTML이다(SEO). Members Only만 암호문 + 클라이언트 복호화다.

const fs = require('fs');
const path = require('path');
const { fetchAll, IMG_DIR } = require('./fetch-notion');
const { encryptLab } = require('./encrypt-lab');
const pages = require('../templates/pages');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '_site');
const STATIC = path.join(ROOT, 'static');

// CNAME 파일이 배포되는 순간 GitHub Pages는 그 도메인을 커스텀 도메인으로 잡는다.
// DNS가 아직 준비되지 않았다면 github.io 주소마저 그리로 리다이렉트되어 사이트가 열리지 않는다.
// 학교의 도메인 변경 신청이 승인된 뒤에 CUSTOM_DOMAIN을 설정할 것.
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || '';
const ORIGIN = process.env.SITE_ORIGIN || 'https://percvlab-khu.github.io';

const write = (rel, content) => {
  const dest = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return content.length;
};

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) n += copyDir(from, to);
    else {
      fs.copyFileSync(from, to);
      n++;
    }
  }
  return n;
}

async function build(configPageId) {
  fs.rmSync(SITE, { recursive: true, force: true });

  const data = await fetchAll(configPageId);

  const written = [
    ['index.html', pages.home(data)],
    ['members/index.html', pages.members(data)],
    ['publications/index.html', pages.publications(data)],
    ['photos/index.html', pages.photos(data)],
    ['contact/index.html', pages.contact(data)],
  ];
  for (const [rel, html] of written) write(rel, html);

  // Members Only. 비밀번호가 없으면 만들지 않는다 — 빈 비밀번호로 배포되는 사고를 막는다.
  let lab = null;
  const password = process.env.LAB_PASSWORD;
  if (password) {
    lab = encryptLab(data.membersOnly, SITE, password);
  } else {
    console.warn('경고: LAB_PASSWORD가 없어 Members Only를 건너뛴다.');
    write('lab/index.html', '<!doctype html><meta name="robots" content="noindex"><title>Members Only</title><p>Not built.</p>');
  }

  copyDir(path.join(STATIC, 'css'), path.join(SITE, 'assets', 'css'));
  copyDir(path.join(STATIC, 'js'), path.join(SITE, 'assets', 'js'));
  const imgs = copyDir(IMG_DIR, path.join(SITE, 'assets', 'img'));

  if (CUSTOM_DOMAIN) write('CNAME', `${CUSTOM_DOMAIN}\n`);
  write('robots.txt', `User-agent: *\nDisallow: /lab/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

  const urls = ['/', '/members/', '/publications/', '/photos/', '/contact/'];
  const today = new Date().toISOString().slice(0, 10);
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`
  );

  return { data, imgs, pages: written.length, origin: ORIGIN, customDomain: CUSTOM_DOMAIN, lab };
}

module.exports = { build, SITE };

if (require.main === module) {
  const pageId = process.argv[2] || process.env.NOTION_CONFIG_PAGE_ID;
  build(pageId)
    .then(({ data, imgs, pages: n, origin, customDomain, lab }) => {
      console.log(`페이지 ${n}개, 이미지 ${imgs}장 -> _site/`);
      console.log(`  구성원 ${data.members.length} / 논문 ${data.publications.length} / 공지 ${data.news.length}`);
      console.log(`  이미지 캐시 적중 ${data.stats.hits} / 새로 받음 ${data.stats.misses}`);
      console.log(`  origin ${origin}`);
      console.log(`  CNAME  ${customDomain || '(없음 — github.io로 배포)'}`);
      console.log(`  lab    ${lab ? `${lab.count}개 글, 암호문 ${lab.bytes}B` : '건너뜀'}`);
    })
    .catch((e) => {
      console.error('빌드 실패:', e.message);
      process.exit(1);
    });
}
