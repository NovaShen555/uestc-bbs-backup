import { processThread, checkAndUpdateThread } from './crawler.js';

// 格式化时间为 UTC+8
function formatTime(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export async function renderHome(env, sort = "created") {
  // 根据排序参数选择 SQL
  const orderBy = sort === "reply" ? "last_synced DESC" : "created_at DESC";
  const { results } = await env.DB.prepare(
    `SELECT * FROM threads ORDER BY ${orderBy} LIMIT 50`
  ).all();

  // 获取最后同步时间
  const lastSync = await env.DB.prepare(
    "SELECT MAX(last_synced) as last_time FROM threads"
  ).first();
  const lastSyncTime = formatTime(lastSync?.last_time) || '从未同步';

  const html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>河畔监控台</title>
    <style>
      :root {
        --primary-color: #0070f3;
        --bg-color: #f5f7fa;
        --card-bg: #fff;
        --text-color: #333;
        --text-secondary: #111;
        --meta-color: #999;
        --border-color: #eaeaea;
        --sidebar-width: 380px;
        --hover-bg: #f8f9fa;
        --quote-bg: #f8f9fa;
        --quote-color: #555;
        --floor-bg: #eaf4ff;
        --error-bg: #fff5f5;
        --error-border: #ffccc7;
        --error-color: #cf1322;
        --active-bg: #f8faff;
        --scrollbar-thumb: #c1c1c1;
        --scrollbar-hover: #a1a1a1;
      }
      [data-theme="dark"] {
        --primary-color: #3b9eff;
        --bg-color: #1a1a2e;
        --card-bg: #16213e;
        --text-color: #e4e4e7;
        --text-secondary: #f4f4f5;
        --meta-color: #9ca3af;
        --border-color: #374151;
        --hover-bg: #1e3a5f;
        --quote-bg: #1e293b;
        --quote-color: #94a3b8;
        --floor-bg: #1e3a5f;
        --error-bg: #450a0a;
        --error-border: #991b1b;
        --error-color: #fca5a5;
        --active-bg: #1e3a5f;
        --scrollbar-thumb: #4b5563;
        --scrollbar-hover: #6b7280;
      }
      * { box-sizing: border-box; }

      /* 自定义滚动条 */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: var(--bg-color); border-radius: 4px; }
      ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; transition: background 0.2s; }
      ::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }
      * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) var(--bg-color); }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        margin: 0;
        padding: 0;
        line-height: 1.6;
        overflow: hidden;
        height: 100vh;
      }

      /* 主布局 */
      .app-container {
        display: flex;
        height: 100vh;
        transition: all 0.3s ease;
      }

      /* 侧边栏 - 帖子列表 */
      .sidebar {
        width: 100%;
        height: 100%;
        padding: 20px;
        overflow-y: auto;
        transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
      }
      .sidebar.collapsed {
        width: var(--sidebar-width);
        border-right: 1px solid var(--border-color);
      }
      .sidebar-inner {
        max-width: 900px;
        margin: 0 auto;
      }
      .sidebar.collapsed .sidebar-inner {
        max-width: none;
      }

      /* 主内容区 */
      .main-content {
        flex: 1;
        height: 100%;
        overflow-y: auto;
        padding: 20px;
        display: none;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .main-content.visible {
        display: block;
        opacity: 1;
      }
      .main-content-inner {
        max-width: 800px;
        margin: 0 auto;
      }

      /* 页面头部 */
      .page-header {
        background: var(--card-bg); padding: 20px; border-radius: 12px; margin-bottom: 15px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-bottom: 3px solid var(--primary-color);
      }
      .sidebar.collapsed .page-header { padding: 15px; }
      .page-header h1 { margin: 0; font-size: 1.6rem; color: var(--text-secondary); }
      .sidebar.collapsed .page-header h1 { font-size: 1.2rem; }
      .page-header .sync-time { font-size: 0.8rem; color: var(--meta-color); margin-top: 6px; }

      /* 工具栏 */
      .toolbar {
        background: var(--card-bg); padding: 12px 15px; border-radius: 10px; margin-bottom: 15px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
        display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
      }
      .toolbar-left { display: flex; gap: 6px; align-items: center; }
      .toolbar-right { display: flex; gap: 6px; align-items: center; }
      .sort-tabs { display: flex; gap: 6px; }
      .sort-tab {
        padding: 6px 12px; border-radius: 6px; text-decoration: none;
        font-size: 0.85rem; font-weight: 500; transition: all 0.2s;
        border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color);
        cursor: pointer;
      }
      .sort-tab:hover { background: var(--hover-bg); }
      .sort-tab.active {
        background: var(--primary-color); color: #fff; border-color: var(--primary-color);
      }

      /* 主题切换按钮 */
      .theme-toggle {
        width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--border-color);
        background: var(--card-bg); cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s; color: var(--text-color);
      }
      .theme-toggle:hover { background: var(--hover-bg); }
      .theme-toggle svg { width: 18px; height: 18px; }
      .theme-toggle .icon-sun { display: none; }
      .theme-toggle .icon-moon { display: block; }
      [data-theme="dark"] .theme-toggle .icon-sun { display: block; }
      [data-theme="dark"] .theme-toggle .icon-moon { display: none; }

      .btn {
        background: var(--primary-color); color: white; border: none;
        padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 500;
      }
      .btn:disabled { background: #ccc; cursor: not-allowed; }
      .btn:hover:not(:disabled) { background: #005bb5; }
      .btn-sm { padding: 6px 10px; font-size: 0.8rem; }

      /* 控制台输出 */
      #console-output {
        background: #1e1e1e; color: #4af626; font-family: 'Consolas', 'Monaco', monospace;
        padding: 12px; border-radius: 8px; margin-bottom: 15px;
        height: 150px; overflow-y: auto; white-space: pre-wrap; font-size: 0.8em;
        display: none; border: 1px solid #333;
      }

      /* 帖子列表 */
      .thread-list { display: flex; flex-direction: column; gap: 8px; }
      .thread-card {
        background: var(--card-bg); border-radius: 8px; padding: 12px 15px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
        cursor: pointer; transition: all 0.2s;
      }
      .thread-card:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        border-color: var(--primary-color);
      }
      .thread-card.active {
        border-color: var(--primary-color);
        border-left: 3px solid var(--primary-color);
        background: var(--active-bg);
      }

      .thread-title {
        font-size: 0.95rem; font-weight: 500; margin-bottom: 4px;
        display: flex; align-items: center; gap: 6px;
      }
      .thread-title-text {
        color: var(--text-color);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1;
      }
      .thread-id { font-size: 0.7rem; color: var(--meta-color); font-weight: normal; flex-shrink: 0; }

      .thread-meta { font-size: 0.75rem; color: var(--meta-color); display: flex; gap: 8px; flex-wrap: wrap; }
      .thread-stats { font-size: 0.75rem; color: var(--meta-color); margin-top: 4px; }
      .reply-count { font-weight: 600; color: var(--primary-color); }

      /* === 主内容区样式 === */
      .content-placeholder {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100%; color: var(--meta-color); text-align: center;
      }
      .content-placeholder svg { width: 80px; height: 80px; margin-bottom: 20px; opacity: 0.3; }

      .thread-header {
        background: var(--card-bg); padding: 20px; border-radius: 12px; margin-bottom: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-bottom: 3px solid var(--primary-color);
      }
      .thread-header h1 { margin: 0 0 12px 0; font-size: 1.5rem; color: var(--text-secondary); }
      .thread-info { color: var(--meta-color); font-size: 0.85rem; display: flex; gap: 12px; flex-wrap: wrap; }

      .post-card {
        background: var(--card-bg); border-radius: 10px; padding: 16px; margin-bottom: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
      }
      .post-card.is-landlord { border-left: 3px solid var(--primary-color); }

      .post-meta {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color); font-size: 0.85rem;
      }
      .author-info { display: flex; align-items: center; gap: 8px; }
      .floor-tag {
        background: var(--floor-bg); color: var(--primary-color); padding: 2px 6px;
        border-radius: 4px; font-weight: bold; font-size: 0.8rem;
      }
      .post-time { color: var(--meta-color); font-size: 0.8rem; }
      .post-id { color: var(--meta-color); font-size: 0.75rem; margin-left: 8px; }

      .post-content { font-size: 1rem; overflow-wrap: break-word; }
      .post-content img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .post-content img.emoji { display: inline; width: auto; height: 1.5em; margin: 0 2px; vertical-align: middle; box-shadow: none; border-radius: 0; }
      .post-content a { color: var(--primary-color); }
      .post-content .attachment-placeholder { color: var(--meta-color); font-style: italic; }
      blockquote {
        background: var(--quote-bg); border-left: 4px solid var(--border-color); margin: 12px 0; padding: 10px 14px; color: var(--quote-color); font-size: 0.9rem;
      }

      .loading-spinner {
        display: flex; align-items: center; justify-content: center; padding: 40px;
      }
      .spinner {
        width: 40px; height: 40px; border: 3px solid var(--border-color);
        border-top-color: var(--primary-color); border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      .error-message {
        background: var(--error-bg); border: 1px solid var(--error-border); border-radius: 8px;
        padding: 20px; text-align: center; color: var(--error-color);
      }

      /* 返回/关闭按钮 */
      .back-btn {
        margin-bottom: 15px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      /* 响应式 */
      @media (max-width: 900px) {
        :root { --sidebar-width: 100%; }
        .sidebar.collapsed { position: absolute; left: -100%; width: 100%; }
        .main-content { padding: 15px; }
        .back-btn { display: inline-flex; }
      }
    </style>
  </head>
  <body>
    <div class="app-container">
      <!-- 侧边栏: 帖子列表 -->
      <div class="sidebar" id="sidebar">
        <div class="sidebar-inner">
          <div class="page-header">
            <h1>河畔监控台</h1>
            <div class="sync-time">最后同步: ${lastSyncTime}</div>
          </div>

          <div class="toolbar">
            <div class="toolbar-left">
              <div class="sort-tabs">
                <span class="sort-tab ${sort === "created" ? "active" : ""}" data-sort="created">按发帖时间</span>
                <span class="sort-tab ${sort === "reply" ? "active" : ""}" data-sort="reply">按回复时间</span>
              </div>
            </div>
            <div class="toolbar-right">
              <button id="syncBtn" class="btn btn-sm">同步数据</button>
              <button class="theme-toggle" id="themeToggle" title="切换主题">
                <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </button>
            </div>
          </div>

          <div id="console-output"></div>

          <div class="thread-list" id="threadList">
            ${results.map(t => `
              <div class="thread-card" data-id="${t.thread_id}">
                <div class="thread-title">
                  <span class="thread-title-text">${t.subject}</span>
                  <span class="thread-id">#${t.thread_id}</span>
                </div>
                <div class="thread-meta">
                  <span>${t.author}</span>
                  <span>${formatTime(t.created_at)}</span>
                </div>
                <div class="thread-stats">
                  <span class="reply-count">${t.replies} 回复</span>
                  <span> · ${t.views || 0} 浏览</span>
                  ${t.last_synced ? `<span> · 最新: ${formatTime(t.last_synced)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 主内容区 -->
      <div class="main-content" id="mainContent">
        <div class="main-content-inner" id="contentInner">
          <div class="content-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
            </svg>
            <p>点击左侧帖子查看内容</p>
          </div>
        </div>
      </div>
    </div>

    <script>
      let currentThreadId = null;

      // 主题初始化
      (function initTheme() {
        const saved = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      })();

      document.addEventListener('DOMContentLoaded', () => {
        // 主题切换
        document.getElementById('themeToggle').addEventListener('click', () => {
          const html = document.documentElement;
          const isDark = html.getAttribute('data-theme') === 'dark';
          if (isDark) {
            html.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
          } else {
            html.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
          }
        });

        // 帖子点击事件
        document.getElementById('threadList').addEventListener('click', (e) => {
          const card = e.target.closest('.thread-card');
          if (card) {
            const threadId = card.dataset.id;
            loadThread(threadId);
          }
        });

        // 排序切换
        document.querySelectorAll('.sort-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            const sort = tab.dataset.sort;
            window.location.href = '/?sort=' + sort;
          });
        });

        // 同步按钮
        document.getElementById('syncBtn').addEventListener('click', () => startSync());

        // 检查 URL hash
        const hash = window.location.hash;
        if (hash && hash.startsWith('#thread-')) {
          const id = hash.replace('#thread-', '');
          loadThread(id);
        }
      });

      async function loadThread(threadId) {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        const contentInner = document.getElementById('contentInner');

        // 更新选中状态
        document.querySelectorAll('.thread-card').forEach(c => c.classList.remove('active'));
        const activeCard = document.querySelector(\`.thread-card[data-id="\${threadId}"]\`);
        if (activeCard) activeCard.classList.add('active');

        // 展开布局
        sidebar.classList.add('collapsed');
        mainContent.classList.add('visible');

        // 更新 URL
        history.replaceState(null, '', '#thread-' + threadId);
        currentThreadId = threadId;

        // 显示加载状态
        contentInner.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

        try {
          const resp = await fetch('/api/thread/' + threadId);
          const data = await resp.json();

          if (data.error) {
            contentInner.innerHTML = \`
              <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>
              <div class="error-message">\${data.error}</div>
            \`;
            return;
          }

          renderThread(data);
        } catch (err) {
          contentInner.innerHTML = \`
            <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>
            <div class="error-message">加载失败: \${err.message}</div>
          \`;
        }
      }

      function renderThread(data) {
        const { thread, comments } = data;
        const contentInner = document.getElementById('contentInner');

        const html = \`
          <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>

          <div class="thread-header">
            <h1>\${thread.subject}</h1>
            <div class="thread-info">
              <span>ID: \${thread.thread_id}</span>
              <span>楼主: <strong>\${thread.author}</strong></span>
              <span>回复: \${thread.replies}</span>
              <span>发布: \${thread.created_at_fmt}</span>
              \${thread.last_synced_fmt ? \`<span>同步: \${thread.last_synced_fmt}</span>\` : ''}
            </div>
          </div>

          <div class="post-list">
            \${comments.map(c => \`
              <div class="post-card \${c.position === 1 ? 'is-landlord' : ''}">
                <div class="post-meta">
                  <div class="author-info">
                    <span class="floor-tag">\${c.position === 1 ? '楼主' : '#' + c.position}</span>
                    <strong>\${c.author}</strong>
                  </div>
                  <div class="post-time">
                    \${c.post_date_fmt}
                    <span class="post-id">#\${c.post_id}</span>
                  </div>
                </div>
                <div class="post-content">\${c.content_html}</div>
              </div>
            \`).join('')}
          </div>
        \`;

        contentInner.innerHTML = html;
        contentInner.scrollTop = 0;
        document.getElementById('mainContent').scrollTop = 0;
      }

      function closeThread() {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');

        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('visible');
        document.querySelectorAll('.thread-card').forEach(c => c.classList.remove('active'));
        history.replaceState(null, '', window.location.pathname + window.location.search);
        currentThreadId = null;
      }

      async function startSync(round = 1) {
        const btn = document.getElementById('syncBtn');
        const output = document.getElementById('console-output');
        const nl = String.fromCharCode(10);

        btn.disabled = true;
        output.style.display = "block";

        if (round === 1) {
          btn.textContent = "同步中...";
          output.textContent = "> 开始同步..." + nl;
        } else {
          btn.textContent = \`同步 (\${round})...\`;
          output.textContent += nl + \`> ===== 第 \${round} 轮 =====\` + nl;
        }

        let shouldContinue = false;

        try {
          const response = await fetch('/sync');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            fullText += text;
            output.textContent += text;
            output.scrollTop = output.scrollHeight;
          }

          if (fullText.includes("[SYNC_MORE]")) {
            shouldContinue = true;
          }
        } catch (err) {
          output.textContent += nl + "错误: " + err.message;
        }

        if (shouldContinue && round < 20) {
          output.textContent += nl + "> 继续..." + nl;
          await new Promise(r => setTimeout(r, 1000));
          await startSync(round + 1);
        } else {
          btn.disabled = false;
          btn.textContent = "同步数据";
          output.textContent += nl + "> 完成！刷新页面查看最新数据。";
        }
      }
    </script>
  </body>
  </html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}

// API: 获取帖子数据 (JSON)
export async function getThreadData(env, threadId) {
  const queryDB = async () => {
    const tPromise = env.DB.prepare("SELECT * FROM threads WHERE thread_id = ?").bind(threadId).first();
    const cPromise = env.DB.prepare("SELECT * FROM comments WHERE thread_id = ? ORDER BY position ASC").bind(threadId).all();
    const [t, cData] = await Promise.all([tPromise, cPromise]);
    return {
      thread: t,
      comments: cData.results || []
    };
  };

  let { thread, comments } = await queryDB();

  if (thread) {
    // 本地有帖子，检查是否需要更新
    try {
      await checkAndUpdateThread(env, threadId, console.log);
      const newData = await queryDB();
      thread = newData.thread;
      comments = newData.comments;
    } catch (e) {
      console.error(`[CheckUpdate] 检查更新失败: ${e.message}`);
    }
  } else {
    console.log(`[LazyLoad] 本地未找到帖子 ${threadId}，正在尝试回源抓取...`);
    try {
      await processThread(env, threadId, console.log);
      const newData = await queryDB();
      thread = newData.thread;
      comments = newData.comments;
    } catch (e) {
      console.error(`[LazyLoad] 抓取失败: ${e.message}`);
    }
  }

  if (!thread) {
    return new Response(JSON.stringify({ error: `未找到 ID 为 ${threadId} 的帖子` }), {
      status: 404,
      headers: { "content-type": "application/json;charset=utf-8" }
    });
  }

  // 格式化数据
  const result = {
    thread: {
      ...thread,
      created_at_fmt: formatTime(thread.created_at),
      last_synced_fmt: formatTime(thread.last_synced)
    },
    comments: comments.map(c => {
      // 解析 raw_json 获取附件信息
      let attachments = [];
      try {
        const rawData = JSON.parse(c.raw_json || '{}');
        attachments = rawData.attachments || [];
      } catch (e) {}

      // 构建附件ID映射
      const attachMap = {};
      for (const att of attachments) {
        attachMap[att.attachment_id] = att;
      }

      // 渲染内容
      const content_html = renderContent(c.content || "", attachMap);

      return {
        ...c,
        post_date_fmt: formatTime(c.post_date),
        content_html
      };
    })
  };

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json;charset=utf-8" }
  });
}

// 表情包映射数据 (emoji_id -> {path, filename})
const EMOJI_PACKS = [
  { path: "alu", codePrefix: "a", items: [[1135,"22.gif"],[1136,"23.gif"],[1137,"24.gif"],[1138,"25.gif"],[1139,"26.gif"],[1140,"27.gif"],[1141,"28.gif"],[1142,"29.gif"],[1143,"30.gif"],[1144,"31.gif"],[1145,"32.gif"],[1146,"33.gif"],[1147,"34.gif"],[1148,"35.gif"],[1149,"36.gif"],[1150,"37.gif"],[1151,"38.gif"],[1152,"39.gif"],[1153,"40.gif"],[1154,"41.gif"],[1155,"42.gif"],[1156,"43.gif"],[1157,"44.gif"],[1158,"45.gif"],[1159,"46.gif"],[1160,"47.gif"],[1161,"48.gif"],[1162,"49.gif"],[1163,"50.gif"],[1164,"51.gif"],[1165,"52.gif"],[1166,"53.gif"],[1167,"54.gif"],[1168,"55.gif"],[1169,"56.gif"],[1170,"57.gif"],[1171,"58.gif"],[1172,"59.gif"],[1173,"60.gif"],[1174,"61.gif"],[1175,"62.gif"],[1176,"63.gif"],[1177,"64.gif"],[1178,"65.gif"],[1179,"66.gif"],[1180,"67.gif"],[1181,"68.gif"],[1182,"69.gif"],[1183,"70.gif"],[1184,"71.gif"],[1185,"72.gif"],[1186,"73.gif"],[1187,"74.gif"],[1188,"75.gif"],[1189,"76.gif"],[1190,"77.gif"],[1191,"78.gif"],[1192,"79.gif"],[1193,"80.gif"],[1194,"81.gif"],[1195,"82.gif"],[1196,"83.gif"]] },
  { path: "yellowface", items: [[635,"(17).gif"],[636,"(18).gif"],[637,"(19).gif"],[638,"(20).gif"],[639,"1.gif"],[640,"(21).gif"],[641,"(22).gif"],[642,"(23).gif"],[643,"(24).gif"],[644,"(25).gif"],[645,"(26).gif"],[646,"(27).gif"],[647,"(28).gif"],[648,"(29).gif"],[649,"(30).gif"],[650,"(31).gif"],[651,"(32).gif"],[652,"(33).gif"],[653,"(34).gif"],[654,"(35).gif"],[655,"(36).gif"],[656,"(37).gif"],[657,"(38).gif"],[659,"(7).gif"],[660,"(8).gif"],[661,"(9).gif"],[662,"(10).gif"],[663,"(11).gif"],[664,"(12).gif"],[665,"(13).gif"],[666,"(14).gif"],[667,"(15).gif"],[1197,"(6).gif"],[1198,"(16).gif"]] },
  { path: "yang", items: [[43,"2.gif"],[44,"3.gif"],[45,"5.gif"],[46,"6.gif"],[47,"7.gif"],[49,"9.gif"],[50,"11.gif"],[51,"12.gif"],[52,"13.gif"],[53,"14.gif"],[54,"15.gif"],[55,"16.gif"],[56,"17.gif"],[57,"18.gif"],[58,"19.gif"],[59,"21.gif"],[60,"23.gif"],[61,"24.gif"],[63,"29.gif"],[64,"30.gif"],[65,"31.gif"],[66,"32.gif"],[67,"33.gif"],[68,"35.gif"],[69,"36.gif"],[70,"37.gif"],[72,"45.gif"],[73,"46.gif"],[74,"47.gif"],[75,"48.gif"],[77,"51.gif"],[78,"52.gif"],[79,"53.gif"],[80,"55.gif"],[82,"59.gif"],[83,"65.gif"],[84,"66.gif"],[85,"68.gif"],[86,"69.gif"],[91,"4.gif"],[92,"8.gif"],[93,"10.gif"],[94,"20.gif"],[95,"22.gif"],[96,"25.gif"],[97,"26.gif"],[98,"27.gif"],[99,"28.gif"],[100,"34.gif"],[101,"38.gif"],[102,"39.gif"],[103,"40.gif"],[104,"41.gif"],[105,"42.gif"],[106,"43.gif"],[107,"44.gif"],[108,"49.gif"],[109,"50.gif"],[110,"56.gif"],[111,"57.gif"],[112,"58.gif"],[113,"60.gif"],[114,"61.gif"],[115,"62.gif"],[116,"63.gif"],[117,"64.gif"],[118,"67.gif"],[119,"70.gif"],[286,"201.gif"],[287,"202.gif"],[633,"203.gif"]] },
  { path: "too", items: [[11,"1.gif"],[12,"2.gif"],[13,"3.gif"],[14,"4.gif"],[15,"5.gif"],[16,"6.gif"],[17,"7.gif"],[18,"8.gif"],[19,"9.gif"],[20,"10.gif"],[21,"11.gif"],[22,"12.gif"],[23,"13.gif"],[24,"14.gif"],[25,"15.gif"],[26,"16.gif"],[27,"17.gif"],[28,"18.gif"],[29,"19.gif"],[30,"20.gif"],[31,"21.gif"],[32,"22.gif"],[33,"23.gif"],[34,"24.gif"],[35,"25.gif"],[36,"26.gif"],[37,"27.gif"],[38,"28.gif"],[40,"30.gif"],[87,"29.gif"],[88,"31.gif"],[89,"32.gif"],[90,"33.gif"]] },
  { path: "bzmh", items: [[670,"bamh0.gif"],[671,"bamh10.gif"],[672,"bamh1.gif"],[673,"bamh3.gif"],[674,"bamh8.gif"],[675,"bamh9.gif"],[676,"bzmh002.gif"],[677,"bzmh003.gif"],[678,"bzmh004.gif"],[679,"bzmh005.gif"],[680,"bzmh007.gif"],[681,"bzmh008.gif"],[682,"bzmh010.gif"],[683,"bzmh012.gif"],[684,"bzmh013.gif"],[685,"bzmh017.gif"],[686,"bzmh018.gif"],[687,"bzmh019.gif"],[688,"bzmh020.gif"],[689,"bzmh021.gif"],[690,"bzmh022.gif"],[691,"bzmh023.gif"],[692,"bzmh025.gif"],[693,"bzmh026.gif"],[694,"bzmh027.gif"],[695,"bzmh028.gif"],[696,"bzmh029.gif"],[697,"bzmh032.gif"],[698,"bzmh033.gif"],[699,"bzmh035.gif"],[700,"bzmh037.gif"],[701,"bzmh039.gif"],[702,"bzmh041.gif"],[703,"bzmh042.gif"],[704,"bzmh044.gif"],[705,"bzmh047.gif"],[706,"bzmh048.gif"],[707,"bzmh052.gif"],[708,"bzmh053.gif"],[709,"bzmh057.gif"],[710,"bzmh059.gif"],[711,"bzmh060.gif"],[712,"bzmh062.gif"],[713,"bzmh066.gif"],[714,"bzmh067.gif"],[715,"bzmh069.gif"],[716,"bzmh070.gif"],[717,"bzmh074.gif"],[718,"bzmh075.gif"],[719,"bzmh077.gif"],[720,"bzmh078.gif"],[721,"bzmh079.gif"],[722,"bzmh081.gif"],[723,"bzmh084.gif"],[724,"bzmh085.gif"],[725,"bzmh086.gif"],[726,"bzmh088.gif"],[727,"bzmh091.gif"],[728,"bzmh092.gif"],[729,"bzmh098.gif"],[730,"bzmh00.gif"],[731,"bzmh100.gif"],[732,"bzmh101.gif"],[733,"bzmh105.gif"],[734,"bzmh108.gif"],[735,"bzmh109.gif"],[736,"bzmh110.gif"],[737,"bzmh113.gif"],[738,"bzmh116.gif"],[739,"bzmh117.gif"],[740,"bzmh118.gif"],[741,"bzmh119.gif"],[742,"bzmh120.gif"],[743,"bzmh121.gif"],[744,"bzmh123.gif"],[745,"bzmh125.gif"],[746,"bzmh127.gif"],[747,"bzmh128.gif"],[748,"bzmh129.gif"],[749,"bzmh131.gif"],[750,"bzmh132.gif"],[751,"bzmh133.gif"],[752,"bzmh135.gif"],[753,"bzmh136.gif"],[754,"bzmh138.gif"],[755,"bzmh140.gif"],[756,"bzmh142.gif"],[757,"bzmh144.gif"],[758,"bzmh145.gif"],[759,"bzmh146.gif"],[760,"bzmh147.gif"],[761,"bzmh150.gif"]] },
  { path: "mushroom", items: [[210,"001.gif"],[211,"002.gif"],[212,"003.gif"],[213,"004.gif"],[214,"005.gif"],[215,"006.gif"],[216,"007.gif"],[217,"008.gif"],[218,"009.gif"],[219,"010.gif"],[220,"011.gif"],[221,"012.gif"],[222,"013.gif"],[223,"014.gif"],[224,"015.gif"],[225,"016.gif"],[226,"017.gif"],[227,"018.gif"],[228,"019.gif"],[229,"020.gif"],[230,"021.gif"],[231,"022.gif"],[232,"023.gif"],[233,"024.gif"],[234,"025.gif"],[235,"026.gif"],[236,"027.gif"],[237,"028.gif"],[238,"029.gif"],[239,"030.gif"],[240,"031.gif"],[241,"032.gif"],[242,"033.gif"],[243,"034.gif"],[244,"035.gif"],[245,"036.gif"],[246,"037.gif"],[247,"038.gif"],[248,"039.gif"],[249,"040.gif"],[250,"041.gif"],[251,"042.gif"],[252,"043.gif"],[253,"044.gif"],[254,"045.gif"],[255,"046.gif"],[256,"047.gif"],[257,"048.gif"],[258,"049.gif"],[259,"050.gif"],[260,"051.gif"],[261,"052.gif"],[262,"053.gif"],[263,"054.gif"],[264,"055.gif"],[265,"056.gif"],[266,"057.gif"],[267,"058.gif"],[268,"059.gif"],[269,"060.gif"],[270,"061.gif"],[271,"062.gif"],[272,"063.gif"],[273,"064.gif"],[274,"065.gif"],[275,"066.gif"],[276,"067.gif"],[277,"068.gif"],[278,"069.gif"],[279,"070.gif"],[280,"071.gif"],[281,"072.gif"],[282,"073.gif"],[283,"074.gif"],[284,"075.gif"],[285,"076.gif"]] },
  { path: "tuerkong", items: [[291,"1.gif"],[292,"2.gif"],[293,"3.gif"],[294,"4.gif"],[295,"5.gif"],[296,"6.gif"],[297,"7.gif"],[298,"8.gif"],[299,"9.gif"],[300,"10.gif"],[301,"11.gif"],[302,"12.gif"],[303,"13.gif"],[304,"14.gif"],[305,"15.gif"],[306,"16.gif"],[307,"17.gif"],[308,"18.gif"],[309,"19.gif"],[310,"20.gif"],[311,"21.gif"],[312,"22.gif"],[313,"23.gif"],[314,"24.gif"],[315,"25.gif"],[316,"26.gif"],[317,"27.gif"],[318,"28.gif"],[319,"29.gif"],[320,"30.gif"],[321,"31.gif"],[322,"32.gif"],[323,"33.gif"]] },
  { path: "majiang", items: [[325,"168.jpg.png"],[326,"161.jpg.gif"],[327,"155.jpg.gif"],[328,"182.jpg.gif"],[329,"00.gif"],[330,"01.gif"],[331,"02.gif"],[332,"03.gif"],[333,"04.gif"],[334,"05.gif"],[335,"06.gif"],[336,"07.gif"],[337,"08.gif"],[338,"09.gif"],[339,"10.gif"],[340,"11.gif"],[341,"12.gif"],[342,"13.gif"],[343,"14.gif"],[344,"15.gif"],[345,"16.gif"],[346,"17.gif"],[347,"18.gif"],[348,"19.gif"],[349,"20.gif"],[350,"21.gif"],[351,"22.gif"],[352,"23.gif"],[353,"24.gif"],[354,"25.gif"],[355,"26.gif"],[356,"27.gif"],[357,"28.gif"],[358,"29.gif"],[359,"30.gif"],[360,"31.gif"],[361,"32.gif"],[362,"33.gif"],[363,"34.gif"],[364,"35.gif"],[365,"37.gif"],[366,"38.gif"],[367,"39.gif"],[368,"40.gif"],[369,"41.gif"],[370,"42.gif"],[371,"43.gif"],[372,"44.gif"],[373,"45.gif"],[374,"46.gif"],[375,"47.gif"],[376,"48.gif"],[377,"49.gif"],[378,"50.gif"],[379,"51.gif"],[380,"52.gif"],[381,"53.gif"],[382,"54.gif"],[383,"55.gif"],[384,"56.gif"],[385,"57.gif"],[386,"58.gif"],[387,"59.gif"],[388,"60.gif"],[389,"61.gif"],[390,"66.gif"],[391,"169.jpg.gif"],[392,"74.gif"],[393,"75.gif"],[394,"77.gif"],[395,"79.gif"],[396,"80.gif"],[397,"81.gif"],[398,"82.gif"],[399,"84.gif"],[400,"85.gif"],[401,"86.gif"],[402,"87.gif"],[403,"88.gif"],[404,"89.gif"],[405,"90.gif"],[406,"91.gif"],[407,"92.gif"],[408,"93.gif"],[409,"94.jpg"],[410,"95.gif"],[411,"96.gif"],[412,"97.gif"],[413,"98.gif"],[414,"99.gif"],[415,"156.jpg.gif"],[416,"100.gif"],[417,"101.gif"],[418,"102.jpg"],[419,"103.gif"],[420,"104.gif"],[421,"105.gif"],[422,"106.gif"],[423,"107.gif"],[424,"108.gif"],[425,"109.gif"],[426,"110.gif"],[427,"111.gif"],[428,"112.gif"],[429,"113.gif"],[430,"114.gif"],[431,"115.gif"],[432,"116.gif"],[433,"117.gif"],[434,"118.gif"],[435,"119.gif"],[436,"120.gif"],[437,"121.png"],[438,"122.gif"],[439,"123.gif"],[440,"124.jpg"],[441,"125.gif"],[442,"126.gif"],[443,"127.gif"],[444,"128.gif"],[445,"129.gif"],[446,"130.gif"],[447,"131.gif"],[448,"132.gif"],[449,"133.gif"],[450,"134.gif"],[451,"135.gif"],[452,"136.gif"],[453,"137.gif"],[454,"138.gif"],[455,"139.gif"],[456,"140.gif"],[457,"141.gif"],[458,"142.gif"],[459,"143.gif"],[460,"144.gif"],[461,"145.gif"],[462,"146.gif"],[463,"147.gif"],[464,"148.gif"],[465,"149.gif"],[466,"150.gif"],[467,"151.gif"],[468,"152.gif"],[469,"153.gif"],[470,"154.gif"],[471,"157.gif"],[472,"158.jpg"],[473,"159.jpg"],[474,"160.gif"],[475,"162.jpg"],[476,"163.gif"],[477,"164.gif"],[478,"165.gif"],[479,"166.gif"],[480,"167.gif"],[481,"170.gif"],[482,"171.gif"],[483,"172.gif"],[484,"173.gif"],[485,"174.gif"],[486,"175.gif"],[487,"176.gif"],[488,"177.gif"],[489,"178.gif"],[490,"179.gif"],[491,"180.gif"],[492,"181.gif"],[493,"183.gif"],[494,"184.gif"],[495,"185.gif"],[496,"186.gif"],[497,"187.gif"],[498,"188.gif"],[499,"189.gif"],[500,"190.gif"],[501,"191.gif"],[502,"200.gif"],[503,"201.gif"]] },
  { path: "lu", items: [[763,"01.gif"],[764,"02.gif"],[765,"03.gif"],[766,"04.gif"],[767,"05.gif"],[768,"06.gif"],[769,"07.gif"],[770,"08.gif"],[771,"09.gif"],[772,"10.gif"],[773,"11.gif"],[774,"12.gif"],[775,"13.gif"],[776,"14.gif"],[777,"15.gif"],[778,"16.gif"],[779,"17.gif"]] },
  { path: "default", items: [[1,"1.gif"],[2,"2.gif"],[3,"3.gif"],[4,"4.gif"],[5,"5.gif"],[6,"6.gif"],[7,"7.gif"],[8,"8.gif"],[9,"9.gif"],[10,"10.gif"],[11,"11.gif"],[12,"12.gif"],[13,"13.gif"],[14,"14.gif"],[15,"15.gif"],[16,"16.gif"],[17,"17.gif"],[18,"18.gif"],[19,"19.gif"],[20,"20.gif"],[21,"21.gif"],[22,"22.gif"],[23,"23.gif"],[24,"24.gif"],[25,"25.gif"],[26,"26.gif"],[27,"27.gif"],[28,"28.gif"],[29,"29.gif"],[30,"30.gif"],[31,"31.gif"],[32,"32.gif"],[33,"33.gif"],[34,"34.gif"],[35,"35.gif"],[36,"36.gif"],[37,"37.gif"],[38,"38.gif"],[39,"39.gif"],[40,"40.gif"],[41,"41.gif"],[42,"42.gif"],[43,"43.gif"],[44,"44.gif"],[45,"45.gif"],[46,"46.gif"],[47,"47.gif"],[48,"48.gif"],[49,"49.gif"],[50,"50.gif"],[51,"51.gif"],[52,"52.gif"],[53,"53.gif"],[54,"54.gif"],[55,"55.gif"],[56,"56.gif"],[57,"57.gif"],[58,"58.gif"],[59,"59.gif"],[60,"60.gif"],[61,"61.gif"],[62,"62.gif"],[63,"63.gif"],[64,"64.gif"],[65,"65.gif"],[66,"66.gif"],[67,"67.gif"],[68,"68.gif"],[69,"69.gif"],[70,"70.gif"],[71,"71.gif"],[72,"72.gif"],[73,"73.gif"],[74,"74.gif"],[75,"75.gif"],[76,"76.gif"],[77,"77.gif"],[78,"78.gif"],[79,"79.gif"],[80,"80.gif"]] }
];

// 构建表情ID到URL的映射
const EMOJI_MAP = {};
for (const pack of EMOJI_PACKS) {
  for (const [id, filename] of pack.items) {
    EMOJI_MAP[id] = { path: pack.path, filename };
  }
}

// 渲染帖子内容，处理各种标签
function renderContent(content, attachMap) {
  const BBS_BASE = 'https://bbs.uestc.edu.cn';

  let html = content
    // 转义 HTML
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 处理 [attach]xxx[/attach] 标签
  html = html.replace(/\[attach\](\d+)\[\/attach\]/g, (match, attachId) => {
    const att = attachMap[attachId];
    if (att && att.is_image) {
      const thumbUrl = att.thumbnail_url ? BBS_BASE + att.thumbnail_url : null;
      const rawUrl = att.raw_url ? BBS_BASE + att.raw_url : null;
      const imgSrc = thumbUrl || rawUrl;
      if (imgSrc) {
        return `<a href="${rawUrl || imgSrc}" target="_blank"><img src="${imgSrc}" alt="附件图片" loading="lazy"></a>`;
      }
    }
    // 非图片附件或未找到
    return `<span class="attachment-placeholder">[附件 ${attachId}]</span>`;
  });

  // 处理 Markdown 风格的图片引用 ![name](i:xxx)
  html = html.replace(/!\[([^\]]*)\]\(i:(\d+)\)/g, (match, altText, attachId) => {
    const att = attachMap[attachId];
    if (att && att.is_image) {
      const thumbUrl = att.thumbnail_url ? BBS_BASE + att.thumbnail_url : null;
      const rawUrl = att.raw_url ? BBS_BASE + att.raw_url : null;
      const imgSrc = thumbUrl || rawUrl;
      if (imgSrc) {
        return `<a href="${rawUrl || imgSrc}" target="_blank"><img src="${imgSrc}" alt="${altText || '图片'}" loading="lazy"></a>`;
      }
    }
    return `<span class="attachment-placeholder">[图片 ${attachId}]</span>`;
  });

  // 处理表情 [a:xxx] - 阿鲁表情 (codePrefix: "a")
  html = html.replace(/\[a:(\d+)\]/g, (match, emojiId) => {
    const emoji = EMOJI_MAP[emojiId];
    if (emoji) {
      return `<img src="${BBS_BASE}/static/image/smiley/${emoji.path}/${emoji.filename}" alt="表情" class="emoji">`;
    }
    // 回退：假设是 alu 包，文件名可能是 ID.gif
    return `<img src="${BBS_BASE}/static/image/smiley/alu/${emojiId}.gif" alt="表情" class="emoji">`;
  });

  // 处理表情 ![num](s) - 默认表情
  html = html.replace(/!\[(\d+)\]\(s\)/g, (match, emojiId) => {
    const emoji = EMOJI_MAP[emojiId];
    if (emoji) {
      return `<img src="${BBS_BASE}/static/image/smiley/${emoji.path}/${emoji.filename}" alt="表情" class="emoji">`;
    }
    return `<img src="${BBS_BASE}/static/image/smiley/default/${emojiId}.gif" alt="表情" class="emoji">`;
  });

  // 处理 [quote] 标签
  html = html.replace(/\[quote\]/g, '<blockquote>').replace(/\[\/quote\]/g, '</blockquote>');

  // 处理换行
  html = html.replace(/\n/g, '<br>');

  // 处理链接 [链接文字](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 处理普通 URL（未被处理过的）
  html = html.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

  return html;
}

// 保留独立页面 (用于直接访问 /thread/:id)
export async function renderThread(env, threadId) {
  const queryDB = async () => {
    const tPromise = env.DB.prepare("SELECT * FROM threads WHERE thread_id = ?").bind(threadId).first();
    const cPromise = env.DB.prepare("SELECT * FROM comments WHERE thread_id = ? ORDER BY position ASC").bind(threadId).all();
    const [t, cData] = await Promise.all([tPromise, cPromise]);
    return {
      thread: t,
      comments: cData.results || []
    };
  };

  let { thread, comments } = await queryDB();

  if (thread) {
    try {
      await checkAndUpdateThread(env, threadId, console.log);
      const newData = await queryDB();
      thread = newData.thread;
      comments = newData.comments;
    } catch (e) {
      console.error(`[CheckUpdate] 检查更新失败: ${e.message}`);
    }
  } else {
    console.log(`[LazyLoad] 本地未找到帖子 ${threadId}，正在尝试回源抓取...`);
    try {
      await processThread(env, threadId, console.log);
      const newData = await queryDB();
      thread = newData.thread;
      comments = newData.comments;
    } catch (e) {
      console.error(`[LazyLoad] 抓取失败: ${e.message}`);
    }
  }

  if (!thread) {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>帖子不存在</title></head>
      <body style="text-align: center; padding: 50px; font-family: -apple-system, sans-serif; color: #666; background-color: #f5f7fa;">
        <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 500px; margin: 0 auto;">
          <h1 style="color: #333; margin-top: 0;">404 Not Found</h1>
          <p style="font-size: 1.1em; line-height: 1.6;">
            数据库和源站中均未找到 ID 为 <strong>${threadId}</strong> 的帖子。<br>
            <span style="font-size: 0.9em; color: #999;">(可能已被删除或权限不足)</span>
          </p>
          <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0070f3; color: white; text-decoration: none; border-radius: 6px;">返回首页</a>
        </div>
      </body>
      </html>
    `, { status: 404, headers: { "content-type": "text/html;charset=utf-8" } });
  }

  // 重定向到首页并打开帖子
  return Response.redirect(`/#thread-${threadId}`, 302);
}
