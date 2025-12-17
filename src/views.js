import { processThread, checkAndUpdateThread } from './crawler.js';

export async function renderHome(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM threads ORDER BY thread_id DESC LIMIT 30"
  ).all();

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>河畔监控台</title>
    <style>
      body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
      .toolbar { background: #f0f0f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
      button { background: #0070f3; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 1rem; }
      button:disabled { background: #ccc; cursor: not-allowed; }
      button:hover:not(:disabled) { background: #005bb5; }
      #console-output {
        background: #1e1e1e; color: #4af626; font-family: 'Consolas', 'Monaco', monospace;
        padding: 15px; border-radius: 8px; margin-bottom: 20px;
        height: 200px; overflow-y: auto; white-space: pre-wrap; font-size: 0.9em;
        display: none;
      }
      .thread-list { border: 1px solid #eee; border-radius: 8px; }
      .thread-item { padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
      .thread-item:last-child { border-bottom: none; }
      .meta { font-size: 0.8em; color: #666; margin-top: 4px; }
      a { text-decoration: none; color: #0066cc; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <h2>🔥 河畔监控台</h2>
      <button id="syncBtn">手动同步数据</button>
    </div>

    <div id="console-output"></div>

    <div class="thread-list">
      ${results.map(t => `
        <div class="thread-item">
          <div>
            <div><a href="/thread/${t.thread_id}">${t.subject}</a></div>
            <div class="meta">
              作者: ${t.author} • ${new Date(t.created_at * 1000).toLocaleString()}
            </div>
          </div>
          <div class="meta">
             回复: ${t.replies}
          </div>
        </div>
      `).join('')}
    </div>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
          document.getElementById('syncBtn').addEventListener('click', startSync);
      });

      async function startSync() {
        const btn = document.getElementById('syncBtn');
        const output = document.getElementById('console-output');

        btn.disabled = true;
        btn.textContent = "正在同步...";
        output.style.display = "block";

        const newline = String.fromCharCode(10);
        output.textContent = "> 正在连接 Worker 实例..." + newline;

        try {
          const response = await fetch('/sync');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            output.textContent += text;
            output.scrollTop = output.scrollHeight;
          }
        } catch (err) {
          output.textContent += newline + "❌ 连接发生错误: " + err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = "手动同步数据";
          output.textContent += newline + "> 任务结束。建议刷新页面查看最新数据。";
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
          <span>发布于: ${new Date(thread.created_at * 1000).toLocaleString('zh-CN')}</span>
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
                ${new Date(c.post_date * 1000).toLocaleString('zh-CN')}
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
