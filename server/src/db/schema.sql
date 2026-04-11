CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ttclid TEXT NOT NULL DEFAULT '',
  fbclid TEXT NOT NULL DEFAULT '',
  ttp TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visitors_timestamp ON visitors(timestamp);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_order_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IDR',
  zip TEXT NOT NULL DEFAULT '',
  financial_status TEXT NOT NULL DEFAULT '',
  raw_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  status_reason TEXT NOT NULL DEFAULT '',
  last_trace_id TEXT NOT NULL DEFAULT '',
  processed_at TEXT,
  created_record_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL DEFAULT '',
  shopify_order_id TEXT NOT NULL DEFAULT '',
  trace_id TEXT NOT NULL DEFAULT '',
  signature_valid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  visitor_id INTEGER NOT NULL,
  shopify_order_id TEXT NOT NULL,
  click_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  confidence TEXT NOT NULL,
  match_score INTEGER NOT NULL DEFAULT 0,
  match_signals TEXT NOT NULL DEFAULT '',
  match_time TEXT NOT NULL,
  time_diff_seconds INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  released_at TEXT,
  released_reason TEXT NOT NULL DEFAULT '',
  match_mode TEXT NOT NULL DEFAULT '',
  lead_score_gap INTEGER NOT NULL DEFAULT 0,
  decision_summary TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matches_order_id ON matches(order_id);

CREATE TABLE IF NOT EXISTS callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  shopify_order_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'webhook',
  trace_id TEXT NOT NULL DEFAULT '',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  retryable INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  request_summary TEXT NOT NULL DEFAULT '',
  response_summary TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  callback_time TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_callbacks_order_id ON callbacks(order_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_status ON callbacks(status);
