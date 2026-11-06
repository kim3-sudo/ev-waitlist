// Starts the Plugyard stack from the repo root.
//
//   npm start                   API server + web UI
//   npm start -- --simulator    also start a charge point simulator
//   npm start -- --simulator=SIM-002
//
// Before anything starts it prepares the database (creating a first-run admin
// with a generated passphrase if none exists). Ctrl+C stops everything.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverDir = path.join(rootDir, 'server');

const SIM_CONNECTORS = 2;
const DEFAULT_SIM_IDENTITY = 'SIM-001';
// Where the simulator's control page listens (see server/src/simulator/chargePoint.js).
const SIM_UI_PORT = Number(process.env.SIM_UI_PORT ?? 4100);
const simulatorControlUrl = `http://127.0.0.1:${SIM_UI_PORT}`;

// ---- arguments ------------------------------------------------------------

let simulatorIdentity = null;
for (const arg of process.argv.slice(2)) {
  if (arg === '--simulator') {
    simulatorIdentity = DEFAULT_SIM_IDENTITY;
  } else if (arg.startsWith('--simulator=')) {
    simulatorIdentity = arg.slice('--simulator='.length) || DEFAULT_SIM_IDENTITY;
  } else {
    console.error(`Unknown option: ${arg}\nUsage: npm start [-- --simulator[=IDENTITY]]`);
    process.exit(1);
  }
}

// ---- helpers --------------------------------------------------------------

function runStep(label, args) {
  // Captured so the first-run passphrase can be reprinted in the summary.
  const result = spawnSync('npm', args, { cwd: rootDir, shell: isWindows, encoding: 'utf8' });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) {
    console.error(`[setup] ${label} failed; not starting.`);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function readApiPort() {
  const envFile = path.join(rootDir, '.env');
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(/^PORT=(\d+)/m);
    if (match) return Number(match[1]);
  }
  return Number(process.env.PORT ?? 4000);
}

function parseFirstRunCredentials(output) {
  if (!output.includes('FIRST RUN')) return null;
  const email = output.match(/Email:\s+(\S+)/)?.[1];
  const passphrase = output.match(/Passphrase:\s+(\S+)/)?.[1];
  return email && passphrase ? { email, passphrase } : null;
}

async function waitForApi(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---- 1. environment and database -----------------------------------------

const envFile = path.join(rootDir, '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(rootDir, '.env.example'), envFile);
  console.log('[setup] created .env from .env.example');
}

console.log('[setup] preparing database (npm run db:setup --workspace server)');
const setupOutput = runStep('database setup', ['run', 'db:setup', '--workspace', 'server']);
const firstRun = parseFirstRunCredentials(setupOutput);

let simulatorReady = false;
if (simulatorIdentity) {
  console.log(`[setup] preparing simulator station ${simulatorIdentity}`);
  runStep('simulator station setup', [
    'run',
    'db:seed-simulator',
    '--workspace',
    'server',
    '--',
    simulatorIdentity,
    String(SIM_CONNECTORS),
  ]);
  simulatorReady = true;
}

// ---- 2. start processes ---------------------------------------------------

const apiPort = readApiPort();
const apiUrl = `http://localhost:${apiPort}`;
const ocppUrl = `ws://localhost:${apiPort}/ocpp`;
let webUrl = 'http://localhost:5173';

const children = [];
let stopping = false;

function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    // Dev servers run under `npm run` and spawn the real process as a
    // grandchild, so signal the whole group when we created one.
    if (!isWindows && child.detached) process.kill(-child.pid, 'SIGINT');
    else child.kill('SIGINT');
  } catch {
    // already gone
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killChild(child);
  setTimeout(() => process.exit(code), 1000).unref();
}

// Servers under `npm run` get their own process group (detached) and no stdin,
// so Vite can't read keystrokes meant for the simulator prompt.
function startServer(name, script, { onOutput } = {}) {
  const child = spawn('npm', ['run', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    detached: !isWindows,
    env: process.env,
  });

  const prefix = `[${name}] `;
  const pipeWithPrefix = (stream, out) => {
    let buffered = '';
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      onOutput?.(text);
      buffered += text;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
    stream.on('end', () => {
      if (buffered) out.write(prefix + buffered + '\n');
    });
  };
  pipeWithPrefix(child.stdout, process.stdout);
  pipeWithPrefix(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    console.log(`${prefix}exited (${signal ?? `code ${code}`})`);
    shutdown(code ?? 0);
  });

  children.push(child);
  return child;
}

startServer('server', 'dev:server');
startServer('web', 'dev:web', {
  onOutput: (text) => {
    const match = text.match(/Local:\s+(http\S+)/);
    if (match) webUrl = match[1].replace(/\/$/, '');
  },
});

// ---- 3. simulator (after the API is up) -----------------------------------

async function startSimulator() {
  console.log(`[simulator] waiting for the API at ${apiUrl} ...`);
  const up = await waitForApi(`${apiUrl}/api/health`);
  if (!up) {
    console.error('[simulator] the API did not come up; not starting the simulator.');
    return;
  }

  // Not detached: the simulator needs the terminal for its prompt, so it stays
  // in the foreground process group and receives Ctrl+C directly.
  const sim = spawn('node', ['src/simulator/chargePoint.js', simulatorIdentity, String(SIM_CONNECTORS)], {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, CS_ENDPOINT: ocppUrl },
  });
  children.push(sim);
  sim.on('exit', (code, signal) => {
    // Typing `quit` in the simulator only stops the simulator, not the stack.
    console.log(`[simulator] exited (${signal ?? `code ${code}`}). The API and web UI are still running.`);
  });
}

// ---- 4. ready summary -----------------------------------------------------

function printSummary() {
  const lines = [
    '',
    '============================================================',
    '  Plugyard is running',
    '',
    `  Web UI:   ${webUrl}`,
    `  API:      ${apiUrl}`,
  ];

  if (firstRun) {
    lines.push(
      '',
      '  First-run admin (shown once; change the passphrase at sign-in):',
      `    Email:       ${firstRun.email}`,
      `    Passphrase:  ${firstRun.passphrase}`,
    );
  }

  if (simulatorReady) {
    lines.push(
      '',
      '  Charge point simulator:',
      `    Identity:    ${simulatorIdentity}`,
      `    Connectors:  ${SIM_CONNECTORS}`,
      `    OCPP URL:    ${ocppUrl}/${simulatorIdentity}`,
      ...(SIM_UI_PORT > 0 ? [`    Control:     ${simulatorControlUrl}`] : []),
      '    Commands:    available|preparing|charging|finishing|faulted <connectorId>, profile basic|full, quit',
    );
  }

  lines.push('', '  Press Ctrl+C to stop everything.', '============================================================', '');
  console.log(lines.join('\n'));
}

(async () => {
  const up = await waitForApi(`${apiUrl}/api/health`);
  if (simulatorReady) await startSimulator();
  if (up) {
    // Give Vite a moment to print its local URL so the summary can show it.
    await new Promise((r) => setTimeout(r, 1500));
    printSummary();
  }
})();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
