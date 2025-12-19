import { processThread, checkAndUpdateThread } from './crawler.js';

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
  const lastSyncTime = lastSync?.last_time
    ? new Date(lastSync.last_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '从未同步';

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
        --text-color: #333;
        --meta-color: #999;
        --border-color: #eaeaea;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        margin: 0;
        padding: 20px;
        line-height: 1.6;
      }
      .container { max-width: 900px; margin: 0 auto; }

      .page-header {
        background: #fff; padding: 25px; border-radius: 12px; margin-bottom: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-bottom: 3px solid var(--primary-color);
      }
      .page-header h1 { margin: 0; font-size: 1.8rem; color: #111; }
      .page-header .sync-time { font-size: 0.85rem; color: var(--meta-color); margin-top: 8px; }

      .toolbar {
        background: #fff; padding: 15px 20px; border-radius: 10px; margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
        display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
      }
      .sort-tabs { display: flex; gap: 8px; }
      .sort-tab {
        padding: 8px 16px; border-radius: 6px; text-decoration: none;
        font-size: 0.9rem; font-weight: 500; transition: all 0.2s;
        border: 1px solid var(--border-color); background: #fff; color: var(--text-color);
      }
      .sort-tab:hover { background: #f8f9fa; }
      .sort-tab.active {
        background: var(--primary-color); color: #fff; border-color: var(--primary-color);
      }

      .btn {
        background: var(--primary-color); color: white; border: none;
        padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 0.95rem; font-weight: 500;
      }
      .btn:disabled { background: #ccc; cursor: not-allowed; }
      .btn:hover:not(:disabled) { background: #005bb5; }

      #console-output {
        background: #1e1e1e; color: #4af626; font-family: 'Consolas', 'Monaco', monospace;
        padding: 15px; border-radius: 10px; margin-bottom: 20px;
        height: 200px; overflow-y: auto; white-space: pre-wrap; font-size: 0.9em;
        display: none; border: 1px solid #333;
      }

      .thread-list { display: flex; flex-direction: column; gap: 12px; }
      .thread-card {
        background: #fff; border-radius: 10px; padding: 18px 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
        display: flex; justify-content: space-between; align-items: center;
        transition: box-shadow 0.2s;
      }
      .thread-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }

      .thread-info { flex: 1; min-width: 0; }
      .thread-title {
        font-size: 1.05rem; font-weight: 500; margin-bottom: 6px;
        display: flex; align-items: center; gap: 8px;
      }
      .thread-title a {
        text-decoration: none; color: var(--text-color);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .thread-title a:hover { color: var(--primary-color); }
      .thread-id { font-size: 0.75rem; color: var(--meta-color); font-weight: normal; flex-shrink: 0; }

      .thread-meta { font-size: 0.85rem; color: var(--meta-color); display: flex; gap: 12px; flex-wrap: wrap; }
      .thread-stats {
        text-align: right; font-size: 0.85rem; color: var(--meta-color);
        display: flex; flex-direction: column; gap: 4px; white-space: nowrap;
      }
      .reply-count { font-weight: 600; color: var(--primary-color); }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="page-header">
        <h1>河畔监控台</h1>
        <div class="sync-time">最后同步: ${lastSyncTime}</div>
      </div>

      <div class="toolbar">
        <div class="sort-tabs">
          <a href="/?sort=created" class="sort-tab ${sort === "created" ? "active" : ""}">按发帖时间</a>
          <a href="/?sort=reply" class="sort-tab ${sort === "reply" ? "active" : ""}">按回复时间</a>
        </div>
        <button id="syncBtn" class="btn">手动同步数据</button>
      </div>

      <div id="console-output"></div>

      <div class="thread-list">
        ${results.map(t => {
          const createdTime = new Date(t.created_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          const lastReplyTime = t.last_synced ? new Date(t.last_synced * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : null;
          return `
          <div class="thread-card">
            <div class="thread-info">
              <div class="thread-title">
                <a href="/thread/${t.thread_id}">${t.subject}</a>
                <span class="thread-id">#${t.thread_id}</span>
              </div>
              <div class="thread-meta">
                <span>作者: ${t.author}</span>
                <span>发布于: ${createdTime}</span>
                ${lastReplyTime ? `<span>最新回复: ${lastReplyTime}</span>` : ''}
              </div>
            </div>
            <div class="thread-stats">
              <span class="reply-count">${t.replies} 回复</span>
              <span>${t.views || 0} 浏览</span>
            </div>
          </div>
        `}).join('')}
      </div>
    </div>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('syncBtn').addEventListener('click', () => startSync());
      });

      async function startSync(round = 1) {
        const btn = document.getElementById('syncBtn');
        const output = document.getElementById('console-output');
        const newline = String.fromCharCode(10);

        btn.disabled = true;
        output.style.display = "block";

        if (round === 1) {
          btn.textContent = "正在同步...";
          output.textContent = "> 开始同步..." + newline;
        } else {
          btn.textContent = \`正在同步 (第\${round}轮)...\`;
          output.textContent += newline + \`> ===== 第 \${round} 轮同步 =====\` + newline;
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

          // 检查是否需要继续同步
          if (fullText.includes("[SYNC_MORE]")) {
            shouldContinue = true;
          }
        } catch (err) {
          output.textContent += newline + "错误: " + err.message;
        }

        if (shouldContinue && round < 20) {
          // 短暂延迟后继续下一轮
          output.textContent += newline + "> 检测到还有更多内容，1秒后继续..." + newline;
          await new Promise(r => setTimeout(r, 1000));
          await startSync(round + 1);
        } else {
          btn.disabled = false;
          btn.textContent = "手动同步数据";
          if (round >= 20) {
            output.textContent += newline + "> 已达到最大轮次限制 (20轮)，请稍后再试。";
          } else {
            output.textContent += newline + "> 同步完成！建议刷新页面查看最新数据。";
          }
        }
      }
    </script>
  </body>
  </html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}

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
    // 本地有帖子，检查是否需要更新
    try {
      await checkAndUpdateThread(env, threadId, console.log);
      // 重新查询更新后的数据
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
    const notFoundHtml = `
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
    `;
    return new Response(notFoundHtml, { status: 404, headers: { "content-type": "text/html;charset=utf-8" } });
  }

  const html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${thread.subject} - 河畔备份</title>
    <style>
      :root {
        --primary-color: #0070f3;
        --bg-color: #f5f7fa;
        --text-color: #333;
        --meta-color: #999;
        --border-color: #eaeaea;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        margin: 0;
        padding: 20px;
        line-height: 1.6;
      }
      .container {
        max-width: 900px;
        margin: 0 auto;
      }
      .nav-bar { margin-bottom: 20px; }
      .nav-bar a { text-decoration: none; color: var(--primary-color); font-weight: 500; }
      .thread-header {
        background: #fff; padding: 25px; border-radius: 12px; margin-bottom: 30px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-bottom: 3px solid var(--primary-color);
      }
      .thread-header h1 { margin: 0 0 15px 0; font-size: 1.8rem; color: #111; }
      .thread-info { color: var(--meta-color); font-size: 0.9rem; display: flex; gap: 15px; flex-wrap: wrap; }

      .post-card {
        background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
      }
      .post-card.is-landlord { border-left: 3px solid var(--primary-color); }

      .post-meta {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 15px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); font-size: 0.9rem;
      }
      .author-info { display: flex; align-items: center; gap: 10px; }
      .floor-tag {
        background: #eaf4ff; color: var(--primary-color); padding: 2px 8px;
        border-radius: 4px; font-weight: bold; font-size: 0.85rem;
      }
      .post-time { color: var(--meta-color); }

      .post-content { font-size: 1.05rem; overflow-wrap: break-word; }
      .post-content img { max-width: 100%; height: auto; border-radius: 4px; margin: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      blockquote {
        background: #f8f9fa; border-left: 4px solid #ccc; margin: 15px 0; padding: 12px 16px; color: #555; font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="nav-bar">
        <a href="/">&larr; 返回帖子列表</a>
      </div>

      <div class="thread-header">
        <h1>${thread.subject}</h1>
        <div class="thread-info">
          <span>ID: ${thread.thread_id}</span>
          <span>楼主: <strong>${thread.author}</strong></span>
          <span>回复数: ${thread.replies}</span>
          <span>发布于: ${new Date(thread.created_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
          ${thread.last_synced ? `<span>最后同步: ${new Date(thread.last_synced * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>` : ''}
        </div>
      </div>

      <div class="post-list">
        ${comments.map(c => `
          <div class="post-card ${c.position === 1 ? 'is-landlord' : ''}" id="post-${c.position}">
            <div class="post-meta">
              <div class="author-info">
                <span class="floor-tag">${c.position === 1 ? '楼主' : '#' + c.position}</span>
                <strong style="font-size: 1rem;">${c.author}</strong>
              </div>
              <div class="post-time">
                ${new Date(c.post_date * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                <span style="margin-left: 8px; color: #bbb; font-size: 0.8rem;">#${c.post_id}</span>
              </div>
            </div>
            <div class="post-content">
              ${
                (c.content || "")
                  .replace(/\n/g, '<br>')
                  .replace(/\[quote\]/g, '<blockquote>').replace(/\[\/quote\]/g, '</blockquote>')
              }
            </div>
          </div>
        `).join('')}
      </div>

    </div>
  </body>
  </html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}
