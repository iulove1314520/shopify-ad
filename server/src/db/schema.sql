CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ttclid TEXT NOT NULL DEFAULT '',
  fbclid TEXT NOT NULL DEFAULT '',
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
  processed_at TEXT,
  created_record_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL DEFAULT '',
  shopify_order_id TEXT NOT NULL DEFAULT '',
  signature_valid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  visitor_id INTEGER NOT NULL,
  shopify_order_id TEXT NOT NULL,
  click_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  confidence TEXT NOT NULL,
  match_time TEXT NOT NULL,
  time_diff_seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matches_order_id ON matches(order_id);

CREATE TABLE IF NOT EXISTS callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  shopify_order_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  response_summary TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  callback_time TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_callbacks_order_id ON callbacks(order_id);

