export default {
  // 1. 定时任务入口 (自动触发)
  async scheduled(event, env, ctx) {
    // 定时任务只打印到后台日志，不需要流式输出
    ctx.waitUntil(handleSchedule(env, console.log));
  },

  // 2. HTTP 入口 (网页访问)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由: 首页
    if (url.pathname === "/") {
      return await renderHome(env);
    }
    
    // 路由: 帖子详情
    if (url.pathname.startsWith("/thread/")) {
      const threadId = url.pathname.split("/")[2];
      return await renderThread(env, threadId);
    }

    // 路由: 手动触发同步 (流式输出日志)
    if (url.pathname === "/sync") {
      // 创建一个文本流
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 创建一个自定义的 log 函数，既打印到后台，也发给前端
      const streamLog = async (msg) => {
        const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
        console.log(text); // 打印到 Cloudflare 后台
        await writer.write(encoder.encode(text + "\n")); // 发送给前端
      };

      // 异步执行任务，任务结束后关闭流
      // 注意：这里不要 await handleSchedule，否则会阻塞响应头发送
      // 我们需要立即返回 Response，然后在后台推数据
      ctx.waitUntil(
        handleSchedule(env, streamLog)
          .then(() => writer.write(encoder.encode("✅ 同步任务全部完成！\n")))
          .catch((err) => writer.write(encoder.encode(`❌ 发生错误: ${err}\n`)))
          .finally(() => writer.close())
      );

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "X-Content-Type-Options": "nosniff" // 防止浏览器缓冲
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ==========================================
// 核心逻辑：爬虫与入库
// ==========================================

const HEADERS = (env) => ({
  "authorization": env.BBS_AUTH,
  "Cookie": env.BBS_COOKIE,
});

// 注意：这里多了一个 log 参数
async function handleSchedule(env, log = console.log) {
  await log("🚀 开始执行同步任务...");
  await log("authorization: " + env.BBS_AUTH);
  await log("Cookie: " + env.BBS_COOKIE);
  
  // 1. 获取最新帖子列表
  const topListUrl = "https://bbs.uestc.edu.cn/_/forum/toplist?idlist=newthread&page=1";
  await log(`正在请求 Toplist: ${topListUrl}`);
  
  const listResp = await fetch(topListUrl, { headers: HEADERS(env) });
  if (!listResp.ok) return log(`❌ Toplist 请求失败: ${listResp.status}`);
  
  const listData = await listResp.json();
  const threads = listData.data.newthread || [];

  if (threads.length === 0) return log("⚠️ 没有发现新帖子");

  await log(`📊 获取到 ${threads.length} 个新帖，开始并发获取详情...`);

  // 2. 并发处理每个帖子
  // 为了方便看日志，我们稍微改一下逻辑，捕捉每个的进度
  const tasks = threads.map(async (t) => {
    try {
      await processThread(env, t.thread_id, log);
    } catch (e) {
      await log(`❌ 处理帖子 ${t.thread_id} 失败: ${e.message}`);
    }
  });

  await Promise.all(tasks);
  await log("🏁 所有帖子处理流程结束。");
}

async function processThread(env, threadId, log) {
  // 请求帖子详情
  const detailUrl = `https://bbs.uestc.edu.cn/_/post/list?thread_id=${threadId}&page=1&thread_details=1&forum_details=1`;
  const resp = await fetch(detailUrl, { headers: HEADERS(env) });
  
  if (!resp.ok) {
    // 如果是 404 或 403，说明帖子可能被删或没权限，跳过不报错
    if (resp.status === 404 || resp.status === 403) {
      await log(`⚠️ [${threadId}] 无法访问 (Status: ${resp.status})，跳过。`);
      return;
    }
    throw new Error(`API 请求失败: ${resp.status}`);
  }

  const json = await resp.json();
  
  // 安全检查：防止 data 为 null
  if (!json || !json.data) {
    await log(`⚠️ [${threadId}] 返回数据格式异常，跳过。`);
    return;
  }

  const threadInfo = json.data.thread;
  const comments = json.data.rows;

  // 如果没有帖子信息或楼层信息，跳过
  if (!threadInfo || !comments) {
    await log(`⚠️ [${threadId}] 数据不完整 (无 thread 或 rows)，跳过。`);
    return;
  }

  const stmts = [];

  // ---------------------------------------------------------
  // 关键修改：使用 ?? 运算符给所有字段加默认值
  // undefined ?? null 结果是 null (D1 接受 null)
  // undefined ?? 0 结果是 0
  // undefined ?? "" 结果是 空字符串
  // ---------------------------------------------------------

  // A. 帖子主表 (Threads)
  stmts.push(env.DB.prepare(`
    INSERT INTO threads (thread_id, subject, author, views, replies, created_at, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      views=excluded.views,
      replies=excluded.replies,
      last_synced=excluded.last_synced
  `).bind(
    threadInfo.thread_id,
    threadInfo.subject ?? "无标题",       // 防止标题丢失
    threadInfo.author ?? "未知用户",      // 防止作者丢失 (如匿名)
    threadInfo.views ?? 0,               // 防止 undefined
    threadInfo.replies ?? 0,
    threadInfo.dateline ?? 0,
    Math.floor(Date.now() / 1000)
  ));

  // B. 楼层表 (Comments)
  for (const row of comments) {
    stmts.push(env.DB.prepare(`
      INSERT INTO comments (post_id, thread_id, position, author, content, post_date, is_first, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        content=excluded.content,
        raw_json=excluded.raw_json
    `).bind(
      row.post_id,
      threadInfo.thread_id,
      row.position ?? 0,
      row.author ?? "未知用户",
      row.message ?? "",                 // 关键：防止内容为空导致的报错
      row.dateline ?? 0,
      row.is_first ?? 0,                 // 关键：防止 is_first 缺失
      JSON.stringify(row)
    ));
  }

  // C. 写入数据库
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
    // 截取标题前15个字符用于日志显示
    const safeSubject = (threadInfo.subject ?? "").substring(0, 15);
    await log(`✅ [${threadId}] 同步成功 - 标题: ${safeSubject}... (共${comments.length}楼)`);
  }
}

// ==========================================
// 前端渲染逻辑
// ==========================================

async function renderHome(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM threads ORDER BY last_synced DESC LIMIT 30"
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
      // 使用 DOMContentLoaded 确保页面加载完毕
      document.addEventListener('DOMContentLoaded', () => {
          document.getElementById('syncBtn').addEventListener('click', startSync);
      });

      async function startSync() {
        const btn = document.getElementById('syncBtn');
        const output = document.getElementById('console-output');
        
        btn.disabled = true;
        btn.textContent = "正在同步...";
        output.style.display = "block";
        
        // 这里的换行符处理是关键，使用 String.fromCharCode(10) 避免转义错误
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
            // 追加文本
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


// ==========================================
// 帖子详情页渲染函数 (带自动回源抓取功能)
// ==========================================
async function renderThread(env, threadId) {
  // 定义一个内部函数用于查询数据库，避免代码重复
  const queryDB = async () => {
    const tPromise = env.DB.prepare("SELECT * FROM threads WHERE thread_id = ?").bind(threadId).first();
    const cPromise = env.DB.prepare("SELECT * FROM comments WHERE thread_id = ? ORDER BY position ASC").bind(threadId).all();
    const [t, cData] = await Promise.all([tPromise, cPromise]);
    return { 
      thread: t, 
      comments: cData.results || [] 
    };
  };

  // 1. 第一次尝试：查询本地数据库
  let { thread, comments } = await queryDB();

  // 2. 如果本地没有，尝试“现场抓取”
  if (!thread) {
    console.log(`[LazyLoad] 本地未找到帖子 ${threadId}，正在尝试回源抓取...`);
    try {
      // 调用之前的爬虫逻辑 (processThread)
      // 使用 console.log 作为日志输出，或者你可以传一个空函数 () => {} 保持静默
      await processThread(env, threadId, console.log);
      
      // 3. 抓取完成后，第二次尝试：再次查询数据库
      const newData = await queryDB();
      thread = newData.thread;
      comments = newData.comments;
    } catch (e) {
      console.error(`[LazyLoad] 抓取失败: ${e.message}`);
    }
  }

  // 4. 如果尝试抓取后依然没有数据，说明源站也不存在或无法访问 -> 返回 404
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

  // 5. 构建 HTML (此时 thread 一定存在)
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
      /* 头部导航和标题 */
      .nav-bar { margin-bottom: 20px; }
      .nav-bar a { text-decoration: none; color: var(--primary-color); font-weight: 500; }
      .thread-header {
        background: #fff; padding: 25px; border-radius: 12px; margin-bottom: 30px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-bottom: 3px solid var(--primary-color);
      }
      .thread-header h1 { margin: 0 0 15px 0; font-size: 1.8rem; color: #111; }
      .thread-info { color: var(--meta-color); font-size: 0.9rem; display: flex; gap: 15px; flex-wrap: wrap; }

      /* 楼层列表 */
      .post-card {
        background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid var(--border-color);
      }
      /* 楼主特殊样式 */
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

      /* 内容区域样式优化 */
      .post-content { font-size: 1.05rem; overflow-wrap: break-word; }
      .post-content img { max-width: 100%; height: auto; border-radius: 4px; margin: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      /* 模拟 BBS 引用样式 */
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
