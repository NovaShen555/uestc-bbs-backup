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
      }
      * { box-sizing: border-box; }
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

  // 处理表情 [a:xxx]
  html = html.replace(/\[a:(\d+)\]/g, (match, emojiId) => {
    return `<img src="${BBS_BASE}/static/image/smiley/alu/${emojiId}.gif" alt="表情" class="emoji">`;
  });

  // 处理表情 ![num](s)
  html = html.replace(/!\[(\d+)\]\(s\)/g, (match, emojiId) => {
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
