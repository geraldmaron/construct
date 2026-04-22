/**
 * lib/server/static/app.js — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
(function () {
  'use strict';

  let state = null;

  // ── Navigation ──────────────────────────────────────────────────────
  function initNav() {
    document.querySelectorAll('#nav a').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const target = link.dataset.section;
        activateSection(target);
        document.querySelectorAll('#nav a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  function activateSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('section-' + id);
    if (el) el.classList.add('active');
  }

  // ── Data fetching ────────────────────────────────────────────────────
  async function fetchStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function refresh() {
    try {
      state = await fetchStatus();
      render(state);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }

  async function refreshRegistry() {
    try { await fetchRegistry(); } catch (err) { console.error('Failed to fetch registry:', err); }
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── SSE ──────────────────────────────────────────────────────────────
  function connectSSE() {
    const es = new EventSource('/events');
    es.addEventListener('message', e => {
      if (e.data === 'refresh') { refresh(); refreshRegistry(); }
    });
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // ── Rendering ────────────────────────────────────────────────────────
  function render(data) {
    renderTopbar(data);
    renderResources(data.features ?? [], data.overlays ?? [], data.promotionRequests ?? []);
    renderAgents(data.personas ?? [], data.specialists ?? []);
    renderWorkflow(data.workflow ?? null);
    renderOverlays(data.overlays ?? [], data.promotionRequests ?? []);
    renderSkills(data.skills ?? []);
    renderCLICommands(data.cliCommands ?? []);
    renderCommands(data.commands ?? []);
    renderHooks(data.hooks ?? []);
  }

  function renderTopbar(data) {
    const versionEl = document.getElementById('version');
    const syncEl = document.getElementById('lastsync');
    const dotEl = document.getElementById('healthdot');
    const statusEl = document.getElementById('system-status');

    if (versionEl) versionEl.textContent = 'v' + (data.version ?? '?');

    if (syncEl) {
      if (data.lastSync) {
        const d = new Date(data.lastSync);
        syncEl.textContent = 'synced ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        syncEl.textContent = 'not synced';
      }
    }

    if (dotEl) {
      const overall = data.system?.overall?.status ?? 'unavailable';
      dotEl.className = 'health-dot ' + (overall === 'healthy' ? 'healthy' : overall === 'degraded' ? 'degraded' : 'bad');
      dotEl.title = data.system?.overall?.summary ?? 'System health unknown';
    }

    if (statusEl) {
      const usage = data.sessionUsage?.status === 'available'
        ? ` · ${data.sessionUsage.totalTokens.toLocaleString()} tokens this session`
        : '';
      const telemetry = data.telemetryRichness?.total !== undefined
        ? ` · telemetry ${data.telemetryRichness.status}${data.telemetryRichness.total ? ` ${data.telemetryRichness.rich}/${data.telemetryRichness.total} rich` : ''}`
        : '';
      statusEl.textContent = (data.system?.overall?.summary ?? 'status unavailable') + usage + telemetry;
    }
  }

  function statusBadge(status) {
    const labels = {
      healthy: 'Healthy',
      configured: 'Configured',
      degraded: 'Degraded',
      unavailable: 'Unavailable',
      disabled: 'Disabled',
    };
    const label = labels[status] ?? status;
    return `<span class="badge badge-${status}">${label}</span>`;
  }

  function tierBadge(tier) {
    const t = (tier ?? 'standard').toLowerCase();
    return `<span class="badge badge-${t}">${t}</span>`;
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Resources ────────────────────────────────────────────────────────
  function renderResources(features) {
    const container = document.getElementById('resources-cards');
    if (!container) return;

    if (!features.length) {
      container.innerHTML = '<div class="empty">No features configured.</div>';
      return;
    }

    const services = state?.system?.services ?? [];
    const telemetry = state?.telemetryRichness;
    const serviceCards = services.map(service => {
      const msg = service.message
        ? `<div class="card-footer">${esc(service.message)}${service.note ? ` · ${esc(service.note)}` : ''}</div>`
        : service.note
          ? `<div class="card-footer">${esc(service.note)}</div>`
          : '';

      return `
        <div class="card">
          <div class="card-header">
            <span class="card-name">${esc(service.name)}</span>
            ${statusBadge(service.status)}
          </div>
          <div class="card-desc">${esc(service.url)}</div>
          ${msg}
        </div>`;
    });

    const featureCards = features.map(f => {
      const msg = f.status === 'disabled'
        ? `<div class="card-footer">${esc(f.degradedMessage)}</div>`
        : f.message
          ? `<div class="card-footer">${esc(f.message)}</div>`
          : '';

      return `
        <div class="card">
          <div class="card-header">
            <span class="card-name">${esc(f.name)}</span>
            ${statusBadge(f.status)}
          </div>
          <div class="card-desc">${esc(f.description)}</div>
          ${msg}
        </div>`;
    });

    const telemetryCard = telemetry ? [`
      <div class="card">
        <div class="card-header">
          <span class="card-name">Telemetry Richness</span>
          ${statusBadge(telemetry.status)}
        </div>
        <div class="card-desc">${esc(telemetry.summary)}</div>
        <div class="card-footer">coverage ${((Number(telemetry.coverage ?? 0) || 0) * 100).toFixed(0)}% · rich ${esc(String(telemetry.rich ?? 0))} · partial ${esc(String(telemetry.partial ?? 0))} · sparse ${esc(String(telemetry.sparse ?? 0))}</div>
      </div>`] : [];

    container.innerHTML = [...telemetryCard, ...serviceCards, ...featureCards].join('');
  }

  // ── Agents ────────────────────────────────────────────────────────────
  function renderAgents(personas, specialists) {
    const container = document.getElementById('agents-content');
    if (!container) return;

    let html = '';

    if (personas.length) {
      html += `<div class="agent-group">
        <div class="agent-group-title">Entry Point</div>
        <div class="persona-cards">`;

      html += personas.map(p => `
        <div class="persona-card">
          <div class="card-header">
            <div>
              <div class="persona-name">@${esc(p.name)}</div>
              <div class="persona-role">${esc(p.role)}</div>
            </div>
            ${tierBadge(p.modelTier)}
          </div>
          <div class="persona-desc">${esc(p.description)}</div>
        </div>`).join('');

      html += '</div></div>';
    }

    if (specialists.length) {
      html += `<div class="agent-group">
        <div class="agent-group-title">Specialists</div>
        <div class="specialist-list">`;

      html += specialists.map(s => `
        <div class="specialist-row">
          <span class="specialist-name">${esc(s.name)}</span>
          <span class="specialist-desc" title="${esc(s.description)}">${esc(s.description)}</span>
          ${tierBadge(s.modelTier)}
        </div>`).join('');

      html += '</div></div>';
    }

    if (!html) html = '<div class="empty">No agents found.</div>';
    container.innerHTML = html;
  }

  // ── Workflow ────────────────────────────────────────────────────────
  const PHASE_ORDER = ['research', 'plan', 'implement', 'validate', 'operate'];
  const PHASE_ICONS = { research: '◎', plan: '▣', implement: '⚙', validate: '✓', operate: '▶' };

  function phaseStatusClass(status) {
    if (!status || status === 'todo') return 'pipeline-phase--todo';
    if (status === 'done' || status === 'executive-approved') return 'pipeline-phase--done';
    if (status === 'in-progress') return 'pipeline-phase--active';
    if (status === 'blocked') return 'pipeline-phase--blocked';
    return 'pipeline-phase--todo';
  }

  function renderPipeline(phases, activePhase) {
    return `<div class="dispatch-pipeline">${PHASE_ORDER.map((p, i) => {
      const phaseData = phases?.[p] ?? {};
      const isActive = p === activePhase;
      const cls = isActive ? 'pipeline-phase--active' : phaseStatusClass(phaseData.status);
      const connector = i < PHASE_ORDER.length - 1 ? '<span class="pipeline-connector">→</span>' : '';
      return `<span class="pipeline-phase ${cls}" title="${esc(phaseData.summary ?? p)}">${PHASE_ICONS[p] ?? '·'} ${esc(p)}</span>${connector}`;
    }).join('')}</div>`;
  }

  function renderWorkflow(workflow) {
    const container = document.getElementById('workflow-content');
    if (!container) return;

    if (!workflow || !workflow.exists) {
      container.innerHTML = '<div class="empty">No .cx/workflow.json in the dashboard working directory.</div>';
      return;
    }

    const state = workflow.state ?? {};
    const tasks = state.tasks ?? [];
    const current = tasks.find(t => t.key === state.currentTaskKey);
    const findings = workflow.findings ?? [];

    const taskRows = tasks.length ? tasks.map(t => {
      const needsReview = t.phase === 'implement' && t.status !== 'done' && t.status !== 'skipped';
      const verified = t.verification && t.verification.length;
      const badge = verified
        ? '<span class="badge badge-healthy">verified</span>'
        : needsReview
          ? '<span class="badge badge-degraded">needs review</span>'
          : '<span class="badge badge-disabled">open</span>';
      return `
      <div class="specialist-row">
        <span class="specialist-name">${esc(t.key)} <span style="color:var(--text-muted)">${esc(t.status)}</span></span>
        <span class="specialist-desc" title="${esc(t.title)}">${esc(t.phase)} / ${esc(t.owner)} — ${esc(t.title)}${t.challengeRequired ? ` · challenge: ${esc(t.challengeStatus || 'pending')}` : ''}</span>
        ${badge}
      </div>`;
    }).join('') : '<div class="empty">No tasks yet.</div>';

    const findingRows = findings.length ? findings.map(f => `
      <div class="hook-row">
        <div class="${f.severity === 'HIGH' ? 'hook-bullet blocking' : 'hook-bullet'}"></div>
        <div class="hook-desc">${esc(f.task ? f.task + ': ' : '')}${esc(f.issue)}<br><span class="hook-phase-badge">${esc(f.fix)}</span></div>
      </div>`).join('') : '<div class="empty">Alignment checks pass.</div>';

    const dispatchPlan = state.dispatchPlan
      ? `<div class="card-footer" style="font-style:italic;color:var(--accent-dim)">${esc(state.dispatchPlan)}</div>`
      : '';

    container.innerHTML = `
      <div class="cards">
        <div class="card">
          <div class="card-header">
            <span class="card-name">${esc(state.title)}</span>
            <span class="badge badge-${workflow.status === 'pass' ? 'healthy' : workflow.status === 'warn' ? 'degraded' : 'unavailable'}">${esc(workflow.status)}</span>
          </div>
          <div class="card-desc">${esc(workflow.summary)}</div>
          ${dispatchPlan}
          <div style="margin-top:12px">${renderPipeline(state.phases, state.phase)}</div>
          <div class="card-footer">${esc(workflow.cwd)}</div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-name">Current Task</span>
            ${current ? '<span class="badge badge-standard">' + esc(current.phase) + '</span>' : '<span class="badge badge-disabled">none</span>'}
          </div>
          <div class="card-desc">${current ? esc(current.key + ' — ' + current.title) : 'No active task.'}</div>
          <div class="card-footer">${current ? esc(current.owner + ' / ' + current.status) : ''}</div>
        </div>
      </div>
      <div class="agent-group">
        <div class="agent-group-title">Tasks</div>
        <div class="specialist-list">${taskRows}</div>
      </div>
      <div class="agent-group">
        <div class="agent-group-title">Alignment</div>
        ${findingRows}
      </div>`;
  }

  function renderOverlays(overlays, promotions) {
    const container = document.getElementById('workflow-content');
    if (!container) return;
    const existing = document.getElementById('workflow-overlays');
    if (existing) existing.remove();
    if (!overlays.length && !promotions.length) return;

    const section = document.createElement('div');
    section.id = 'workflow-overlays';
    section.className = 'agent-group';

    const header = document.createElement('div');
    header.className = 'agent-group-title';
    header.textContent = 'Overlays & Promotion Requests';
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'specialist-list';

    overlays.forEach((overlay) => {
      const row = document.createElement('div');
      row.className = 'specialist-row';
      row.innerHTML = `
        <span class="specialist-name">${esc(overlay.domain)}</span>
        <span class="specialist-desc">${esc(overlay.objective)}${overlay.taskKey ? ` · task ${esc(overlay.taskKey)}` : ''}</span>
        <span class="badge badge-standard">${esc(overlay.focus)}</span>`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';

      const promote = document.createElement('button');
      promote.className = 'tab-btn';
      promote.style.padding = '4px 8px';
      promote.textContent = 'promote';
      promote.addEventListener('click', async () => {
        try {
          await postJson('/api/headhunt/promote', { id: overlay.id });
          await refresh();
        } catch (error) {
          console.error('Failed to promote overlay:', error);
        }
      });
      actions.appendChild(promote);
      row.appendChild(actions);
      list.appendChild(row);
    });

    promotions.forEach((promotion) => {
      const row = document.createElement('div');
      row.className = 'specialist-row';
      row.innerHTML = `
        <span class="specialist-name">${esc(promotion.domain)}</span>
        <span class="specialist-desc">challenge ${esc(promotion.challenge?.status ?? 'pending')} · ${esc((promotion.reviewFlow ?? []).join(' → '))}</span>
        <span class="badge badge-degraded">${esc(promotion.status)}</span>`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';

      ['approved', 'rejected', 'pending'].forEach((status) => {
        const button = document.createElement('button');
        button.className = 'tab-btn';
        button.style.padding = '4px 8px';
        button.textContent = status;
        button.addEventListener('click', async () => {
          try {
            await postJson('/api/headhunt/challenge', { id: promotion.id, status });
            await refresh();
          } catch (error) {
            console.error('Failed to update promotion challenge:', error);
          }
        });
        actions.appendChild(button);
      });

      row.appendChild(actions);
      list.appendChild(row);
    });

    section.appendChild(list);
    container.appendChild(section);
  }

  // ── Skills ────────────────────────────────────────────────────────────
  function toDisplayName(filename) {
    return filename
      .replace(/\.(md|mjs)$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function renderSkills(skills) {
    const container = document.getElementById('skills-content');
    if (!container) return;

    if (!skills.length) {
      container.innerHTML = '<div class="empty">No skills found.</div>';
      return;
    }

    container.innerHTML = skills.map((cat, i) => {
      const tags = (cat.files ?? []).map(f =>
        `<span class="skill-tag">${esc(toDisplayName(f))}</span>`
      ).join('');

      return `
        <div class="skill-category" id="skill-cat-${i}">
          <div class="skill-category-header" data-cat="${i}">
            <span class="skill-category-name">${esc(cat.category)}</span>
            <span style="display:flex;gap:12px;align-items:center">
              <span class="skill-category-count">${(cat.files ?? []).length} files</span>
              <span class="skill-toggle">▾</span>
            </span>
          </div>
          <div class="skill-files">${tags || '<span class="empty">No files</span>'}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.skill-category-header').forEach(header => {
      header.addEventListener('click', () => {
        const cat = header.closest('.skill-category');
        cat.classList.toggle('open');
      });
    });
  }

  // ── CLI Commands ──────────────────────────────────────────────────────
  const CATEGORY_ORDER = [
    'Services',
    'Agents & Sync',
    'Work',
    'Models & Integrations',
    'Observability',
    'Diagnostics',
  ];

  function renderCLICommands(cliCommands) {
    const container = document.getElementById('cli-commands-content');
    if (!container) return;

    if (!cliCommands.length) {
      container.innerHTML = '<div class="empty">No CLI commands found.</div>';
      return;
    }

    // Group by category
    const byCategory = {};
    for (const cmd of cliCommands) {
      const cat = cmd.category ?? 'Other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(cmd);
    }

    const orderedCats = [
      ...CATEGORY_ORDER.filter(c => byCategory[c]),
      ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)),
    ];

    container.innerHTML = orderedCats.map(cat => {
      const rows = byCategory[cat].map(c => `
        <div class="cli-cmd-row" title="${esc(c.usage ?? c.name)}">
          <span class="cli-cmd-emoji">${esc(c.emoji ?? '')}</span>
          <span class="cli-cmd-name">construct ${esc(c.name)}</span>
          <span class="cli-cmd-desc">${esc(c.description)}</span>
        </div>`).join('');
      return `
        <div class="cli-cmd-group">
          <div class="cli-cmd-group-title">${esc(cat)}</div>
          <div class="cli-commands-list">${rows}</div>
        </div>`;
    }).join('');
  }

  // ── Commands (slash) ──────────────────────────────────────────────────
  function renderCommands(commands) {
    const container = document.getElementById('commands-content');
    if (!container) return;

    if (!commands.length) {
      container.innerHTML = '<div class="empty">No commands found.</div>';
      return;
    }

    container.innerHTML = `<div class="commands-grid">` + commands.map(d => {
      const items = (d.commands ?? []).map(c => `
        <div class="command-item">
          <span class="command-slash">${esc(c.slash)}</span>
          <span class="command-desc">${esc(c.description)}</span>
        </div>`).join('');

      return `
        <div class="command-domain">
          <div class="command-domain-header">${esc(d.domain)}</div>
          <div class="command-list">${items}</div>
        </div>`;
    }).join('') + `</div>`;
  }

  // ── Hooks ─────────────────────────────────────────────────────────────
  function renderHooks(hooks) {
    const container = document.getElementById('hooks-content');
    if (!container) return;

    if (!hooks.length) {
      container.innerHTML = '<div class="empty">No hooks configured.</div>';
      return;
    }

    const byPhase = {};
    for (const h of hooks) {
      const p = h.phase ?? 'Unknown';
      if (!byPhase[p]) byPhase[p] = [];
      byPhase[p].push(h);
    }

    const phaseOrder = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'];
    const phases = [
      ...phaseOrder.filter(p => byPhase[p]),
      ...Object.keys(byPhase).filter(p => !phaseOrder.includes(p)),
    ];

    container.innerHTML = phases.map(phase => {
      const rows = byPhase[phase].map(h => {
        const bulletClass = h.blocking ? 'hook-bullet blocking' : 'hook-bullet';
        const asyncLabel = h.blocking ? '' : '<span class="hook-phase-badge">async</span>';
        return `
          <div class="hook-row">
            <div class="${bulletClass}"></div>
            <div class="hook-desc">${esc(h.description)}</div>
            ${asyncLabel}
          </div>`;
      }).join('');

      return `
        <div class="hook-phase">
          <div class="hook-phase-title">${esc(phase)}</div>
          ${rows}
        </div>`;
    }).join('');
  }

  // ── Tab switching ─────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tabs').forEach(tabGroup => {
      tabGroup.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tabId = btn.dataset.tab;
          tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const section = tabGroup.closest('.section') ?? tabGroup.parentElement;
          section.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
          const panel = document.getElementById(`commands-tab-${tabId}`);
          if (panel) panel.classList.add('active');
        });
      });
    });
  }

  // ── MCP Servers ───────────────────────────────────────────────────────
  let registryData = null;

  async function fetchRegistry() {
    const res = await fetch('/api/registry');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    registryData = await res.json();
    renderMcp(registryData.mcpServers ?? {});
    renderModels(registryData.models ?? {});
  }

  function mcpServerForm(id, server, isNew) {
    const isUrl = server.type === 'url';
    return `
      <div class="field-row">
        <label class="field-label">ID</label>
        <input class="field-input" data-field="id" value="${esc(id)}" placeholder="e.g. my-server" ${isNew ? '' : 'readonly'}>
      </div>
      <div class="field-row">
        <label class="field-label">Type</label>
        <select class="field-input" data-field="type">
          <option value="stdio" ${!isUrl ? 'selected' : ''}>stdio (command)</option>
          <option value="url" ${isUrl ? 'selected' : ''}>url (HTTP/SSE)</option>
        </select>
      </div>
      <div class="field-row" data-show="stdio" style="${isUrl ? 'display:none' : ''}">
        <label class="field-label">Command</label>
        <input class="field-input" data-field="command" value="${esc(server.command ?? '')}" placeholder="e.g. npx">
      </div>
      <div class="field-row" data-show="stdio" style="${isUrl ? 'display:none' : ''}">
        <label class="field-label">Args (one per line)</label>
        <textarea class="field-input" data-field="args" rows="3" placeholder="-y&#10;@some/mcp-server">${esc((server.args ?? []).join('\n'))}</textarea>
      </div>
      <div class="field-row" data-show="url" style="${isUrl ? '' : 'display:none'}">
        <label class="field-label">URL</label>
        <input class="field-input" data-field="url" value="${esc(server.url ?? '')}" placeholder="https://...">
      </div>
      <div class="field-row">
        <label class="field-label">Description</label>
        <input class="field-input" data-field="description" value="${esc(server.description ?? '')}" placeholder="What this server does">
      </div>`;
  }

  function wireFormTypeToggle(form) {
    const typeSelect = form.querySelector('[data-field="type"]');
    if (!typeSelect) return;
    typeSelect.addEventListener('change', () => {
      const isUrl = typeSelect.value === 'url';
      form.querySelectorAll('[data-show="stdio"]').forEach(el => el.style.display = isUrl ? 'none' : '');
      form.querySelectorAll('[data-show="url"]').forEach(el => el.style.display = isUrl ? '' : 'none');
    });
  }

  function readFormData(form) {
    const get = field => form.querySelector(`[data-field="${field}"]`)?.value?.trim() ?? '';
    const type = get('type');
    const server = { description: get('description') };
    if (type === 'url') {
      server.type = 'url';
      server.url = get('url');
    } else {
      server.command = get('command');
      server.args = get('args').split('\n').map(s => s.trim()).filter(Boolean);
    }
    return { id: get('id'), server };
  }

  function showMsg(container, text, isOk) {
    let msg = container.querySelector('.status-msg');
    if (!msg) { msg = document.createElement('div'); container.appendChild(msg); }
    msg.className = 'status-msg ' + (isOk ? 'ok' : 'err');
    msg.textContent = text;
    if (isOk) setTimeout(() => msg.remove(), 2500);
  }

  function renderMcp(mcpServers) {
    const container = document.getElementById('mcp-content');
    if (!container) return;

    const entries = Object.entries(mcpServers).sort(([a], [b]) => a.localeCompare(b));
    container.innerHTML = '';

    entries.forEach(([id, server]) => {
      const row = document.createElement('div');
      row.className = 'edit-row';
      row.innerHTML = `
        <div class="edit-row-header">
          <span class="edit-row-name">${esc(id)}</span>
          <span class="edit-row-desc">${esc(server.description ?? server.url ?? server.command ?? '')}</span>
          <span class="badge badge-${server.type === 'url' ? 'standard' : 'fast'}">${server.type === 'url' ? 'url' : 'stdio'}</span>
        </div>
        <div class="edit-form">
          ${mcpServerForm(id, server, false)}
          <div class="form-actions">
            <button class="btn btn-primary js-save">Save</button>
            <button class="btn btn-danger js-delete">Delete</button>
          </div>
        </div>`;

      row.querySelector('.edit-row-header').addEventListener('click', () => row.classList.toggle('expanded'));
      wireFormTypeToggle(row.querySelector('.edit-form'));

      row.querySelector('.js-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { id: newId, server: newServer } = readFormData(row.querySelector('.edit-form'));
          await postJson('/api/registry/mcp', { action: 'save', id: newId, server: newServer });
          showMsg(row, 'Saved', true);
          await fetchRegistry();
        } catch (err) {
          showMsg(row, err.message, false);
          btn.disabled = false;
        }
      });

      row.querySelector('.js-delete').addEventListener('click', async (e) => {
        if (!confirm(`Delete MCP server "${id}"?`)) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await postJson('/api/registry/mcp', { action: 'delete', id });
          await fetchRegistry();
        } catch (err) {
          showMsg(row, err.message, false);
          btn.disabled = false;
        }
      });

      container.appendChild(row);
    });

    // Add new server form
    const addSection = document.createElement('div');
    addSection.className = 'add-server-row';
    const addRow = document.createElement('div');
    addRow.className = 'edit-row';
    addRow.innerHTML = `
      <div class="edit-row-header">
        <span class="edit-row-name" style="color:var(--accent-dim)">+ Add MCP Server</span>
      </div>
      <div class="edit-form">
        ${mcpServerForm('', { args: [] }, true)}
        <div class="form-actions">
          <button class="btn btn-primary js-add">Add Server</button>
        </div>
      </div>`;

    addRow.querySelector('.edit-row-header').addEventListener('click', () => addRow.classList.toggle('expanded'));
    wireFormTypeToggle(addRow.querySelector('.edit-form'));

    addRow.querySelector('.js-add').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { id, server } = readFormData(addRow.querySelector('.edit-form'));
        if (!id) throw new Error('ID is required');
        await postJson('/api/registry/mcp', { action: 'save', id, server });
        await fetchRegistry();
      } catch (err) {
        showMsg(addRow, err.message, false);
        btn.disabled = false;
      }
    });

    addSection.appendChild(addRow);
    container.appendChild(addSection);
  }

  // ── Model Tiers ───────────────────────────────────────────────────────
  function renderModels(models) {
    const container = document.getElementById('models-content');
    if (!container) return;

    const tiers = ['reasoning', 'standard', 'fast'];
    container.innerHTML = tiers.map(tier => {
      const cfg = models[tier] ?? {};
      const primary = cfg.primary ?? '';
      const fallback = (cfg.fallback ?? []).join('\n');
      return `
        <div class="model-tier-card" id="model-tier-${tier}">
          <div class="model-tier-title">
            ${tier}
            ${tierBadge(tier)}
          </div>
          <div class="edit-form" style="display:flex">
            <div class="field-row">
              <label class="field-label">Primary Model</label>
              <input class="field-input" data-field="primary" value="${esc(primary)}" placeholder="provider/model-id">
            </div>
            <div class="field-row">
              <label class="field-label">Fallback Models (one per line)</label>
              <textarea class="field-input" data-field="fallback" rows="3" placeholder="provider/model-a&#10;provider/model-b">${esc(fallback)}</textarea>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary js-save-tier" data-tier="${tier}">Save</button>
            </div>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.js-save-tier').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tier = e.currentTarget.dataset.tier;
        const card = document.getElementById('model-tier-' + tier);
        e.currentTarget.disabled = true;
        try {
          const primary = card.querySelector('[data-field="primary"]').value.trim();
          const fallback = card.querySelector('[data-field="fallback"]').value
            .split('\n').map(s => s.trim()).filter(Boolean);
          await postJson('/api/registry/models', { tier, primary, fallback });
          showMsg(card, 'Saved', true);
          await fetchRegistry();
        } catch (err) {
          showMsg(card, err.message, false);
          e.currentTarget.disabled = false;
        }
      });
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────────
  function init() {
    initNav();
    initTabs();
    refresh();
    refreshRegistry();
    connectSSE();
    setInterval(refresh, 10000);
    setInterval(refreshRegistry, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
