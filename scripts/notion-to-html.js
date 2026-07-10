// Notion 블록을 HTML로 변환한다. 외부 의존성 없음.
//
// 이미지 URL은 1시간 뒤 만료되므로 변환기가 직접 다루지 않는다.
// 호출자가 resolveImage(url, blockId) -> 로컬 경로 를 넘긴다.

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// rich_text 하나를 감싼다. 주석(annotations)은 안쪽부터 바깥으로 적용한다.
function span(rt) {
  if (rt.type === 'equation') return `<code class="eq">${esc(rt.equation.expression)}</code>`;

  let html = esc(rt.plain_text);
  const a = rt.annotations || {};
  if (a.code) html = `<code>${html}</code>`;
  if (a.bold) html = `<strong>${html}</strong>`;
  if (a.italic) html = `<em>${html}</em>`;
  if (a.strikethrough) html = `<s>${html}</s>`;
  if (a.underline) html = `<u>${html}</u>`;

  const href = rt.href || rt.text?.link?.url;
  if (href) {
    const external = /^https?:\/\//.test(href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    html = `<a href="${esc(href)}"${attrs}>${html}</a>`;
  }
  return html;
}

const richText = (arr) => (arr || []).map(span).join('');

const plain = (arr) => (arr || []).map((r) => r.plain_text).join('');

// 연속한 리스트 항목을 하나의 <ul>/<ol>로 묶는다.
function groupLists(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const listType = b.type === 'bulleted_list_item' ? 'ul' : b.type === 'numbered_list_item' ? 'ol' : null;
    if (listType && last?.list === listType) last.items.push(b);
    else if (listType) out.push({ list: listType, items: [b] });
    else out.push(b);
  }
  return out;
}

function blockToHtml(b, resolveImage) {
  const t = b.type;
  const rt = (key) => richText(b[key]?.rich_text);

  switch (t) {
    case 'paragraph': {
      const inner = rt('paragraph');
      return inner ? `<p>${inner}</p>` : '';
    }
    case 'heading_1':
      return `<h2>${rt('heading_1')}</h2>`; // 페이지 제목이 h1이므로 한 단계 낮춘다
    case 'heading_2':
      return `<h3>${rt('heading_2')}</h3>`;
    case 'heading_3':
      return `<h4>${rt('heading_3')}</h4>`;
    case 'quote':
      return `<blockquote>${rt('quote')}</blockquote>`;
    case 'callout':
      return `<aside class="callout">${rt('callout')}</aside>`;
    case 'divider':
      return '<hr>';
    case 'code':
      return `<pre><code class="lang-${esc(b.code.language || 'text')}">${esc(plain(b.code.rich_text))}</code></pre>`;
    case 'equation':
      return `<pre class="eq">${esc(b.equation.expression)}</pre>`;
    case 'image': {
      const url = b.image.type === 'external' ? b.image.external.url : b.image.file.url;
      const src = resolveImage(url, b.id);
      const caption = richText(b.image.caption);
      const img = `<img src="${esc(src)}" alt="${esc(plain(b.image.caption)) || ''}" loading="lazy">`;
      return caption ? `<figure>${img}<figcaption>${caption}</figcaption></figure>` : img;
    }
    case 'bookmark':
    case 'embed': {
      const url = b[t].url;
      return `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>`;
    }
    case 'to_do':
      return `<p><input type="checkbox" disabled${b.to_do.checked ? ' checked' : ''}> ${rt('to_do')}</p>`;
    case 'table':
    case 'table_row':
    case 'column_list':
    case 'column':
      return ''; // 연구실 사이트에서 쓰지 않는다
    default:
      return '';
  }
}

// blocks: Notion 블록 배열. resolveImage(url, blockId) -> src 문자열.
function blocksToHtml(blocks, resolveImage = (url) => url) {
  return groupLists(blocks)
    .map((b) => {
      if (b.list) {
        const items = b.items.map((i) => `<li>${richText(i[i.type].rich_text)}</li>`).join('');
        return `<${b.list}>${items}</${b.list}>`;
      }
      return blockToHtml(b, resolveImage);
    })
    .filter(Boolean)
    .join('\n');
}

module.exports = { blocksToHtml, richText, plain, esc };
