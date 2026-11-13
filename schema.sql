-- sambon-prod-schema-v2.0 · 由 tools/build-cloudflare.mjs 从 prod/lib/schema.js 生成，请勿手工编辑
-- Cloudflare D1 / SQLite 兼容；全部语句幂等（IF NOT EXISTS）。
-- 老库升级：db.ensureSchema() 会执行 COLUMN_MIGRATIONS 逐条补列。

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('publisher','solver','admin')),
    display_name TEXT NOT NULL,
    available_sbc REAL NOT NULL DEFAULT 0,
    credit_score REAL NOT NULL DEFAULT 100,
    personalized_enabled INTEGER NOT NULL DEFAULT 1,
    stats_json TEXT NOT NULL DEFAULT '{}',
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    locale TEXT NOT NULL DEFAULT 'zh-CN',
    gpc_enabled INTEGER NOT NULL DEFAULT 0,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_seen_at TEXT,
    password_changed_at TEXT
  );
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    csrf TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    solver_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    bounty REAL NOT NULL,
    service_fee REAL NOT NULL DEFAULT 0,
    frozen_total REAL,
    acceptance_criteria TEXT NOT NULL,
    virtual_contact TEXT NOT NULL,
    reject_count INTEGER NOT NULL DEFAULT 0,
    submit_count INTEGER NOT NULL DEFAULT 0,
    escrowed INTEGER NOT NULL DEFAULT 0,
    online INTEGER NOT NULL DEFAULT 1,
    radius_km REAL NOT NULL DEFAULT 10,
    deadline_hours REAL NOT NULL DEFAULT 48,
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL,
    settled_at TEXT,
    result_text TEXT,
    result_pii_redacted INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1
  );
CREATE TABLE IF NOT EXISTS ledger_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    task_id TEXT,
    account TEXT NOT NULL,
    delta REAL NOT NULL,
    rule_version TEXT NOT NULL,
    memo TEXT NOT NULL,
    created_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    task_id TEXT,
    type TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS idempotency (
    event_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    response_json TEXT,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS dispatches (
    dispatch_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    weight_version TEXT NOT NULL,
    candidate_count INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    granted INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS reports (
    report_id TEXT PRIMARY KEY,
    task_id TEXT,
    reporter_id TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS email_verifications (
    user_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    verified_at TEXT
  );
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    read_at TEXT
  );
CREATE TABLE IF NOT EXISTS dispatch_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    solver_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value REAL NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}'
  );
CREATE TABLE IF NOT EXISTS risk_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    flag TEXT NOT NULL,
    score REAL NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL,
    resolved_by TEXT,
    resolved_at TEXT
  );
CREATE TABLE IF NOT EXISTS backups (
    backup_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_publisher ON tasks(publisher_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_ledger_task ON ledger_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
CREATE INDEX IF NOT EXISTS idx_risk_status ON risk_flags(status);
CREATE INDEX IF NOT EXISTS idx_feedback_task ON dispatch_feedback(task_id);

-- 幂等补列（对 v1.0 已存在的库生效；新库会报 duplicate column，可安全忽略）
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE users ADD COLUMN gpc_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
