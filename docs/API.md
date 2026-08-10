# 接口约定（API.md）

> 本文档与 `src/shared/contracts.js` 共同构成接口事实来源。运行时以 contracts.js 为准，本文档负责描述与变更记录。
> 变更流程（ADR-003/014/022）：新需求 → 写 ADR → 协调者冻结本文档与 contracts.js → 任务线程只读实现 → 协调者验收合并。

## 1. 渲染层 petAPI（由 preload 暴露）

```js
window.petAPI = {
  platform: string,          // process.platform
  version: string,           // 应用版本
  chat: {
    send({ text, history? }) -> Promise<ChatSendResult>          // 非流式（兼容保留）
    sendStream({ text, history? }) -> Promise<ChatSendResult>    // M3.5 T-14：流式，期间主进程推送 chat:delta
    onDelta(cb: (delta: string) => void) -> () => void           // 订阅增量，返回取消订阅函数
    cancelStream() -> Promise<void>                              // 取消当前流（sendStream resolve {ok:false, error:'已取消'})
  },
  settings: {
    get() -> Promise<AppSettings>
    set(patch) -> Promise<AppSettings>
  },
  window: {
    hide() -> Promise<void>,          // 隐藏到托盘
    minimize() -> Promise<void>       // M3.5 收尾 T-25：最小化到任务栏（ADR-026 冻结）
  },
  history: { get() -> Promise<ChatMessage[]> },
  tts: {
    speak({ text, voice, rate, pitch }) -> Promise<TtsSpeakResult>  // T-34（ADR-029）：在线神经语音合成
  }
}
```

### 在线神经语音约定（ADR-029，T-34 冻结）

- 渲染层调用 `petAPI.tts.speak({ text, voice, rate, pitch })` 请求主进程合成 MP3；参数 `voice` 为 Edge 神经语音 ShortName（如 `zh-CN-XiaoxiaoNeural`），`rate`/`pitch` 为 SSML 风格字符串（如 `'-5%'`、`'+8Hz'`）。
- 返回 `{ ok: true, audioDataUrl: 'data:audio/mpeg;base64,...', error: null }` 或 `{ ok: false, audioDataUrl: null, error: string }`；失败不抛异常。
- 渲染层负责播放/停止（HTMLAudioElement）与失败回退 speechSynthesis；主进程负责合成、超时与 LRU 缓存。

### 流式约定（ADR-021，T-14 冻结）

- 渲染层调用 `chat.sendStream({ text, history? })` 后立即进入“正在思考…”状态，通过 `chat.onDelta(cb)` 收到的增量追加到当前回复气泡；增量按 UTF-8 字符串分片，不保证按词边界。
- 流结束时 `sendStream` 的 Promise resolve：成功 `{ ok: true, reply: 完整文本, error: null }`；失败 `{ ok: false, reply: 已收到的部分文本, error }`；取消 `{ ok: false, reply: 已收到的部分文本, error: '已取消' }`。
- 超时：首字节 30 秒或整体 60 秒（以任务卡实现为准，不得无限挂起）。
- mock 模式同样流式（把整段回复拆成小段 + 30~60ms 延迟），保证无 API Key 时体验一致。

## 2. IPC 通道（src/main/ipc.js CHANNELS）

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `chat:send` | renderer→main invoke | 非流式发送 |
| `chat:send-stream` | renderer→main invoke | 发起流式发送，结束 resolve |
| `chat:delta` | main→renderer send | 事件 `{ delta: string }` |
| `chat:stream-cancel` | renderer→main invoke | 取消当前流 |
| `settings:get` / `settings:set` | invoke | 设置读写（apiKey 经 secure-settings 加解密） |
| `window:hide` | invoke | 隐藏主窗口到托盘 |
| `window:minimize` | invoke | M3.5 收尾 T-25：最小化主窗口到任务栏（ADR-026 冻结） |
| `history:get` | invoke | 返回归一化消息历史 |
| `mood:get` | invoke | M3.5：返回当前情绪状态 |
| `memory:list` / `memory:delete` | invoke | M3.5：长期记忆列表/删除 |
| `history:export` / `history:clear` | invoke | M3.5：导出对话 / 清除数据 |
| `window:toggle-dock` | invoke | M3.5：贴边开关（T-31 起语义改为“靠边吸附”，ADR-026） |
| `tts:speak` | invoke | T-34：在线神经语音合成（参数 text/voice/rate/pitch，返回 MP3 data URL） |

## 3. 内部模块接口

- `src/llm/index.js`：`createProvider(settings)`、`createDeepSeekProvider`、`createMockProvider`、`createMood`、`buildSystemPrompt`、`DEFAULT_PERSONA`
- `src/llm/chat.js`：`createChatService({ provider, store, memoryStore })` → `{ send, loadHistory, getHistory }`（T-14 增加 `sendStream`）
- `src/llm/provider.js`：`createDeepSeekProvider({ apiKey, model })` → `{ chat }`（T-14 增加 `chatStream({ messages }, { onDelta, signal })`）
- `src/llm/mock.js`：`createMockProvider()` → `{ chat }`（T-14 增加流式实现）
- `src/storage/index.js`：`createStore(baseDir)`、`createDefaultStore()`、`resolveBaseDir()`
- `src/storage/memory-store.js`：`createMemoryStore(baseDir)`、`DEFAULT_SESSION_ID`
- `src/main/ipc.js`：`registerIpcHandlers`、`CHANNELS`
- `src/main/secure-settings.js`：`createSecureSettings`、`ENCRYPTED_PREFIX`、`API_KEY_MAX_LEN`
- `src/main/crash.js`：`initCrash`、未捕获异常/unhandledRejection → logs/app.log
- `src/main/tray.js`：`createTray`、`loadAppIcon`
- `src/shared/locales/index.js`：`resolveLocale`、`createTranslator`

## 4. 共享常量（contracts.js）

- `DEFAULT_MODEL = 'deepseek-v4-flash'`
- `DEFAULT_SHORT_TERM_WINDOW = 20`
- `MAX_MEMORIES_IN_CONTEXT = 3`

## 5. M3.5 已冻结的扩展契约（ADR-022，2026-08-09 起生效）

```js
petAPI.mood.get() -> Promise<MoodState>
petAPI.memory.list() -> Promise<MemoryItem[]>
petAPI.memory.delete(id: string) -> Promise<{ ok: boolean, error?: string }>
petAPI.memory.update(id: string, patch: { content: string }) -> Promise<{ ok: boolean, item?: MemoryItem, error?: string }>
petAPI.history.export({ format?: 'markdown' | 'json' }) -> Promise<{ ok: boolean, filePath?: string, error?: string }>
petAPI.history.clear({ scope?: 'messages' | 'memories' | 'settings' | 'all' }) -> Promise<{ ok: boolean, error?: string }>
petAPI.window.toggleDock() -> Promise<{ docked: boolean }>
petAPI.window.minimize() -> Promise<void>
```

- settings 扩展字段（由对应任务卡在 store.js 白名单登记）：`idleEnabled`（T-15）、`onboardingDone`（T-18/首次引导）、窗口位置（T-19）。`shortcutEnabled` 已按 ADR-026 决定移除（T-29 实施清理）。
- 变更记录（ADR-026，2026-08-10）：新增 `window.minimize` / IPC `window:minimize`；移除 `window.setShortcutEnabled` / IPC `window:set-shortcut`。
- 以上签名对 T-15~T-18 及后续任务卡生效；实施前如需调整，先回报协调者修订本文档。
