// Members Only 복호화. 외부 라이브러리 없이 Web Crypto만 쓴다.
//
// 비밀번호와 파생 키는 메모리에만 둔다. sessionStorage에 저장하지 않는다.
// 새로고침하면 다시 물어보지만, 그 대신 브라우저에 아무것도 남지 않는다.

(function () {
  const $ = (id) => document.getElementById(id);
  const lock = $('lock');
  const content = $('content');
  const form = $('lock-form');
  const errorEl = $('error');
  const button = $('unlock');

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // 파생 키는 메모리에만 둔다. 첨부파일 복호화에 재사용하므로 PBKDF2는 한 번만 돈다.
  let labKey = null;

  async function decrypt(enc, password) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    labKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.kdf.salt), iterations: enc.kdf.iterations, hash: enc.kdf.hash },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    // 태그 검증에 실패하면 예외가 난다. 그것이 곧 비밀번호 검증이다.
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, labKey, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const KB = 1024;
  const fmtSize = (n) =>
    n < KB ? `${n} B` : n < KB * KB ? `${(n / KB).toFixed(0)} KB` : `${(n / KB / KB).toFixed(1)} MB`;

  // Notion이 준 이름을 그대로 믿지 않는다. 경로 구분자를 지운다.
  const safeName = (name) => (name || 'download').replace(/[/\\]/g, '_').slice(0, 120);

  // 첨부파일은 [IV(12바이트) || 암호문+태그] 원시 바이너리다.
  async function fetchAndDecrypt(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`파일을 불러오지 못했습니다 (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 29) throw new Error('파일이 손상되었습니다.');
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, labKey, buf.subarray(12));
  }

  async function downloadAttachment(att, btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '복호화 중…';
    try {
      const plain = await fetchAndDecrypt(att.path);
      const url = URL.createObjectURL(new Blob([plain]));
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName(att.name);
      a.click();
      URL.revokeObjectURL(url);
      btn.textContent = label;
    } catch (e) {
      btn.textContent = '실패 — 다시 시도';
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  const UNSORTED = '기타';

  // 글 하나를 접이식 항목으로 그린다. 제목 줄을 누르면 본문이 펼쳐진다.
  // <details>를 쓰면 키보드·스크린리더 지원과 열고닫기가 공짜로 따라온다.
  function article(item) {
    const details = document.createElement('details');
    details.className = 'lab-item';

    const summary = document.createElement('summary');
    const h = document.createElement('span');
    h.className = 'lab-title';
    h.textContent = item.title;

    const time = document.createElement('time');
    time.textContent = [fmt(item.date), item.author].filter(Boolean).join(' · ');

    // 첨부/Drive가 있으면 접힌 상태에서도 표시로 알려준다.
    const marks = [];
    if (item.attachments && item.attachments.length) marks.push(`📎${item.attachments.length}`);
    if (item.driveLink) marks.push('🔗');
    const badge = document.createElement('span');
    badge.className = 'lab-marks';
    badge.textContent = marks.join(' ');

    summary.append(h, badge, time);
    details.append(summary);

    const body = document.createElement('div');
    body.className = 'lab-body';

    if (item.html) {
      const prose = document.createElement('div');
      prose.className = 'prose';
      prose.innerHTML = item.html; // 빌드 시점에 이스케이프된 HTML이다
      body.append(prose);
    }

    // 암호화된 첨부파일. 클릭할 때 그 파일만 받아 복호화한다.
    if (item.attachments && item.attachments.length) {
      const ul = document.createElement('ul');
      ul.className = 'attachments';
      for (const att of item.attachments) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attach';
        btn.textContent = `⬇ ${att.name}`;
        btn.addEventListener('click', () => downloadAttachment(att, btn));

        const size = document.createElement('span');
        size.className = 'size';
        size.textContent = fmtSize(att.size);

        li.append(btn, size);
        ul.append(li);
      }
      body.append(ul);
    }

    if (item.driveLink) {
      const p = document.createElement('p');
      p.className = 'drive';
      const a = document.createElement('a');
      a.href = item.driveLink;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '📎 Google Drive에서 열기';
      p.append(a);
      body.append(p);
    }

    if (!body.children.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = '내용이 없습니다.';
      body.append(p);
    }

    details.append(body);
    return details;
  }

  // 잠금을 풀면 상단 내비게이션을 카테고리 메뉴로 교체한다.
  // 테마 토글 버튼은 theme.js가 이미 리스너를 걸어두었으므로 노드를 그대로 둔다.
  function installCategoryNav(used, onSelect) {
    const nav = document.querySelector('nav.site');
    const toggle = document.getElementById('theme-toggle');
    if (!nav) return null;

    nav.querySelectorAll('a, button:not(#theme-toggle)').forEach((el) => el.remove());
    nav.classList.add('lab-nav');

    const links = new Map();
    const add = (label, value) => {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'lab-nav-link';
      a.textContent = label;
      a.addEventListener('click', () => onSelect(value));
      links.set(value, a);
      if (toggle) nav.insertBefore(a, toggle);
      else nav.append(a);
    };

    const back = document.createElement('a');
    back.href = '/';
    back.className = 'lab-nav-back';
    back.textContent = '← Site';
    if (toggle) nav.insertBefore(back, toggle);
    else nav.append(back);

    add('전체', null);
    used.forEach((c) => add(c, c));
    return links;
  }

  function render(data) {
    const items = data.items;

    // Notion에 정의된 순서대로 섹션을 세우고, 분류가 없는 글은 뒤에 모은다.
    const order = [...data.categories, UNSORTED];
    const groupOf = (i) => (data.categories.includes(i.category) ? i.category : UNSORTED);
    const used = order.filter((c) => items.some((i) => groupOf(i) === c));

    let active = null;

    const select = (value) => {
      active = value;
      draw();
    };
    const navLinks = installCategoryNav(used, select);

    $('filters').hidden = true; // 필터 역할은 상단 내비로 옮겼다

    function draw() {
      if (navLinks) {
        for (const [value, el] of navLinks) el.setAttribute('aria-current', value === active ? 'page' : 'false');
      }

      const count = active ? items.filter((i) => groupOf(i) === active).length : items.length;
      $('summary').textContent = active ? `${active} · ${count}개의 글` : `전체 ${count}개의 글`;

      const box = $('items');
      box.replaceChildren();

      const shown = active ? [active] : used;
      for (const cat of shown) {
        const list = items.filter((i) => groupOf(i) === cat);
        if (!list.length) continue;

        const section = document.createElement('section');
        section.className = 'lab-section';

        const h = document.createElement('h2');
        h.textContent = cat;
        const n = document.createElement('span');
        n.className = 'count';
        n.textContent = `(${list.length})`;
        h.append(' ', n);

        section.append(h, ...list.map(article));
        box.append(section);
      }

      if (!box.children.length) {
        const p = document.createElement('p');
        p.className = 'lede';
        p.textContent = '글이 없습니다.';
        box.append(p);
      }
    }

    draw();
    lock.hidden = true;
    content.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('pw').value;
    if (!pw) return;

    button.disabled = true;
    button.textContent = 'Unlocking…';
    errorEl.textContent = '';

    try {
      const res = await fetch('/data/lab.enc.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
      const data = await decrypt(await res.json(), pw);
      render(data);
    } catch (err) {
      errorEl.textContent = err instanceof Error && err.message.includes('불러오지') ? err.message : '비밀번호가 올바르지 않습니다.';
      $('pw').value = '';
      $('pw').focus();
    } finally {
      button.disabled = false;
      button.textContent = 'Unlock';
    }
  });
})();
