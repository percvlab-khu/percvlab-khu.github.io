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

  async function decrypt(enc, password) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.kdf.salt), iterations: enc.kdf.iterations, hash: enc.kdf.hash },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    // 태그 검증에 실패하면 예외가 난다. 그것이 곧 비밀번호 검증이다.
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  function render(data) {
    const items = data.items;
    $('summary').textContent = `${items.length}개의 글`;

    const used = data.categories.filter((c) => items.some((i) => i.category === c));
    let active = null;

    const filters = $('filters');
    const makeBtn = (label, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(active === value));
      b.addEventListener('click', () => {
        active = value;
        draw();
      });
      return b;
    };

    function draw() {
      filters.replaceChildren(makeBtn('전체', null), ...used.map((c) => makeBtn(c, c)));

      const list = active ? items.filter((i) => i.category === active) : items;
      const box = $('items');
      box.replaceChildren();

      if (!list.length) {
        const p = document.createElement('p');
        p.className = 'lede';
        p.textContent = '글이 없습니다.';
        box.append(p);
        return;
      }

      for (const item of list) {
        const art = document.createElement('article');
        art.className = 'lab-item';

        const head = document.createElement('div');
        head.className = 'head';

        const h = document.createElement('h3');
        h.textContent = item.title;

        const time = document.createElement('time');
        time.textContent = [item.category, fmt(item.date), item.author].filter(Boolean).join(' · ');

        head.append(h, time);
        art.append(head);

        if (item.html) {
          const body = document.createElement('div');
          body.className = 'prose';
          body.innerHTML = item.html; // 빌드 시점에 이스케이프된 HTML이다
          art.append(body);
        }

        if (item.driveLink) {
          const p = document.createElement('p');
          p.className = 'drive';
          const a = document.createElement('a');
          a.href = item.driveLink;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = '📎 첨부파일 (Google Drive)';
          p.append(a);
          art.append(p);
        }
        box.append(art);
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
