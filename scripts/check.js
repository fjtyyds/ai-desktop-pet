const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(message) {
  console.error(`[check] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[check] OK: ${message}`);
}

console.log(`[check] Node ${process.version}`);

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  fail('Node 版本过低，需要 >= 20');
}
pass('Node 版本满足要求');

try {
  const electronPath = require('electron');
  console.log(`[check] Electron 可执行文件: ${electronPath}`);
} catch {
  fail('Electron 未安装，请先运行 npm install');
}

const requiredFiles = [
  'AGENTS.md',
  'PLAN.md',
  'ROADMAP.md',
  'docs/SPEC.md',
  'docs/DECISIONS.md',
  'docs/STATUS.md',
  'src/main/main.js',
  'src/main/preload.js',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'src/renderer/renderer.js'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`缺少文件: ${file}`);
  }
}
pass('关键文件齐全');

const contracts = require(path.join(root, 'src', 'shared', 'contracts.js'));
if (
  !Number.isInteger(contracts.DEFAULT_SHORT_TERM_WINDOW) ||
  contracts.DEFAULT_SHORT_TERM_WINDOW <= 0
) {
  fail('contracts.DEFAULT_SHORT_TERM_WINDOW 缺失或非法');
}
if (
  !Number.isInteger(contracts.MAX_MEMORIES_IN_CONTEXT) ||
  contracts.MAX_MEMORIES_IN_CONTEXT <= 0
) {
  fail('contracts.MAX_MEMORIES_IN_CONTEXT 缺失或非法');
}
pass('M2 契约常量齐全');

const rendererChatSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'chat.js'),
  'utf8'
);
if (!rendererChatSource.includes('history.get')) {
  fail('renderer/chat.js 缺少 petAPI.history.get 历史恢复集成');
}
pass('renderer 历史恢复集成存在');

(async () => {
  try {
    const { createChatService } = require(path.join(root, 'src', 'llm', 'chat.js'));
    const { DEFAULT_SHORT_TERM_WINDOW, MAX_MEMORIES_IN_CONTEXT } = contracts;

    // 1) T-05/T-06 模块缺失时的降级收发 + 短期窗口组装
    let appended = [];
    const oldMessages = Array.from({ length: 30 }, (_value, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `旧消息 ${index + 1}`
    }));
    const fakeStore = {
      readMessages: () => oldMessages,
      appendMessages: (items) => {
        appended.push(...items);
        return appended;
      },
      readSettings: () => ({
        petName: '测试宠',
        persona: { traits: ['友好', '话痨'], tone: '温柔', backstory: '测试背景' }
      })
    };

    let captured = [];
    const spyProvider = {
      chat: async ({ messages }) => {
        captured = messages;
        return { reply: '（测试）收到。' };
      }
    };

    const svc = createChatService({ provider: spyProvider, store: fakeStore, memoryStore: null });
    const result = await svc.send('你好');
    if (!result.ok) {
      fail(`降级收发失败: ${result.error}`);
    }
    const expectedWindow = 1 + Math.min(DEFAULT_SHORT_TERM_WINDOW, oldMessages.length) + 1;
    if (captured.length !== expectedWindow) {
      fail(`短期窗口组装不正确（消息数 ${captured.length}，期望 ${expectedWindow}）`);
    }
    if (captured[0].role !== 'system' || !String(captured[0].content).includes('测试宠')) {
      fail('system 提示未包含默认人格');
    }
    if (appended.length !== 2) {
      fail('发送成功后未持久化用户/助手两条消息');
    }
    pass('chat 服务降级收发与短期窗口通过');

    // 2) 长期记忆注入与异步抽取（注入 fake memoryStore，等价 T-05 合入后）
    const added = [];
    const memoryCaptured = [];
    const memoryStore = {
      getMemories: ({ keyword }) =>
        keyword === '咖啡'
          ? [
              {
                id: 'm1',
                content: '用户喜欢咖啡',
                sessionId: 'default',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 2
              }
            ]
          : [],
      listMemories: () => [],
      touchMemory: () => null,
      appendMessages: () => [],
      addMemory: (item) => {
        added.push(item);
        return { ...item, id: 'new' };
      }
    };

    let callIndex = 0;
    const memoryProvider = {
      chat: async ({ messages }) => {
        callIndex += 1;
        if (messages[0].content.includes('记忆抽取')) {
          return { reply: '```json\n["用户喜欢咖啡"]\n```' };
        }
        memoryCaptured.push(messages);
        return { reply: '好的，记住了。' };
      }
    };
    const svcMemory = createChatService({
      provider: memoryProvider,
      store: {
        ...fakeStore,
        readSettings: () => ({ ...fakeStore.readSettings(), apiKey: 'test-key' })
      },
      memoryStore
    });
    const memoryResult = await svcMemory.send('咖啡');
    if (!memoryResult.ok) {
      fail(`记忆路径发送失败: ${memoryResult.error}`);
    }
    if (callIndex < 1 || !String(memoryCaptured[0][0].content).includes('用户喜欢咖啡')) {
      fail('长期记忆未注入 system 提示');
    }
    if (memoryCaptured[0].length > 1 + DEFAULT_SHORT_TERM_WINDOW + 1) {
      fail('长期记忆注入超出短期窗口约束');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (added.length !== 1 || added[0].content !== '用户喜欢咖啡') {
      fail('异步记忆抽取未保存预期事实');
    }
    pass('chat 服务长期记忆注入与异步抽取通过');
  } catch (error) {
    fail(`chat 服务功能检查异常: ${error && error.message ? error.message : error}`);
  }
  console.log('[check] 全部通过');
})();
