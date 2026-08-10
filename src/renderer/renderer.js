// T-24：移除底部平台/版本信息（renderer.js/index.html/locales 同步清理）

// 聊天面板由 chat.js 提供，这里做统一入口初始化
if (window.ChatUI && typeof window.ChatUI.init === 'function') {
  window.ChatUI.init();
}
