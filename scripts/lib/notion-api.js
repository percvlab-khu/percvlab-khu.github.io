// Notion REST API 최소 래퍼. 외부 의존성 없음.
//
// API 버전 2025-09-03부터 데이터베이스는 데이터 소스를 담는 컨테이너다.
//   - 행 조회 : POST /v1/data_sources/{data_source_id}/query   (databases/{id}/query 는 폐기)
//   - 행 생성 : parent 를 { type: 'data_source_id' } 로 지정
//   - DB 생성 : 속성을 initial_data_source.properties 아래에 둔다
//
// 통합(integration)을 상위 페이지에 연결하지 않으면 모든 호출이 404를 반환한다.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '2025-09-03';
const TOKEN_FILE = path.join(os.homedir(), '.config', 'percvlab', 'notion_token');

const readToken = () => {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  throw new Error(`Notion 토큰이 없다. ${TOKEN_FILE} 에 저장하거나 NOTION_TOKEN 환경변수를 설정할 것.`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Notion은 초당 평균 3회를 허용한다. 호출 간 최소 간격을 둔다.
let lastCall = 0;
async function throttle() {
  const wait = 350 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function request(method, endpoint, body, token) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    method,
    hostname: 'api.notion.com',
    path: `/v1${endpoint}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          return reject(new Error(`JSON 아님 (HTTP ${res.statusCode}): ${text.slice(0, 200)}`));
        }
        if (res.statusCode >= 400) {
          const err = new Error(`${method} ${endpoint} → HTTP ${res.statusCode}: ${json.message || text}`);
          err.status = res.statusCode;
          err.code = json.code;
          err.retryAfter = Number(res.headers['retry-after']) || 1;
          return reject(err);
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 429(rate limit)와 5xx는 재시도한다. 404는 통합 연결 누락이므로 즉시 실패시킨다.
async function call(method, endpoint, body, token = readToken(), attempt = 1) {
  await throttle();
  try {
    return await request(method, endpoint, body, token);
  } catch (e) {
    const retriable = e.status === 429 || (e.status >= 500 && e.status < 600);
    if (retriable && attempt <= 5) {
      await sleep(e.status === 429 ? e.retryAfter * 1000 : 500 * attempt);
      return call(method, endpoint, body, token, attempt + 1);
    }
    if (e.status === 404) {
      e.message += '\n  → 통합(integration)이 해당 페이지에 연결되지 않았을 가능성이 높다.';
    }
    throw e;
  }
}

const text = (s) => [{ type: 'text', text: { content: String(s ?? '').slice(0, 2000) } }];

// 페이지네이션을 모두 따라가며 결과를 모은다.
async function queryAll(dataSourceId, body = {}, token = readToken()) {
  const out = [];
  let cursor;
  do {
    const page = await call(
      'POST',
      `/data_sources/${dataSourceId}/query`,
      { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
      token
    );
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}

// 데이터베이스를 만들고 그 data_source_id를 돌려준다.
async function createDatabase(parentPageId, title, properties, token = readToken()) {
  const db = await call(
    'POST',
    '/databases',
    {
      parent: { type: 'page_id', page_id: parentPageId },
      title: text(title),
      initial_data_source: { properties },
    },
    token
  );
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`data_source_id를 찾지 못했다: ${JSON.stringify(db).slice(0, 300)}`);
  return { databaseId: db.id, dataSourceId };
}

// 기존 데이터베이스 ID로 data_source_id를 조회한다. 빌드 시작 시 필요하다.
async function resolveDataSource(databaseId, token = readToken()) {
  const db = await call('GET', `/databases/${databaseId}`, null, token);
  const id = db.data_sources?.[0]?.id;
  if (!id) throw new Error(`데이터 소스가 없다: ${databaseId}`);
  return id;
}

const createRow = (dataSourceId, properties, token = readToken()) =>
  call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties }, token);

const updatePage = (pageId, properties, token = readToken()) => call('PATCH', `/pages/${pageId}`, { properties }, token);

const appendBlocks = (blockId, children, token = readToken()) =>
  call('PATCH', `/blocks/${blockId}/children`, { children }, token);

const createPage = (parentPageId, title, children = [], token = readToken()) =>
  call(
    'POST',
    '/pages',
    { parent: { type: 'page_id', page_id: parentPageId }, properties: { title: { title: text(title) } }, children },
    token
  );

// 파일 업로드는 두 단계다. 객체를 만들고, 그 id로 바이트를 보낸다.
// 업로드된 파일은 1시간 안에 페이지에 첨부해야 한다.
function sendMultipart(uploadId, filename, contentType, buffer, token) {
  const boundary = `----percvlab${crypto.randomBytes(16).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buffer, tail]);

  const options = {
    method: 'POST',
    hostname: 'api.notion.com',
    path: `/v1/file_uploads/${uploadId}/send`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const t = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`파일 전송 실패 (HTTP ${res.statusCode}): ${t.slice(0, 200)}`));
        resolve(JSON.parse(t));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadFile(filePath, contentType = 'image/jpeg', token = readToken()) {
  const filename = path.basename(filePath);
  const { id } = await call('POST', '/file_uploads', { filename, content_type: contentType }, token);
  await throttle();
  await sendMultipart(id, filename, contentType, fs.readFileSync(filePath), token);
  return id;
}

const fileProp = (uploadId, name) => ({ files: [{ type: 'file_upload', file_upload: { id: uploadId }, name }] });

module.exports = {
  VERSION,
  readToken,
  call,
  queryAll,
  createDatabase,
  resolveDataSource,
  createRow,
  updatePage,
  appendBlocks,
  createPage,
  uploadFile,
  fileProp,
  text,
  sleep,
};
