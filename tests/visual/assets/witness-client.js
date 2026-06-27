/**
 * tests/visual/assets/witness-client.js — browser controls for the visual witness page.
 */

const terminal = document.getElementById('terminal');
const actions = document.getElementById('actions');
const depth = document.getElementById('depth');
const stagesNav = document.getElementById('stages');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const evidenceEl = document.getElementById('evidence');
const stageLabel = document.getElementById('stage-label');
const dashboardLink = document.getElementById('dashboard-link');
const copyBtn = document.getElementById('copy-url');
const autoscroll = document.getElementById('autoscroll');

let repoRoot = '';
let dashboardUrl = window.location.href;
let currentStage = null;
let currentOutput = null;
const stageBlocks = new Map();

dashboardLink.href = dashboardUrl;
dashboardLink.textContent = dashboardUrl;

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(dashboardUrl);
  copyBtn.textContent = 'Copied';
  setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200);
});

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function editorHref(relPath) {
  const clean = relPath.replace(/^`/, '').replace(/`$/, '');
  const abs = `${repoRoot}/${clean}`.replace(/\\/g, '/').replace(/\/+/g, '/');
  return `cursor://file${abs.startsWith('/') ? '' : '/'}${encodeURI(abs)}`;
}

function enrichLine(line) {
  let html = escapeHtml(line);

  html = html.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    `<a class="url" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  html = html.replace(
    /(`?)((?:\.cx\/|docs\/|lib\/|skills\/|tests\/|specialists\/|rules\/|templates\/|personas\/)[\w./-]+\.(?:md|mdx|json|mjs|ts|tsx|yml|yaml)|construct\.config\.json|package\.json)(`?)/g,
    (_m, o, p, c) => `<a class="path" href="${editorHref(p)}" title="Open in editor">${o}${p}${c}</a>`,
  );

  if (/^\/\S/.test(line.trim())) return `<span class="slash">${html}</span>`;

  if (/^ℹ\b/.test(line)) return `<span class="line-info">${html}</span>`;
  if (/^(commands|settings|context|transparency layers|session usage|suggested skills)/i.test(line)) {
    return `<span class="line-heading">${html}</span>`;
  }
  if (/^CONSTRUCT v/i.test(line)) return `<span class="line-muted">${html}</span>`;
  return html;
}

function formatOutput(text) {
  return text
    .split('\n')
    .map((line) => (line.length ? enrichLine(line) : ''))
    .join('\n');
}

function scrollTerminal() {
  if (autoscroll.checked) terminal.scrollTop = terminal.scrollHeight;
}

function setActiveStage(name) {
  for (const [id, block] of stageBlocks) {
    block.classList.toggle('is-active', id === name);
  }
  for (const btn of stagesNav.querySelectorAll('button')) {
    btn.classList.toggle('is-active', btn.dataset.stage === name);
  }
  stageLabel.textContent = name ? `stage: ${name}` : '—';
}

function ensureStage(name) {
  if (stageBlocks.has(name)) {
    currentStage = name;
    currentOutput = stageBlocks.get(name).querySelector('.stage-output');
    setActiveStage(name);
    return;
  }

  const article = document.createElement('article');
  article.className = 'stage-block';
  article.id = `stage-${name}`;
  article.dataset.stage = name;

  const h2 = document.createElement('h2');
  h2.textContent = name;
  article.appendChild(h2);

  const pre = document.createElement('pre');
  pre.className = 'stage-output';
  article.appendChild(pre);

  terminal.appendChild(article);
  stageBlocks.set(name, article);
  currentOutput = pre;
  currentStage = name;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.stage = name;
  btn.textContent = name;
  btn.addEventListener('click', () => {
    document.getElementById(`stage-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveStage(name);
  });
  stagesNav.appendChild(btn);

  setActiveStage(name);
}

function appendAction(kind, text, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = `${kind}: ${text}`;
  actions.prepend(li);
  while (actions.children.length > 100) actions.removeChild(actions.lastChild);
}

function appendDepth(label, grade, detail) {
  const li = document.createElement('li');
  const pillClass = grade === 'deep' || grade === 'adequate' ? 'ok' : 'fail';
  li.innerHTML = `<strong>${escapeHtml(label)}</strong> <span class="pill ${pillClass}">${escapeHtml(grade)}</span><br><span class="line-muted">${escapeHtml(detail || '')}</span>`;
  depth.prepend(li);
}

function appendPrompt(cmd) {
  if (!currentStage) ensureStage('session');
  const block = stageBlocks.get(currentStage);
  const line = document.createElement('span');
  line.className = 'prompt-line';
  line.textContent = `you ▸ ${cmd}`;
  block.appendChild(line);
  scrollTerminal();
}

function appendOutput(chunk) {
  if (!currentOutput) ensureStage('session');
  const plain = chunk.replace(/\r\n/g, '\n');
  const existing = currentOutput.dataset.raw || '';
  const merged = existing + plain;
  currentOutput.dataset.raw = merged;
  currentOutput.innerHTML = formatOutput(merged);
  scrollTerminal();
}

const es = new EventSource('/stream');

es.onopen = () => {
  statusEl.textContent = 'Running…';
  statusEl.className = 'status running';
};

es.onerror = () => {
  statusEl.textContent = 'Disconnected';
  statusEl.className = 'status';
};

es.onmessage = (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }

  if (msg.type === 'init') {
    repoRoot = msg.repoRoot || '';
    dashboardUrl = msg.dashboardUrl || dashboardUrl;
    dashboardLink.href = dashboardUrl;
    dashboardLink.textContent = dashboardUrl;
    if (msg.evidenceDir) {
      const fileUrl = `file://${msg.evidenceDir}`;
      evidenceEl.innerHTML = `<a href="${fileUrl}">${escapeHtml(msg.evidenceDir)}</a>`;
    }
    return;
  }

  if (msg.type === 'stage') {
    ensureStage(msg.name);
    appendAction('stage', msg.name, 'stage');
    statusEl.textContent = `Stage: ${msg.name}`;
    return;
  }

  if (msg.type === 'action' && msg.kind === 'type') {
    appendPrompt(msg.detail);
    appendAction('type', msg.detail, 'action-type');
    return;
  }

  if (msg.type === 'output') {
    appendOutput(msg.text || '');
    return;
  }

  if (msg.type === 'depth') {
    appendDepth(msg.role, msg.grade, msg.detail || '');
    appendAction('depth', `${msg.role} → ${msg.grade}`, msg.grade === 'deep' ? 'depth-pass' : 'depth-fail');
    return;
  }

  if (msg.type === 'stage-result') {
    const btn = stagesNav.querySelector(`button[data-stage="${msg.name}"]`);
    if (btn) btn.classList.add(msg.ok ? 'is-pass' : 'is-fail');
    return;
  }

  if (msg.type === 'summary') {
    statusEl.textContent = msg.ok ? 'All checks passed' : 'Some checks failed';
    statusEl.className = `status ${msg.ok ? 'pass' : 'fail'}`;
    summaryEl.textContent = JSON.stringify(msg.body, null, 2);
    if (msg.body?.evidenceDir) {
      const fileUrl = `file://${msg.body.evidenceDir}`;
      evidenceEl.innerHTML = `<a href="${fileUrl}">${escapeHtml(msg.body.evidenceDir)}</a>`;
    }
    return;
  }

  if (msg.type === 'log') {
    appendAction(msg.kind || 'log', msg.message || '');
  }
};
