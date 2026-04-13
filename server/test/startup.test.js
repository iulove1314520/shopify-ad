const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      resolve(server.address().port);
    });
  });
}

function getFreePort() {
  const server = net.createServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function runServerWithPort(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function startServerWithPort(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGKILL');
      reject(new Error('server.started was not logged in time'));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;

      if (settled || !/"message":"server\.started"/.test(stdout)) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        child,
        stdout,
        stderr,
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `server exited before ready: code=${String(code)} signal=${String(signal)} stderr=${stderr}`
        )
      );
    });
  });
}

function stopServer(child) {
  return new Promise((resolve, reject) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
    child.once('error', reject);
    child.kill('SIGTERM');
  });
}

test('端口可用时会记录 server.started，并在 SIGTERM 时优雅退出', async () => {
  const port = await getFreePort();
  const { child, stdout, stderr } = await startServerWithPort(port);

  try {
    assert.match(stdout, /"message":"server\.started"/);
    assert.match(stdout, new RegExp(`"port":${port}`));
    assert.doesNotMatch(stderr, /"message":"server\.start_failed"/);
  } finally {
    const result = await stopServer(child);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
  }
});

test('端口已被占用时会记录启动失败并退出，而不是落入 uncaughtException', async () => {
  const occupiedServer = net.createServer();
  const port = await waitForServer(occupiedServer);

  try {
    const result = await runServerWithPort(port);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /"message":"server\.start_failed"/);
    assert.match(result.stderr, /"code":"EADDRINUSE"/);
    assert.doesNotMatch(result.stdout, /"message":"server\.started"/);
    assert.doesNotMatch(result.stderr, /"message":"process\.uncaught_exception"/);
  } finally {
    await new Promise((resolve, reject) => {
      occupiedServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});
