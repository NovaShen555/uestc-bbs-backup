import { handleSchedule } from './crawler.js';
import { renderHome, renderThread } from './views.js';

export default {
  // 定时任务入口
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleSchedule(env, console.log));
  },

  // HTTP 入口
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
          .then(() => writer.write(encoder.encode("✅ 同步任务全部完成！\n")))
          .catch((err) => writer.write(encoder.encode(`❌ 发生错误: ${err}\n`)))
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
