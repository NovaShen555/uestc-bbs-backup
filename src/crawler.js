const HEADERS = (env) => ({
  "authorization": env.BBS_AUTH,
  "Cookie": env.BBS_COOKIE,
});

export async function handleSchedule(env, log = console.log) {
  await log("🚀 开始执行同步任务...");
  await log("authorization: " + env.BBS_AUTH);
  await log("Cookie: " + env.BBS_COOKIE);

  const topListUrl = "https://bbs.uestc.edu.cn/_/forum/toplist?idlist=newthread&page=1";
  await log(`正在请求 Toplist: ${topListUrl}`);

  const listResp = await fetch(topListUrl, { headers: HEADERS(env) });
  if (!listResp.ok) return log(`❌ Toplist 请求失败: ${listResp.status}`);

  const listData = await listResp.json();
  const threads = listData.data.newthread || [];

  if (threads.length === 0) return log("⚠️ 没有发现新帖子");

  await log(`📊 获取到 ${threads.length} 个新帖，开始并发获取详情...`);

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

export async function processThread(env, threadId, log) {
  const detailUrl = `https://bbs.uestc.edu.cn/_/post/list?thread_id=${threadId}&page=1&thread_details=1&forum_details=1`;
  const resp = await fetch(detailUrl, { headers: HEADERS(env) });

  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 403) {
      await log(`⚠️ [${threadId}] 无法访问 (Status: ${resp.status})，跳过。`);
      return;
    }
    throw new Error(`API 请求失败: ${resp.status}`);
  }

  const json = await resp.json();

  if (!json || !json.data) {
    await log(`⚠️ [${threadId}] 返回数据格式异常，跳过。`);
    return;
  }

  const threadInfo = json.data.thread;
  const comments = json.data.rows;

  if (!threadInfo || !comments) {
    await log(`⚠️ [${threadId}] 数据不完整 (无 thread 或 rows)，跳过。`);
    return;
  }

  const stmts = [];

  stmts.push(env.DB.prepare(`
    INSERT INTO threads (thread_id, subject, author, views, replies, created_at, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      views=excluded.views,
      replies=excluded.replies,
      last_synced=excluded.last_synced
  `).bind(
    threadInfo.thread_id,
    threadInfo.subject ?? "无标题",
    threadInfo.author ?? "未知用户",
    threadInfo.views ?? 0,
    threadInfo.replies ?? 0,
    threadInfo.dateline ?? 0,
    Math.floor(Date.now() / 1000)
  ));

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
      row.message ?? "",
      row.dateline ?? 0,
      row.is_first ?? 0,
      JSON.stringify(row)
    ));
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
    const safeSubject = (threadInfo.subject ?? "").substring(0, 15);
    await log(`✅ [${threadId}] 同步成功 - 标题: ${safeSubject}... (共${comments.length}楼)`);
  }
}
