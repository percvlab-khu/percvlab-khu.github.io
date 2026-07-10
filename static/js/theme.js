// 테마 토글. 저장된 선택이 없으면 OS 설정을 따른다.
// 첫 페인트 전 적용은 <head>의 인라인 스크립트가 이미 처리했다.

(function () {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = () => root.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light');

  const label = () => {
    const t = current();
    btn.textContent = t === 'dark' ? '☀' : '◐';
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };

  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      /* 사생활 보호 모드 등 저장이 막힌 경우 무시한다 */
    }
    label();
  });

  // 사용자가 직접 고르지 않았다면 OS 설정 변화를 따라간다.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!root.getAttribute('data-theme')) label();
  });

  label();
})();
