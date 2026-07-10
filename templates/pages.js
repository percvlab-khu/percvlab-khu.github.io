// 페이지별 본문 생성. layout이 감싸는 안쪽만 만든다.

const { layout } = require('./layout');
const { blocksToHtml, esc, plain } = require('../scripts/notion-to-html');

const IMG = (file) => `/assets/img/${file}`;

const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const avatar = (m) =>
  m.photo
    ? `<img src="${IMG(m.photo)}" alt="${esc(m.name)}" width="104" height="104" loading="lazy">`
    : `<div class="avatar" aria-hidden="true">${esc(initials(m.name))}</div>`;

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// Site Config는 heading_2 로 구분된 섹션들이다. 제목으로 잘라 쓴다.
function sections(blocks) {
  const out = {};
  let key = null;
  for (const b of blocks) {
    if (b.type === 'heading_2') {
      key = plain(b.heading_2.rich_text).trim();
      out[key] = [];
    } else if (key) out[key].push(b);
  }
  return out;
}

// Role은 그룹핑 기준일 뿐이다. 개인의 과정 표기는 Role Detail에 있다
// ("M.S.–Ph.D. Integrated Course", "Ph.D. Candidate" 등).
const GROUP_LABEL = { Professor: 'Professor', PhD: 'Ph.D. Course', MS: 'M.S. Course', BS: 'Undergraduate' };
const ROLE_ORDER = ['PhD', 'MS', 'BS'];

const roleOf = (m) => m.roleDetail || GROUP_LABEL[m.role] || m.role || '';

// --- Home ---
function home({ siteConfig, news }) {
  const s = sections(siteConfig);
  const about = s['About'] ? blocksToHtml(s['About']) : '';

  const newsHtml = news.length
    ? news
        .map(
          (n) => `<article class="news-item">
      <time datetime="${esc(n.date || '')}">${esc(fmtDate(n.date))}</time>
      <h3>${esc(n.title)}</h3>
      ${blocksToHtml(n.blocks)}
    </article>`
        )
        .join('\n')
    : '<p class="lede">No news yet.</p>';

  return layout({
    path: '/',
    title: 'Home',
    description: 'Perception & Computer Vision Lab at Kyung Hee University — 3D vision, generative models, anomaly detection.',
    body: `    <section class="hero">
      <p class="tagline">Kyung Hee University</p>
      <h1>Perception &amp; Computer Vision Lab</h1>
      <p class="lede">We study how machines perceive, reconstruct, and generate the visual world.</p>
    </section>

    <h2>News</h2>
    ${newsHtml}

    <h2>Research</h2>
    <div class="prose">${about}</div>`,
  });
}

// --- Members ---
function members({ members: all }) {
  const current = all.filter((m) => !m.alumni);
  const alumni = all.filter((m) => m.alumni);
  const prof = current.filter((m) => m.role === 'Professor');

  // 사진과 텍스트를 각각 하나의 덩어리로 묶는다. 그래야 교수 카드처럼 가로로 눕혔을 때
  // 이름·역할·이메일이 제각각 flex 아이템으로 흩어지지 않는다.
  const card = (m) => `<div class="member">
      ${avatar(m)}
      <div class="info">
        <div class="name">${esc(m.name)}</div>
        <div class="role">${esc(roleOf(m))}</div>
        ${m.interests ? `<div class="meta">${esc(m.interests)}</div>` : ''}
        ${m.email ? `<a class="mail" href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}
      </div>
    </div>`;

  const groups = ROLE_ORDER.map((role) => {
    const list = current.filter((m) => m.role === role);
    if (!list.length) return '';
    return `<h2>${GROUP_LABEL[role]} <span class="count">(${list.length})</span></h2>
    <div class="member-grid">${list.map(card).join('')}</div>`;
  }).join('\n');

  // 졸업생은 카드 대신 밀도 있는 목록으로 보여준다. 30명을 카드로 깔면 페이지가 지나치게 길어진다.
  const alumniRow = (m) => `<li>
      <span class="who">
        ${m.photo ? `<img src="${IMG(m.photo)}" alt="" width="34" height="34" loading="lazy">` : `<span class="avatar" aria-hidden="true">${esc(initials(m.name))}</span>`}
        <span>${esc(m.name)} <span class="role">${esc(roleOf(m))}</span></span>
      </span>
      <span class="where">${esc(m.position || '')}</span>
    </li>`;

  const alumniHtml = alumni.length
    ? `<h2>Alumni <span class="count">(${alumni.length})</span></h2>
    <ul class="alumni-list">${alumni.map(alumniRow).join('')}</ul>`
    : '';

  return layout({
    path: '/members/',
    title: 'Members',
    description: 'Faculty, graduate students, and alumni of PerCVLab.',
    body: `    <h1>Members</h1>
    <p class="lede">${current.length} current members, ${alumni.length} alumni.</p>

    <div class="member-grid lead">${prof.map(card).join('')}</div>
    ${groups}
    ${alumniHtml}`,
  });
}

// --- Publications ---
function publications({ publications: pubs }) {
  const years = [...new Set(pubs.map((p) => p.year))].sort((a, b) => b - a);

  const one = (p) => {
    const badge = p.type && p.type !== 'Conference' ? `<span class="badge ${p.type.toLowerCase()}">${esc(p.type)}</span>` : '';
    const title = p.link
      ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>`
      : esc(p.title);
    return `<article class="pub">
      <div class="title">${title}${badge}</div>
      <div class="authors">${esc(p.authors)}</div>
      <div class="venue">${esc(p.venue)}</div>
    </article>`;
  };

  const body = years
    .map((y) => {
      const list = pubs.filter((p) => p.year === y);
      return `<div class="pub-year"><h2>${y}</h2><span class="count">${list.length} paper${list.length > 1 ? 's' : ''}</span></div>
    ${list.map(one).join('')}`;
    })
    .join('\n');

  return layout({
    path: '/publications/',
    title: 'Publications',
    description: `${pubs.length} publications from PerCVLab, ${years[years.length - 1]}–${years[0]}.`,
    body: `    <h1>Publications</h1>
    <p class="lede">${pubs.length} papers, ${years[years.length - 1]}–${years[0]}.</p>
    ${body}`,
  });
}

// --- Photos ---
function photos({ photos: list }) {
  const body = list.length
    ? `<div class="photo-grid">${list
        .map(
          (p) => `<figure>
        ${p.image ? `<img src="${IMG(p.image)}" alt="${esc(p.title)}" loading="lazy">` : ''}
        <figcaption>${esc(p.title)}${p.date ? ` · ${esc(fmtDate(p.date))}` : ''}</figcaption>
      </figure>`
        )
        .join('')}</div>`
    : '<p class="lede">No photos yet.</p>';

  return layout({
    path: '/photos/',
    title: 'Photos',
    description: 'Life at PerCVLab.',
    body: `    <h1>Photos</h1>
    <p class="lede">Life at the lab.</p>
    ${body}`,
  });
}

// --- Contact ---
function contact({ siteConfig }) {
  const s = sections(siteConfig);
  const join = s['Join Us'] ? blocksToHtml(s['Join Us']) : '';
  const info = s['Contact'] ? blocksToHtml(s['Contact']) : '';

  return layout({
    path: '/contact/',
    title: 'Contact',
    description: 'How to reach PerCVLab at Kyung Hee University.',
    body: `    <h1>Contact</h1>
    <div class="prose">${join}</div>
    <div class="contact-grid">
      <div class="card prose">${info}</div>
    </div>`,
  });
}

module.exports = { home, members, publications, photos, contact };
