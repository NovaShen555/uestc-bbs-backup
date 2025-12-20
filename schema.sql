-- 1. 帖子主表：存储标题、作者、统计数据
DROP TABLE IF EXISTS threads;
CREATE TABLE threads (
    thread_id INTEGER PRIMARY KEY, -- 对应 JSON 中的 thread_id
    subject TEXT,                  -- 标题
    author TEXT,                   -- 楼主名字
    author_id INTEGER,             -- 楼主ID
    views INTEGER,                 -- 浏览量
    replies INTEGER,               -- 回复量
    created_at INTEGER,            -- 发帖时间
    last_synced INTEGER            -- 我们最后一次爬取的时间
);

-- 2. 评论表：存储每一楼的具体内容
DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
    post_id INTEGER PRIMARY KEY,   -- 对应 JSON 中的 post_id (全局唯一)
    thread_id INTEGER,             -- 外键，关联到 threads 表
    position INTEGER,              -- 楼层号 (1=一楼, 2=二楼...)
    author TEXT,                   -- 层主名字
    content TEXT,                  -- 对应 message (正文)
    post_date INTEGER,             -- 对应 dateline
    is_first INTEGER,              -- 1 表示是楼主(一楼)，0 表示是回复
    raw_json TEXT                  -- 备份该楼层的完整 JSON
);

-- 3. 不存在的帖子表：记录已确认不存在的帖子ID，避免重复检查
DROP TABLE IF EXISTS missing_threads;
CREATE TABLE missing_threads (
    thread_id INTEGER PRIMARY KEY,
    checked_at INTEGER
);

-- 创建索引以加快查询速度
CREATE INDEX IF NOT EXISTS idx_comments_thread_id ON comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_comments_position ON comments(position);