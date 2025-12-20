const HEADERS = (env) => ({
  "authorization": env.BBS_AUTH,
  "Cookie": env.BBS_COOKIE,
});

// Cloudflare Workers 每个请求最多 50 个 subrequests，需要限制并发
const MAX_CONCURRENT = 5;
const MAX_PAGES_PER_UPDATE = 3;

// 批次处理帮助函数
async function processBatch(items, batchSize, handler) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(handler));
  }
}

export async function handleSchedule(env, log = console.log) {
  await log("开始执行同步任务...");

  // 获取数据库中最新的帖子ID
  const latest = await env.DB.prepare("SELECT MAX(thread_id) as max_id FROM threads").first();
  const latestId = latest?.max_id || 0;
  await log(`数据库最新帖子ID: ${latestId}`);

  let page = 1;
  let allThreads = [];
  let foundExisting = false;
  let hasMoreNewThreads = false;
  let apiLatestId = 0;

  // 翻页获取，直到找到已有帖子（限制最多3页，避免请求过多）
  while (!foundExisting && page <= 3) {
    const topListUrl = `https://bbs.uestc.edu.cn/_/forum/toplist?idlist=newthread&page=${page}`;
    await log(`正在请求 Toplist 第${page}页...`);

    const listResp = await fetch(topListUrl, { headers: HEADERS(env) });
    if (!listResp.ok) {
      await log(`Toplist 请求失败: ${listResp.status}`);
      break;
    }

    const listData = await listResp.json();
    const threads = listData.data.newthread || [];

    if (threads.length === 0) {
      await log("没有更多帖子了");
      break;
    }

    if (page === 1 && threads.length > 0) {
      apiLatestId = threads[0].thread_id;
    }

    for (const t of threads) {
      if (t.thread_id <= latestId) {
        foundExisting = true;
        break;
      }
      allThreads.push(t);
    }

    page++;
  }

  let processedNewThreads = 0;
  if (allThreads.length === 0) {
    await log("没有发现新帖子");
  } else {
    // 限制最多处理 15 个新帖
    const toProcess = allThreads.slice(0, 15);
    hasMoreNewThreads = allThreads.length > 15;
    await log(`共发现 ${allThreads.length} 个新帖，本次处理 ${toProcess.length} 个...`);

    // 批次处理，每批 MAX_CONCURRENT 个
    await processBatch(toProcess, MAX_CONCURRENT, async (t) => {
      try {
        await processThread(env, t.thread_id, log);
        processedNewThreads++;
      } catch (e) {
        await log(`处理帖子 ${t.thread_id} 失败: ${e.message}`);
      }
    });

    await log("新帖同步完成。");
  }

  // 回填检查：从最新ID往回检查100个，确保没有遗漏
  if (apiLatestId > 0) {
    await backfillCheck(env, apiLatestId, log);
  }

  // 同步新回复
  const { hasMoreReplies, updatedCount } = await syncNewReplies(env, log);

  const hasMore = hasMoreNewThreads || hasMoreReplies;
  await log("所有同步任务结束。");

  return { hasMore, processedNewThreads, updatedReplies: updatedCount };
}

async function backfillCheck(env, apiLatestId, log) {
  await log("开始回填检查...");
  const checkStart = Math.max(1, apiLatestId - 100);

  for (let id = apiLatestId; id >= checkStart; id--) {
    const exists = await env.DB.prepare("SELECT 1 FROM threads WHERE thread_id = ?").bind(id).first();
    if (exists) continue;

    const missing = await env.DB.prepare("SELECT 1 FROM missing_threads WHERE thread_id = ?").bind(id).first();
    if (missing) continue;

    try {
      await processThread(env, id, log);
    } catch (e) {
      await log(`回填检查 ${id} 失败: ${e.message}`);
    }
  }

  await log("回填检查完成。");
}

async function syncNewReplies(env, log) {
  await log("开始同步新回复...");

  let page = 1;
  let totalUpdated = 0;
  let foundEmptyPage = false;  // 是否找到一整页都不需要更新

  // 翻页检查，直到找到一整页都不需要更新
  while (page <= 3) {
    const url = `https://bbs.uestc.edu.cn/_/forum/toplist?idlist=newreply&page=${page}`;
    await log(`正在请求 newreply 第${page}页...`);

    const resp = await fetch(url, { headers: HEADERS(env) });
    if (!resp.ok) {
      await log(`newreply 请求失败: ${resp.status}`);
      break;
    }

    const data = await resp.json();
    const threads = data.data.newreply || [];
    if (threads.length === 0) {
      foundEmptyPage = true;
      break;
    }

    let pageNeedUpdate = 0;  // 这一页需要更新的数量

    for (const t of threads) {
      const dbThread = await env.DB.prepare("SELECT replies FROM threads WHERE thread_id = ?").bind(t.thread_id).first();
      const dbReplies = dbThread?.replies ?? -1;

      if (t.replies > dbReplies) {
        pageNeedUpdate++;

        // 达到本次更新限制，跳过执行但继续计数
        if (totalUpdated >= 8) {
          continue;
        }

        if (dbReplies < 0) {
          await processThread(env, t.thread_id, log);
        } else {
          await updateThreadComments(env, t.thread_id, t.replies, dbReplies, log);
        }
        totalUpdated++;
      }
    }

    // 整页无需更新 → 同步完成
    if (pageNeedUpdate === 0) {
      await log("整页无需更新，同步完成");
      foundEmptyPage = true;
      break;
    }

    page++;
  }

  await log(`回复同步完成，共更新 ${totalUpdated} 个帖子`);

  // 没找到空页 = 还有更多需要同步
  return { hasMoreReplies: !foundEmptyPage, updatedCount: totalUpdated };
}

/**
 * 检查帖子是否有更新（回复数是否一致），如有则增量更新
 */
export async function checkAndUpdateThread(env, threadId, log = console.log) {
  // 获取数据库中的回复数
  const dbThread = await env.DB.prepare("SELECT replies FROM threads WHERE thread_id = ?").bind(threadId).first();
  const dbReplies = dbThread?.replies ?? -1;

  // 如果帖子不存在，直接完整抓取
  if (dbReplies < 0) {
    await processThread(env, threadId, log);
    return;
  }

  // 调用 API 获取最新回复数
  const detailUrl = `https://bbs.uestc.edu.cn/_/post/list?thread_id=${threadId}&page=1&thread_details=1`;
  const resp = await fetch(detailUrl, { headers: HEADERS(env) });
  if (!resp.ok) return;

  const json = await resp.json();
  if (!json?.data?.thread) return;

  const apiReplies = json.data.thread.replies ?? 0;

  // 如果有新回复，增量更新
  if (apiReplies > dbReplies) {
    await log(`[${threadId}] 发现新回复 (${dbReplies} -> ${apiReplies})，正在更新...`);
    await updateThreadComments(env, threadId, apiReplies, dbReplies, log);
  }
}

async function updateThreadComments(env, threadId, apiReplies, dbReplies, log) {
  // 计算需要从哪一页开始抓（每页假设20条）
  const startPage = Math.max(1, Math.floor(dbReplies / 20));

  let allNewComments = [];
  let page = startPage;

  // 限制最多抓取 MAX_PAGES_PER_UPDATE 页，避免请求过多
  while (page <= startPage + MAX_PAGES_PER_UPDATE) {
    const url = `https://bbs.uestc.edu.cn/_/post/list?thread_id=${threadId}&page=${page}&thread_details=1`;
    const resp = await fetch(url, { headers: HEADERS(env) });
    if (!resp.ok) break;

    const json = await resp.json();
    if (!json?.data?.rows) break;

    const rows = json.data.rows;
    if (rows.length === 0) break;

    // 只保留 position > dbReplies 的新评论
    for (const row of rows) {
      if ((row.position ?? 0) > dbReplies) {
        allNewComments.push(row);
      }
    }

    // 如果这页不满，说明到底了
    if (rows.length < 20) break;
    page++;
  }

  if (allNewComments.length === 0) return;

  const stmts = allNewComments.map(row =>
    env.DB.prepare(`
      INSERT INTO comments (post_id, thread_id, position, author, content, post_date, is_first, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET content=excluded.content, raw_json=excluded.raw_json
    `).bind(
      row.post_id, threadId, row.position ?? 0, row.author ?? "未知用户",
      row.message ?? "", row.dateline ?? 0, row.is_first ?? 0, JSON.stringify(row)
    )
  );

  // 更新帖子的 replies 数为 API 返回的值
  stmts.push(env.DB.prepare("UPDATE threads SET replies = ?, last_synced = ? WHERE thread_id = ?")
    .bind(apiReplies, Math.floor(Date.now() / 1000), threadId));

  await env.DB.batch(stmts);
  await log(`[${threadId}] 新增 ${allNewComments.length} 条评论`);
}

export async function processThread(env, threadId, log) {
  const detailUrl = `https://bbs.uestc.edu.cn/_/post/list?thread_id=${threadId}&page=1&thread_details=1&forum_details=1`;
  const resp = await fetch(detailUrl, { headers: HEADERS(env) });

  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 403) {
      await log(`[${threadId}] 无法访问 (Status: ${resp.status})，记录为不存在。`);
      await env.DB.prepare("INSERT OR IGNORE INTO missing_threads (thread_id, checked_at) VALUES (?, ?)").bind(threadId, Math.floor(Date.now() / 1000)).run();
      return;
    }
    throw new Error(`API 请求失败: ${resp.status}`);
  }

  const json = await resp.json();

  if (!json || !json.data) {
    await log(`[${threadId}] 返回数据格式异常，跳过。`);
    return;
  }

  const threadInfo = json.data.thread;
  const comments = json.data.rows;

  if (!threadInfo || !comments) {
    await log(`[${threadId}] 数据不完整 (无 thread 或 rows)，跳过。`);
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
    await log(`[${threadId}] 同步成功 - 标题: ${safeSubject}... (共${comments.length}楼)`);
  }
}
