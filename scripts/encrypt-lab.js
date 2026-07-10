// Members Only를 암호화한다. 빌드의 마지막 단계이며, 이 파일이 유일한 잠금 장치다.
//
// 서버사이드 인증으로 전환할 때는 이 파일만 지우고, 같은 데이터를 인증 검사 후
// 반환하는 서버 함수로 대체하면 된다. 수집(fetch-notion)과 변환(notion-to-html)은
// 인증 방식과 완전히 무관하다.
//
// 주의: 이것은 접근 통제(access control)가 아니라 암호화된 콘텐츠 배포다.
// 브라우저가 복호화하려면 암호문이 먼저 브라우저에 배달되어야 하고,
// 배달된 것은 누구나 저장할 수 있다. 정적 호스팅의 구조적 한계다.
// 따라서 유출되면 곤란한 자료는 이 사이트에 올리지 않는다. 파일은 Drive에 둔다.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { blocksToHtml, esc } = require('./notion-to-html');
const { layout } = require('../templates/layout');

// OWASP 권고치. 브라우저에서 대략 0.3~1초가 걸린다.
const ITERATIONS = 600000;

const deriveKey = (password, salt) => crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

// Web Crypto의 AES-GCM은 인증 태그가 암호문 끝에 붙어 있기를 기대한다.
// Node는 태그를 따로 주므로 여기서 이어 붙인다.
function seal(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct: Buffer.concat([body, cipher.getAuthTag()]) };
}

function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(32);
  const key = deriveKey(password, salt);
  const { iv, ct } = seal(key, Buffer.from(plaintext, 'utf8'));

  return {
    v: 2,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
  };
}

// 첨부파일은 [IV(12바이트) || 암호문+태그] 원시 바이너리로 저장한다.
// base64로 감싸면 용량이 33% 늘어난다. 브라우저는 앞 12바이트를 IV로 떼어 쓴다.
const sealFile = (key, buffer) => {
  const { iv, ct } = seal(key, buffer);
  return Buffer.concat([iv, ct]);
};

// 비밀번호 검증은 GCM 인증 태그가 대신한다. 비밀번호 해시를 따로 저장하지 않는다.
// 저장하면 공격자에게 오프라인 검증 수단을 하나 더 쥐여주는 셈이다.

const CATEGORIES = ['공지', '세미나', '일정', '공용자료'];

function lockPage() {
  return layout({
    path: '/lab/',
    title: 'Members Only',
    noindex: true,
    body: `    <div class="lock" id="lock">
      <div class="icon" aria-hidden="true">🔒</div>
      <h1>Members Only</h1>
      <p class="lede">Enter the lab password to continue.</p>
      <form id="lock-form">
        <input type="password" id="pw" autocomplete="current-password" placeholder="Password" aria-label="Lab password" required>
        <button type="submit" id="unlock">Unlock</button>
      </form>
      <p class="error" id="error" role="alert"></p>
      <p class="hint">Ask the lab leader if you don't have the password.</p>
    </div>

    <div id="content" hidden>
      <h1>Members Only</h1>
      <p class="lede" id="summary"></p>
      <div class="lab-toolbar" id="filters" role="group" aria-label="Filter by category"></div>
      <div id="items"></div>
    </div>
<script src="/assets/js/lab.js" defer></script>`,
  });
}

// items: fetch-notion이 모은 membersOnly 배열
// fileDir: 첨부파일 원본이 있는 캐시 디렉토리
function encryptLab(items, siteDir, password, fileDir) {
  const salt = crypto.randomBytes(32);
  const key = deriveKey(password, salt);

  const outDir = path.join(siteDir, 'data', 'files');
  fs.mkdirSync(outDir, { recursive: true });

  let fileCount = 0;
  let fileBytes = 0;

  const payload = {
    generated: new Date().toISOString(),
    categories: CATEGORIES,
    items: items.map((i) => ({
      title: i.title,
      category: i.category,
      date: i.date,
      author: i.author,
      driveLink: i.driveLink,
      html: blocksToHtml(i.blocks),
      // 파일명과 크기는 암호문 안에만 존재한다. 잠금 밖에서는 목록조차 볼 수 없다.
      attachments: (i.attachments || []).map((a) => {
        const plain = fs.readFileSync(path.join(fileDir, a.stored));
        fs.writeFileSync(path.join(outDir, `${a.stored}.enc`), sealFile(key, plain));
        fileCount++;
        fileBytes += plain.length;
        return { name: a.name, size: a.size, path: `/data/files/${a.stored}.enc` };
      }),
    })),
  };

  const { iv, ct } = seal(key, Buffer.from(JSON.stringify(payload), 'utf8'));
  const enc = {
    v: 2,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
  };

  fs.mkdirSync(path.join(siteDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'data', 'lab.enc.json'), JSON.stringify(enc));
  fs.mkdirSync(path.join(siteDir, 'lab'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'lab', 'index.html'), lockPage());

  return { count: payload.items.length, bytes: enc.ct.length, fileCount, fileBytes };
}

module.exports = { encryptLab, encrypt, ITERATIONS };
