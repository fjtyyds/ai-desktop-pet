const meta = document.getElementById('meta');

if (meta && window.petAPI) {
  meta.textContent = `平台：${window.petAPI.platform} · 版本 ${window.petAPI.version}`;
}

// 聊天面板由 chat.js 提供，这里做统一入口初始化
if (window.ChatUI && typeof window.ChatUI.init === 'function') {
  window.ChatUI.init();
}