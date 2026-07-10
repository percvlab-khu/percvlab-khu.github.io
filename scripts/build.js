// 사이트를 _site/ 에 생성한다.
//
//   node scripts/build.js [configPageId]
//
// 산출물은 레포에 커밋하지 않는다. GitHub Actions가 곧바로 Pages로 배포한다.
// 공개 페이지는 완성된 정적 HTML이다(SEO). Members Only만 암호문 + 클라이언트 복호화다.

const fs = require('fs');
const path = require('path');
const { fetchAll, IMG_DIR } = require('./fetch-notion');
const pages = require('../templates/pages');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '_site');
const STATIC = path.join(ROOT, 'static');

const DOMAIN = 'cvlab.khu.ac.kr';

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

  // Members Only는 encrypt-lab.js가 만든다. 여기서는 자리만 잡는다.
  if (!fs.existsSync(path.join(SITE, 'lab', 'index.html'))) {
    write('lab/index.html', '<!doctype html><title>Members Only</title><p>Not built yet.</p>');
  }

  copyDir(path.join(STATIC, 'css'), path.join(SITE, 'assets', 'css'));
  copyDir(path.join(STATIC, 'js'), path.join(SITE, 'assets', 'js'));
  const imgs = copyDir(IMG_DIR, path.join(SITE, 'assets', 'img'));

  write('CNAME', `${DOMAIN}\n`);
  write('robots.txt', `User-agent: *\nDisallow: /lab/\n\nSitemap: https://${DOMAIN}/sitemap.xml\n`);

  const urls = ['/', '/members/', '/publications/', '/photos/', '/contact/'];
  const today = new Date().toISOString().slice(0, 10);
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>https://${DOMAIN}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`
  );

  return { data, imgs, pages: written.length };
}

module.exports = { build, SITE };

if (require.main === module) {
  const pageId = process.argv[2] || process.env.NOTION_CONFIG_PAGE_ID;
  build(pageId)
    .then(({ data, imgs, pages: n }) => {
      console.log(`페이지 ${n}개, 이미지 ${imgs}장 -> _site/`);
      console.log(`  구성원 ${data.members.length} / 논문 ${data.publications.length} / 공지 ${data.news.length}`);
      console.log(`  이미지 캐시 적중 ${data.stats.hits} / 새로 받음 ${data.stats.misses}`);
    })
    .catch((e) => {
      console.error('빌드 실패:', e.message);
      process.exit(1);
    });
}
