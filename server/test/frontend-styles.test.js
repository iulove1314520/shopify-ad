const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const STYLES_PATH = path.join(__dirname, '..', 'public', 'styles.css');

test('前端样式为关键交互控件保留可见焦点态，并避免引用未定义变量', () => {
  const styles = fs.readFileSync(STYLES_PATH, 'utf8');

  assert.doesNotMatch(styles, /var\(--title-main\)/);
  assert.match(styles, /\.sidebar-toggle-btn:focus-visible/);
  assert.match(styles, /\.btn:focus-visible/);
  assert.match(styles, /\.cleanup-tab:focus-visible/);
  assert.match(styles, /\.text-detail summary:focus-visible/);
});
