// Capture browser pixels directly. Playwright is preferred; CDP needs no package.
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 8092 : Number(process.argv[portIndex + 1]);
const chrome = process.env.SKYRING_CHROME || join(homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');
const shots = JSON.parse(await readFile(join(root, 'shots.json'), 'utf8'));
const folder = join(root, 'screenshots'); await mkdir(folder, { recursive: true });
const server = spawn(process.execPath, [join(root, 'serve.ts'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverFailure = ''; server.stderr.on('data', bytes => { serverFailure += bytes; });
const origin = `http://127.0.0.1:${port}`;
let browser, chromeProcess, profile, connection;

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    if (server.exitCode !== null) throw new Error(serverFailure || 'Static server exited');
    await pause(100);
  }
  throw new Error(`Server did not become ready: ${url}`);
}
function findPlaywright() {
  const require = createRequire(import.meta.url);
  for (const name of ['playwright-core', 'playwright', '/opt/hatch/skills/spaces/ts-runtime/dist/node_modules/playwright-core', '/opt/muse/assets/spaces/ts-runtime/dist/node_modules/playwright-core', '/usr/lib/node_modules/playwright-core']) {
    try { return require(name); } catch {}
  }
  return null;
}
function saveShot(name, bytes) {
  if (bytes.length > 262144) throw new Error(`${name} exceeds 256 KiB: ${bytes.length}`);
  console.log(`${name}: ${bytes.length} bytes (1280x800 JPEG)`);
  return writeFile(join(folder, name), bytes);
}

class CDP {
  constructor(url) {
    this.sequence = 0; this.pending = new Map(); this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve); this.socket.addEventListener('error', reject); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(JSON.stringify(message.error))); else pending?.resolve(message.result);
    });
  }
  async command(method, params = {}, sessionId) {
    await this.ready; const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}
async function captureCDP() {
  const debugPort = port + 100;
  profile = await mkdtemp(join(tmpdir(), 'skyring-chrome-'));
  chromeProcess = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const response = await waitForServer(`http://127.0.0.1:${debugPort}/json/version`);
  connection = new CDP((await response.json()).webSocketDebuggerUrl);
  for (const shot of shots) {
    const { targetId } = await connection.command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.command('Target.attachToTarget', { targetId, flatten: true });
    await connection.command('Page.enable', {}, sessionId);
    await connection.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await connection.command('Page.navigate', { url: origin + '/' + shot.query }, sessionId);
    let ready = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await connection.command('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true }, sessionId);
      if (result.result.value) { ready = true; break; } await pause(100);
    }
    if (!ready) throw new Error(`Scene did not render: ${shot.name}`);
    const { data } = await connection.command('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: false }, sessionId);
    await saveShot(shot.name, Buffer.from(data, 'base64'));
    await connection.command('Target.closeTarget', { targetId });
  }
}

try {
  if (!existsSync(chrome)) throw new Error(`Chromium missing: ${chrome}`);
  await waitForServer(origin);
  const playwright = findPlaywright();
  if (playwright) {
    try {
      browser = await playwright.chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    } catch (error) { console.log(`Playwright launch failed; using CDP: ${error.message}`); }
  }
  if (browser) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    for (const shot of shots) {
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(origin + '/' + shot.query, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
      if (errors.length) throw new Error(errors.join('\n'));
      let bytes = await page.screenshot({ type: 'jpeg', quality: 85 });
      if (bytes.length > 262144) bytes = await page.screenshot({ type: 'jpeg', quality: 75 });
      await saveShot(shot.name, bytes); await page.close();
    }
  } else await captureCDP();
} finally {
  if (browser) await browser.close();
  connection?.socket.close();
  if (chromeProcess) { chromeProcess.kill('SIGTERM'); await new Promise(resolve => chromeProcess.once('exit', resolve)); }
  server.kill('SIGTERM');
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  if (profile) await rm(profile, { recursive: true, force: true });
}
