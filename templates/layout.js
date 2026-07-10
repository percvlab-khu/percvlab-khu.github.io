// 모든 페이지가 공유하는 HTML 셸.

const { esc } = require('../scripts/notion-to-html');

const SITE = 'PerCVLab';
const FULL = 'Perception & Computer Vision Lab, Kyung Hee University';

// 학교에 도메인 변경 신청이 승인되기 전까지는 github.io 주소로 배포한다.
// 승인 후 SITE_ORIGIN과 CUSTOM_DOMAIN을 설정하면 canonical·sitemap·CNAME이 함께 바뀐다.
const ORIGIN = process.env.SITE_ORIGIN || 'https://percvlab-khu.github.io';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/members/', label: 'Members' },
  { href: '/publications/', label: 'Publications' },
  { href: '/photos/', label: 'Photos' },
  { href: '/contact/', label: 'Contact' },
  { href: '/lab/', label: 'Members Only', locked: true },
];

// 첫 페인트 전에 테마를 정해야 흰 화면이 번쩍이지 않는다.
// 저장된 선택이 없으면 OS 설정을 따른다.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('theme');
if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

function nav(current) {
  return NAV.map((n) => {
    const active = n.href === current ? ' aria-current="page"' : '';
    const cls = n.locked ? ' class="locked"' : '';
    return `<a href="${n.href}"${cls}${active}>${esc(n.label)}</a>`;
  }).join('');
}

// opts: { title, description, path, noindex, body, bodyClass }
function layout({ title, description, path = '/', noindex = false, body, bodyClass = '' }) {
  const pageTitle = path === '/' ? `${SITE} — ${FULL}` : `${esc(title)} · ${SITE}`;
  const desc = description || FULL;

  return `<!doctype html>
<html lang="en" ${''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${ORIGIN}${path}">`}
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/assets/css/site.css">
<script>${THEME_BOOT}</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/">PerCV<span>Lab</span></a>
    <nav class="site" aria-label="Primary">
      ${nav(path)}
      <button id="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle theme">◐</button>
    </nav>
  </div>
</header>
<main id="main">
  <div class="wrap">
${body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <div>&copy; ${new Date().getFullYear()} ${SITE}, Kyung Hee University</div>
    <div>307, Electronic Information College Bldg., Global Campus</div>
  </div>
</footer>
<script src="/assets/js/theme.js" defer></script>
</body>
</html>`;
}

module.exports = { layout, SITE, FULL, ORIGIN, NAV };
