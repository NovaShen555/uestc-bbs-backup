import { handleSchedule } from './crawler.js';
import { renderHome, renderThread, getThreadData } from './views.js';
import stylesCSS from './static/styles.css';
import appJS from './static/app.js';
import defaultAvatar from './static/default_avatar.png';

export default {
  // 定时任务入口
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleSchedule(env, console.log));
  },

  // HTTP 入口
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由: 静态资源
    if (url.pathname === "/static/styles.css") {
      return new Response(stylesCSS, { headers: { "content-type": "text/css;charset=utf-8" } });
    }
    if (url.pathname === "/static/app.js") {
      return new Response(appJS, { headers: { "content-type": "application/javascript;charset=utf-8" } });
    }
    if (url.pathname === "/static/default_avatar.png") {
      return new Response(defaultAvatar, { headers: { "content-type": "image/png" } });
    }

    // 路由: 首页
    if (url.pathname === "/") {
      const sort = url.searchParams.get("sort") || "created";
      return await renderHome(env, sort);
    }

    // 路由: 帖子详情
    if (url.pathname.startsWith("/thread/")) {
      const threadId = url.pathname.split("/")[2];
      return await renderThread(env, threadId);
    }

    // 路由: API 获取帖子数据 (JSON)
    if (url.pathname.startsWith("/api/thread/")) {
      const threadId = url.pathname.split("/")[3];
      return await getThreadData(env, threadId);
    }

    // 路由: API 加载更多帖子
    if (url.pathname === "/api/threads") {
      const sort = url.searchParams.get("sort") || "created";
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const limit = parseInt(url.searchParams.get("limit") || "30");

      const orderBy = sort === "reply" ? "last_synced DESC" : "created_at DESC";
      const { results } = await env.DB.prepare(
        `SELECT * FROM threads ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();

      return new Response(JSON.stringify({ threads: results }), {
        headers: { "content-type": "application/json;charset=utf-8" }
      });
    }

    // 路由: API 搜索摘要
    if (url.pathname === "/api/search/summary") {
      const query = url.searchParams.get("q");
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing query parameter" }), {
          status: 400,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }

      try {
        const resp = await fetch(`https://bbs.uestc.edu.cn/_/search/summary?q=${encodeURIComponent(query)}`, {
          headers: {
            "authorization": env.BBS_AUTH,
            "Cookie": env.BBS_COOKIE
          }
        });

        const data = await resp.json();
        return new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }
    }

    // 路由: API 搜索帖子
    if (url.pathname === "/api/search/threads") {
      const query = url.searchParams.get("q");
      const page = url.searchParams.get("page") || "1";
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing query parameter" }), {
          status: 400,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }

      try {
        const resp = await fetch(`https://bbs.uestc.edu.cn/_/search/threads?q=${encodeURIComponent(query)}&page=${page}`, {
          headers: {
            "authorization": env.BBS_AUTH,
            "Cookie": env.BBS_COOKIE
          }
        });

        const data = await resp.json();
        return new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }
    }

    // 路由: API 获取外部链接标题
    if (url.pathname === "/api/fetch-title") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Missing url parameter" }), {
          status: 400,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }

      try {
        const resp = await fetch(targetUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cf: { cacheTtl: 3600 }
        });

        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to fetch" }), {
            status: resp.status,
            headers: { "content-type": "application/json;charset=utf-8" }
          });
        }

        const html = await resp.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;

        return new Response(JSON.stringify({ title }), {
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json;charset=utf-8" }
        });
      }
    }

    // 路由: 手动触发同步 (流式输出日志)
    if (url.pathname === "/sync") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const streamLog = async (msg) => {
        const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
        console.log(text);
        await writer.write(encoder.encode(text + "\n"));
      };

      ctx.waitUntil(
        handleSchedule(env, streamLog)
          .then((result) => {
            if (result?.hasMore) {
              writer.write(encoder.encode("[SYNC_MORE] 还有更多内容待同步...\n"));
            } else {
              writer.write(encoder.encode("[SYNC_DONE] 同步任务全部完成！\n"));
            }
          })
          .catch((err) => writer.write(encoder.encode(`[SYNC_ERROR] 发生错误: ${err}\n`)))
          .finally(() => writer.close())
      );

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
