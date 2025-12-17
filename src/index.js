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
  "accept": "application/json",
  "authorization": env.BBS_AUTH,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
});

// 注意：这里多了一个 log 参数
async function handleSchedule(env, log = console.log) {
  await log("🚀 开始执行同步任务...");
  
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
  if (!resp.ok) return;

  const json = await resp.json();
  const threadInfo = json.data.thread;
  const comments = json.data.rows;

  if (!threadInfo || !comments) return;

  const stmts = [];

  // A. 帖子主表
  stmts.push(env.DB.prepare(`
    INSERT INTO threads (thread_id, subject, author, views, replies, created_at, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      views=excluded.views,
      replies=excluded.replies,
      last_synced=excluded.last_synced
  `).bind(
    threadInfo.thread_id,
    threadInfo.subject,
    threadInfo.author,
    threadInfo.views,
    threadInfo.replies,
    threadInfo.dateline,
    Math.floor(Date.now() / 1000)
  ));

  // B. 楼层表
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
      row.position,
      row.author,
      row.message,
      row.dateline,
      row.is_first,
      JSON.stringify(row)
    ));
  }

  // C. 写入数据库
  await env.DB.batch(stmts);
  await log(`✅ [${threadId}] 同步成功 - 标题: ${threadInfo.subject.substring(0, 15)}... (共${comments.length}楼)`);
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