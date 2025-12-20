let currentThreadId = null;

// 生成头像URL
function getAvatarUrl(authorId) {
  if (!authorId) return '';
  const id = String(authorId).padStart(6, '0');
  const path = `000/${id.slice(0, 2)}/${id.slice(2, 4)}/${id.slice(4, 6)}`;
  return `https://bbs.uestc.edu.cn/uc_server/data/avatar/${path}_avatar_middle.jpg`;
}

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
  const activeCard = document.querySelector(`.thread-card[data-id="${threadId}"]`);
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
      contentInner.innerHTML = `
        <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>
        <div class="error-message">${data.error}</div>
      `;
      return;
    }

    renderThread(data);
  } catch (err) {
    contentInner.innerHTML = `
      <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>
      <div class="error-message">加载失败: ${err.message}</div>
    `;
  }
}

function renderThread(data) {
  const { thread, comments } = data;
  const contentInner = document.getElementById('contentInner');

  const html = `
    <button class="btn back-btn" onclick="closeThread()">← 返回列表</button>

    <div class="thread-header">
      <h1>${thread.subject}</h1>
      <div class="thread-info">
        <span>ID: ${thread.thread_id}</span>
        <span>楼主: <strong>${thread.author}</strong></span>
        <span>回复: ${thread.replies}</span>
        <span>发布: ${thread.created_at_fmt}</span>
        ${thread.last_synced_fmt ? `<span>同步: ${thread.last_synced_fmt}</span>` : ''}
      </div>
    </div>

    <div class="post-list">
      ${comments.map(c => `
        <div class="post-card ${c.position === 1 ? 'is-landlord' : ''}" data-post-id="${c.post_id}">
          <div class="post-meta">
            <div class="author-info">
              <img src="${getAvatarUrl(c.author_id)}" alt="${c.author}" class="avatar" onerror="this.style.display='none'">
              <span class="floor-tag">${c.position === 1 ? '楼主' : '#' + c.position}</span>
              <strong>${c.author}</strong>
            </div>
            <div class="post-time">
              ${c.post_date_fmt}
              <span class="post-id">#${c.post_id}</span>
            </div>
          </div>
          <div class="post-content">${c.content_html}</div>
        </div>
      `).join('')}
    </div>
  `;

  contentInner.innerHTML = html;
  contentInner.scrollTop = 0;
  document.getElementById('mainContent').scrollTop = 0;

  // 动态获取链接标题
  fetchLinkTitles();
}

async function fetchLinkTitles() {
  const links = document.querySelectorAll('.dynamic-link');
  for (const link of links) {
    const threadId = link.dataset.threadId;
    const url = link.dataset.url;

    if (threadId) {
      // 内部 BBS 链接，从数据库获取
      try {
        const resp = await fetch(`/api/thread/${threadId}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.thread && data.thread.subject) {
            link.textContent = data.thread.subject;
          }
        }
      } catch (e) {}
    } else if (url) {
      // 外部链接，通过 API 获取标题
      try {
        const resp = await fetch(`/api/fetch-title?url=${encodeURIComponent(url)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.title) {
            link.textContent = data.title;
          }
        }
      } catch (e) {}
    }
  }
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

function jumpToPost(postId) {
  const postCard = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (postCard) {
    postCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    postCard.style.backgroundColor = 'var(--active-bg)';
    setTimeout(() => {
      postCard.style.backgroundColor = '';
    }, 2000);
  }
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
    btn.textContent = `同步 (${round})...`;
    output.textContent += nl + `> ===== 第 ${round} 轮 =====` + nl;
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
