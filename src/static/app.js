let currentThreadId = null;
let currentSort = 'created';
let loadedThreads = 30;
let isLoading = false;
let searchTimeout = null;
let isSearchMode = false;

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
  const urlParams = new URLSearchParams(window.location.search);
  currentSort = urlParams.get('sort') || 'created';

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

  // 搜索功能
  const searchInput = document.getElementById('searchInput');
  const searchDropdown = document.getElementById('searchDropdown');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => fetchSearchSummary(query), 300);
    } else {
      searchDropdown.classList.remove('show');
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (query) {
        performFullSearch(query);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      searchDropdown.classList.remove('show');
    }
  });

  // 无限滚动
  const sidebar = document.querySelector('.sidebar');
  sidebar.addEventListener('scroll', () => {
    if (isLoading) return;
    const { scrollTop, scrollHeight, clientHeight } = sidebar;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      loadMoreThreads();
    }
  });

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

  // 更新页面标题
  document.title = thread.subject + ' - 河畔监控台';

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
              <img src="${getAvatarUrl(c.author_id)}" alt="${c.author}" class="avatar" onerror="this.onerror=null; this.src='/static/default_avatar.png'">
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

  // 恢复原始标题
  document.title = '河畔监控台';
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

async function loadMoreThreads() {
  if (isLoading) return;
  isLoading = true;

  try {
    const resp = await fetch(`/api/threads?sort=${currentSort}&offset=${loadedThreads}&limit=30`);
    const data = await resp.json();

    if (data.threads && data.threads.length > 0) {
      const threadList = document.getElementById('threadList');
      data.threads.forEach(t => {
        const avatarUrl = t.author_id ? getAvatarUrl(t.author_id) : '';
        const card = document.createElement('div');
        card.className = 'thread-card';
        card.dataset.id = t.thread_id;
        card.innerHTML = `
          <div class="thread-title">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="${t.author}" class="thread-avatar" onerror="this.style.display='none'">` : ''}
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
        `;
        threadList.appendChild(card);
      });
      loadedThreads += data.threads.length;
    }
  } catch (e) {
    console.error('加载更多失败:', e);
  } finally {
    isLoading = false;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

async function fetchSearchSummary(query) {
  const dropdown = document.getElementById('searchDropdown');
  try {
    const resp = await fetch(`/api/search/summary?q=${encodeURIComponent(query)}`);
    const data = await resp.json();

    if (data.code === 0 && data.data) {
      renderSearchDropdown(data.data, query);
    }
  } catch (e) {
    console.error('搜索失败:', e);
  }
}

function renderSearchDropdown(data, query) {
  const dropdown = document.getElementById('searchDropdown');
  let html = '';

  if (data.tid_match) {
    html += `<div class="search-section">
      <div class="search-section-title">精确匹配 (帖子ID)</div>
      <div class="search-item" onclick="loadThread(${data.tid_match.thread_id})">
        <div class="search-item-title">${data.tid_match.subject}</div>
        <div class="search-item-meta">作者: ${data.tid_match.author} · ID: ${data.tid_match.thread_id}</div>
      </div>
    </div>`;
  }

  if (data.uid_match) {
    html += `<div class="search-section">
      <div class="search-section-title">精确匹配 (用户ID)</div>
      <div class="search-item">
        <div class="search-item-title">${data.uid_match.username}</div>
        <div class="search-item-meta">UID: ${data.uid_match.uid} · ${data.uid_match.group_title}</div>
      </div>
    </div>`;
  }

  if (data.threads && data.threads.length > 0) {
    html += `<div class="search-section">
      <div class="search-section-title">帖子 (${data.thread_count})</div>`;
    data.threads.slice(0, 5).forEach(t => {
      html += `<div class="search-item" onclick="loadThread(${t.thread_id})">
        <div class="search-item-title">${t.subject}</div>
        <div class="search-item-meta">作者: ${t.author} · ${formatTime(t.dateline)}</div>
      </div>`;
    });
    if (data.thread_count > 5) {
      html += `<div class="search-item" onclick="performFullSearch('${query}')" style="text-align: center; color: var(--primary-color); font-weight: 500;">
        查看全部 ${data.thread_count} 个结果
      </div>`;
    }
    html += `</div>`;
  }

  if (data.users && data.users.length > 0) {
    html += `<div class="search-section">
      <div class="search-section-title">用户 (${data.user_count})</div>`;
    data.users.slice(0, 5).forEach(u => {
      html += `<div class="search-item">
        <div class="search-item-title">${u.username}</div>
        <div class="search-item-meta">UID: ${u.uid} · ${u.group_title}</div>
      </div>`;
    });
    html += `</div>`;
  }

  if (!html) {
    html = '<div class="search-empty">未找到相关结果</div>';
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('show');
}

async function performFullSearch(query) {
  const dropdown = document.getElementById('searchDropdown');
  dropdown.classList.remove('show');

  isSearchMode = true;
  const threadList = document.getElementById('threadList');
  threadList.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const resp = await fetch(`/api/search/threads?q=${encodeURIComponent(query)}&page=1`);
    const data = await resp.json();

    if (data.code === 0 && data.data && data.data.rows) {
      renderSearchResults(data.data.rows, query, data.data.total);
    } else {
      threadList.innerHTML = '<div class="search-empty">未找到相关结果</div>';
    }
  } catch (e) {
    console.error('搜索失败:', e);
    threadList.innerHTML = '<div class="error-message">搜索失败</div>';
  }
}

function renderSearchResults(threads, query, total) {
  const threadList = document.getElementById('threadList');

  let html = `<div style="padding: 12px; background: var(--card-bg); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div style="font-size: 0.9rem; color: var(--text-color);">搜索 "<strong>${query}</strong>" 找到 ${total} 个结果</div>
      <button class="btn btn-sm" onclick="exitSearchMode()">返回列表</button>
    </div>
  </div>`;

  threads.forEach(t => {
    const avatarUrl = t.author_id ? getAvatarUrl(t.author_id) : '';
    html += `<div class="thread-card" data-id="${t.thread_id}">
      <div class="thread-title">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${t.author}" class="thread-avatar" onerror="this.style.display='none'">` : ''}
        <span class="thread-title-text">${t.subject}</span>
        <span class="thread-id">#${t.thread_id}</span>
      </div>
      <div class="thread-meta">
        <span>${t.author}</span>
        <span>${formatTime(t.dateline)}</span>
      </div>
      <div class="thread-stats">
        <span class="reply-count">${t.replies} 回复</span>
        <span> · ${t.views || 0} 浏览</span>
      </div>
    </div>`;
  });

  threadList.innerHTML = html;
}

function exitSearchMode() {
  isSearchMode = false;
  document.getElementById('searchInput').value = '';
  window.location.reload();
}
