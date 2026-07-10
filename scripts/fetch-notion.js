// Notion에서 모든 콘텐츠를 수집한다. 외부 의존성 없음.
//
// Notion이 돌려주는 이미지 URL은 S3 서명 링크라 1시간 뒤 만료된다.
// HTML에 그대로 박으면 사이트의 모든 사진이 한 시간 뒤 깨진다.
// 따라서 빌드 시점에 반드시 내려받는다.
//
// 매 빌드마다 전부 다시 받지 않도록 페이지의 last_edited_time을 매니페스트에 기록하고,
// 값이 그대로면 캐시를 재사용한다. Notion의 초당 3회 제한도 지킨다.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const api = require('./lib/notion-api');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const IMG_DIR = path.join(CACHE, 'images');
const FILE_DIR = path.join(CACHE, 'files'); // 첨부파일. 암호화 전까지 배포되지 않는다.
const MANIFEST = path.join(CACHE, 'asset-manifest.json');

const loadDbIds = () => {
  if (process.env.NOTION_DB_IDS) return JSON.parse(process.env.NOTION_DB_IDS);
  const local = path.join(ROOT, 'notion-db-ids.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  throw new Error('NOTION_DB_IDS 환경변수 또는 notion-db-ids.json 이 필요하다.');
};

const readManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {});
const saveManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) return reject(new Error(`이미지 HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          resolve(dest);
        });
      })
      .on('error', reject);
  });
}

const extOf = (url) => {
  const m = url.split('?')[0].match(/\.(jpe?g|png|gif|webp|svg)$/i);
  return m ? m[0].toLowerCase() : '.jpg';
};

// Notion 페이지 ID는 UUID처럼 보이지만 앞부분이 생성 시각에 묶여 있다.
// 같은 시각에 만든 페이지들은 앞 12자가 전부 같으므로 접두사를 파일명에 쓰면 서로 덮어쓴다.
// 해시를 써서 ID 전체를 반영한다.
const keyOf = (pageId) => crypto.createHash('sha1').update(pageId).digest('hex').slice(0, 12);

// 페이지가 마지막 수정 이후 그대로면 다시 받지 않는다.
// 이미지(공개 배포)와 첨부파일(암호화 대상)을 각각 다른 디렉토리에 둔다.
class AssetCache {
  constructor() {
    this.manifest = readManifest();
    this.next = {};
    this.hits = 0;
    this.misses = 0;
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.mkdirSync(FILE_DIR, { recursive: true });
  }

  entry(pageId, lastEdited) {
    if (!this.next[pageId]) this.next[pageId] = { lastEdited, files: [], attachments: [] };
    return this.next[pageId];
  }

  fresh(pageId, lastEdited, kind) {
    const e = this.manifest[pageId];
    if (!e || e.lastEdited !== lastEdited) return false;
    const dir = kind === 'files' ? IMG_DIR : FILE_DIR;
    const list = e[kind] || [];
    return list.every((f) => fs.existsSync(path.join(dir, kind === 'files' ? f : f.stored)));
  }

  // 이미지: url 배열 -> 로컬 파일명 배열
  async fetchImages(pageId, lastEdited, urls) {
    const e = this.entry(pageId, lastEdited);
    if (!urls.length) return [];
    if (this.fresh(pageId, lastEdited, 'files')) {
      this.hits++;
      e.files = this.manifest[pageId].files;
      return e.files;
    }
    for (const [i, url] of urls.entries()) {
      const name = `${keyOf(pageId)}-${i}${extOf(url)}`;
      await download(url, path.join(IMG_DIR, name));
      await api.sleep(120);
      e.files.push(name);
      this.misses++;
    }
    return e.files;
  }

  // 첨부파일: [{url, name}] -> [{stored, name, size}]
  // 원본 파일명은 그대로 보존하되, 저장은 해시 이름으로 한다.
  async fetchAttachments(pageId, lastEdited, items) {
    const e = this.entry(pageId, lastEdited);
    if (!items.length) return [];
    if (this.fresh(pageId, lastEdited, 'attachments')) {
      this.hits++;
      e.attachments = this.manifest[pageId].attachments;
      return e.attachments;
    }
    for (const [i, it] of items.entries()) {
      const stored = `${keyOf(pageId)}-a${i}`;
      const dest = path.join(FILE_DIR, stored);
      await download(it.url, dest);
      await api.sleep(120);
      e.attachments.push({ stored, name: it.name, size: fs.statSync(dest).size });
      this.misses++;
    }
    return e.attachments;
  }

  save() {
    saveManifest(this.next);
    return { hits: this.hits, misses: this.misses };
  }
}

// --- 속성 읽기 헬퍼 ---
const V = {
  title: (p) => (p?.title || []).map((t) => t.plain_text).join(''),
  text: (p) => (p?.rich_text || []).map((t) => t.plain_text).join(''),
  number: (p) => p?.number ?? null,
  select: (p) => p?.select?.name ?? null,
  check: (p) => !!p?.checkbox,
  url: (p) => p?.url ?? null,
  email: (p) => p?.email ?? null,
  date: (p) => p?.date?.start ?? null,
  files: (p) => (p?.files || []).map((f) => (f.type === 'external' ? f.external.url : f.file.url)),
  filesFull: (p) =>
    (p?.files || [])
      .filter((f) => f.type === 'file') // 외부 링크는 내려받지 않는다
      .map((f) => ({ url: f.file.url, name: f.name })),
};

const blocksOf = async (blockId) => {
  const out = [];
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const r = await api.call('GET', `/blocks/${blockId}/children${q}`);
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
};

async function fetchAll(configPageId) {
  const ids = loadDbIds();
  const cache = new AssetCache();
  const q = (name) => api.queryAll(ids[name].dataSourceId);

  // --- Members ---
  const memberRows = await q('Members');
  const members = [];
  for (const r of memberRows) {
    const photos = await cache.fetchImages(r.id, r.last_edited_time, V.files(r.properties.Photo).slice(0, 1));
    members.push({
      name: V.title(r.properties.Name),
      role: V.select(r.properties.Role), // 그룹핑·정렬용
      roleDetail: V.text(r.properties['Role Detail']), // 화면에 보여줄 원본 표기
      alumni: V.check(r.properties.Alumni),
      email: V.email(r.properties.Email),
      interests: V.text(r.properties.Interests),
      position: V.text(r.properties['Current Position']),
      graduated: V.number(r.properties.Graduated),
      order: V.number(r.properties.Order) ?? 999,
      photo: photos[0] || null,
    });
  }
  members.sort((a, b) => a.order - b.order);

  // --- Publications ---
  const publications = (await q('Publications'))
    .map((r) => ({
      title: V.title(r.properties.Title),
      authors: V.text(r.properties.Authors),
      venue: V.text(r.properties.Venue),
      year: V.number(r.properties.Year),
      type: V.select(r.properties.Type),
      link: V.url(r.properties.Link),
    }))
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  // --- News (본문 포함) ---
  const news = [];
  for (const r of await q('News')) {
    if (!V.check(r.properties.Published)) continue;
    news.push({
      title: V.title(r.properties.Title),
      date: V.date(r.properties.Date),
      blocks: await blocksOf(r.id),
    });
  }
  news.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // --- Research Areas ---
  const researchAreas = [];
  for (const r of await q('Research Areas')) {
    const imgs = await cache.fetchImages(r.id, r.last_edited_time, V.files(r.properties.Image).slice(0, 1));
    researchAreas.push({
      title: V.title(r.properties.Title),
      description: V.text(r.properties.Description),
      order: V.number(r.properties.Order) ?? 999,
      image: imgs[0] || null,
    });
  }
  researchAreas.sort((a, b) => a.order - b.order);

  // --- Photos ---
  const photos = [];
  for (const r of await q('Photos')) {
    const imgs = await cache.fetchImages(r.id, r.last_edited_time, V.files(r.properties.Image).slice(0, 1));
    photos.push({
      title: V.title(r.properties.Title),
      date: V.date(r.properties.Date),
      caption: V.text(r.properties.Caption),
      image: imgs[0] || null,
    });
  }
  photos.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // --- Members Only (암호화 대상. 여기서는 평문으로 모으기만 한다) ---
  const membersOnly = [];
  for (const r of await q('Members Only')) {
    if (!V.check(r.properties.Published)) continue;
    membersOnly.push({
      title: V.title(r.properties.Title),
      category: V.select(r.properties.Category),
      date: V.date(r.properties.Date),
      author: V.text(r.properties.Author),
      driveLink: V.url(r.properties['Drive Link']),
      attachments: await cache.fetchAttachments(r.id, r.last_edited_time, V.filesFull(r.properties.Files)),
      blocks: await blocksOf(r.id),
    });
  }
  membersOnly.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // --- Site Config 페이지 본문 ---
  const siteConfig = configPageId ? await blocksOf(configPageId) : [];

  const stats = cache.save();
  return { siteConfig, news, researchAreas, members, publications, photos, membersOnly, stats };
}

module.exports = { fetchAll, IMG_DIR, FILE_DIR, CACHE };

if (require.main === module) {
  const pageId = process.argv[2] || process.env.NOTION_CONFIG_PAGE_ID;
  fetchAll(pageId)
    .then((d) => {
      console.log('구성원      ', d.members.length, `(사진 ${d.members.filter((m) => m.photo).length})`);
      console.log('논문        ', d.publications.length);
      console.log('공지        ', d.news.length);
      console.log('연구분야    ', d.researchAreas.length);
      console.log('사진        ', d.photos.length);
      console.log('Members Only', d.membersOnly.length);
      console.log('Site Config ', d.siteConfig.length, '블록');
      console.log(`이미지 캐시  적중 ${d.stats.hits} / 새로 받음 ${d.stats.misses}`);
    })
    .catch((e) => {
      console.error('실패:', e.message);
      process.exit(1);
    });
}
