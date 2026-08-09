const meta = document.getElementById('meta');

if (meta && window.petAPI) {
  meta.textContent = `平台：${window.petAPI.platform} · 版本 ${window.petAPI.version}`;
}
