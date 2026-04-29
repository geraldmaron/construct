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
      if (e.data === 'refresh') { refresh(); refreshRegistry(); refreshArtifacts(); refreshApprovals(); refreshSnapshots(); }
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
    renderPlugins(data.plugins ?? null);
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
        ? ` · ${data.sessionUsage.providerTotalTokens.toLocaleString()} provider total this session`
        : '';
      const telemetry = data.telemetryRichness?.total !== undefined
        ? ` · telemetry ${data.telemetryRichness.status}${data.telemetryRichness.total ? ` ${data.telemetryRichness.rich}/${data.telemetryRichness.total} rich` : ''}`
        : '';
      statusEl.textContent = (data.system?.overall?.summary ?? 'status unavailable') + usage + telemetry;
    }

    updateModeBadge();
  }

  // ── Mode badge ──────────────────────────────────────────────────────────
  // Derives operational mode from the config endpoint:
  //   embed — embed.yaml is non-empty (daemon configured)
  //   live  — no embed.yaml but providers are registered
  //   init  — nothing configured yet
  let _modeConfigCache = null;
  async function updateModeBadge() {
    const el = document.getElementById('mode-badge');
    if (!el) return;
    try {
      if (!_modeConfigCache) {
        const res = await fetch('/api/config');
        if (res.ok) _modeConfigCache = await res.json();
      }
      const hasEmbed = Boolean(_modeConfigCache?.embed?.trim());
      const hasEnv = Boolean(_modeConfigCache?.env?.trim());
      const mode = hasEmbed ? 'embed' : hasEnv ? 'live' : 'init';
      el.textContent = mode;
      el.className = 'meta mode-badge mode-' + mode;
      el.title = mode === 'embed' ? 'Embed daemon configured' : mode === 'live' ? 'Providers configured, no daemon' : 'Not yet configured';
    } catch {
      el.textContent = '—';
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

    const pluginSummary = state?.plugins ? [`
      <div class="card">
        <div class="card-header">
          <span class="card-name">Plugin Registry</span>
          ${statusBadge(state.plugins.status)}
        </div>
        <div class="card-desc">${esc(state.plugins.summary)}</div>
        <div class="card-footer">${esc(String((state.plugins.entries ?? []).length))} entries · ${(state.plugins.errors ?? []).length ? esc(String((state.plugins.errors ?? []).length)) + ' manifest errors' : 'all manifests valid'}</div>
      </div>`] : [];

    container.innerHTML = [...telemetryCard, ...pluginSummary, ...serviceCards, ...featureCards].join('');
  }

  function renderPlugins(plugins) {
    const container = document.getElementById('plugins-content');
    if (!container) return;

    if (!plugins || !(plugins.entries ?? []).length) {
      container.innerHTML = '<div class="empty">No plugins discovered.</div>';
      return;
    }

    const errorBlock = (plugins.errors ?? []).length
      ? `<div class="agent-group">
          <div class="agent-group-title">Manifest Errors</div>
          ${(plugins.errors ?? []).map(error => `
            <div class="hook-row">
              <div class="hook-bullet blocking"></div>
              <div class="hook-desc">${esc(error)}</div>
            </div>`).join('')}
        </div>`
      : '';

    const directoryBlock = (plugins.directories ?? []).length
      ? `<div class="card-footer">search paths: ${(plugins.directories ?? []).map(dir => esc(dir)).join(' · ')}</div>`
      : '';

    const pluginCards = (plugins.entries ?? []).map(plugin => `
      <div class="card">
        <div class="card-header">
          <span class="card-name">${esc(plugin.name)}</span>
          ${statusBadge(plugin.builtIn ? 'configured' : 'healthy')}
        </div>
        <div class="card-desc">${esc(plugin.description)}</div>
        <div class="card-footer">${esc(plugin.id)} · v${esc(plugin.version)} · ${plugin.builtIn ? 'built-in' : esc(plugin.manifestPath)} · ${esc(String(plugin.mcpCount))} MCPs</div>
        <div class="card-footer">${(plugin.mcps ?? []).map(mcp => esc(mcp.id)).join(' · ') || 'No MCP entries'}</div>
      </div>`).join('');

    container.innerHTML = `
      <div class="cards">${pluginCards}</div>
      ${directoryBlock}
      ${errorBlock}`;
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
      container.innerHTML = '<div class="empty">No tracker-linked plan state available in the dashboard working directory.</div>';
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

  // ── Artifacts ─────────────────────────────────────────────────────────
  let artifactsData = [];
  let artifactsTab = 'all';

  async function refreshArtifacts() {
    try {
      const res = await fetch('/api/artifacts');
      const data = await res.json();
      artifactsData = data.artifacts || [];
      renderArtifacts();
    } catch (err) {
      const el = document.getElementById('artifacts-content');
      if (el) el.innerHTML = '<div class="empty">Failed to load artifacts.</div>';
    }
  }

  function renderArtifacts() {
    const el = document.getElementById('artifacts-content');
    if (!el) return;

    const filtered = artifactsTab === 'all' ? artifactsData : artifactsData.filter(a => a.type === artifactsTab);

    if (!filtered.length) {
      el.innerHTML = `<div class="empty">No ${artifactsTab === 'all' ? '' : artifactsTab.toUpperCase() + ' '}artifacts found. Click + New to generate one.</div>`;
      return;
    }

    const rows = filtered.map(a => `
      <tr>
        <td class="num">${String(a.number).padStart(4, '0')}</td>
        <td><span class="type-badge ${esc(a.type)}">${esc(a.type.toUpperCase())}</span></td>
        <td>${esc(a.title)}</td>
        <td><span class="badge badge-${esc(a.status)}">${esc(a.status)}</span></td>
        <td style="font-size:11px;color:var(--text-dim)">${esc(a.relativePath)}</td>
      </tr>`).join('');

    el.innerHTML = `<table class="artifact-table">
      <thead><tr><th>#</th><th>Type</th><th>Title</th><th>Status</th><th>Path</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function initArtifactForm() {
    const newBtn = document.getElementById('artifact-new-btn');
    const form = document.getElementById('artifact-form');
    const cancelBtn = document.getElementById('artifact-cancel-btn');
    const submitBtn = document.getElementById('artifact-submit-btn');
    const feedback = document.getElementById('artifact-feedback');

    if (!newBtn || !form) return;

    newBtn.addEventListener('click', () => {
      form.classList.toggle('hidden');
      feedback.textContent = '';
      feedback.className = 'feedback';
    });

    cancelBtn.addEventListener('click', () => {
      form.classList.add('hidden');
    });

    submitBtn.addEventListener('click', async () => {
      const type = document.getElementById('artifact-type').value;
      const title = document.getElementById('artifact-title').value.trim();
      const owner = document.getElementById('artifact-owner').value.trim();
      if (!title) { feedback.textContent = 'Title is required.'; feedback.className = 'feedback error'; return; }
      feedback.textContent = 'Generating…';
      feedback.className = 'feedback';
      try {
        const result = await postJson('/api/artifacts', { type, title, fields: { owner } });
        feedback.textContent = `Created ${result.relativePath}`;
        document.getElementById('artifact-title').value = '';
        document.getElementById('artifact-owner').value = '';
        await refreshArtifacts();
      } catch (err) {
        feedback.textContent = err.message;
        feedback.className = 'feedback error';
      }
    });

    // Artifact type tabs
    document.querySelectorAll('[data-atab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-atab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        artifactsTab = btn.dataset.atab;
        renderArtifacts();
      });
    });
  }

  // ── Approvals ─────────────────────────────────────────────────────────
  async function refreshApprovals() {
    try {
      const res = await fetch('/api/approvals');
      const data = await res.json();
      renderApprovals(data.items || []);
    } catch {
      const el = document.getElementById('approvals-content');
      if (el) el.innerHTML = '<div class="empty">Failed to load approval queue.</div>';
    }
  }

  function renderApprovals(items) {
    const el = document.getElementById('approvals-content');
    if (!el) return;

    if (!items.length) {
      el.innerHTML = '<div class="empty">No pending approvals.</div>';
      return;
    }

    el.innerHTML = items.map(item => `
      <div class="approval-item" data-id="${esc(item.id)}">
        <div class="approval-meta">${esc(item.id)} · ${item.pattern ? 'pattern: ' + esc(item.pattern) : ''} · enqueued ${new Date(item.enqueuedAt).toLocaleTimeString()}</div>
        <div class="approval-action">${esc(item.action || item.description || JSON.stringify(item))}</div>
        <div class="approval-btns">
          <button class="btn-primary approval-approve" data-id="${esc(item.id)}">Approve</button>
          <button class="btn-ghost approval-reject" data-id="${esc(item.id)}">Reject</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('.approval-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await postJson('/api/approvals', { action: 'approve', id: btn.dataset.id });
          await refreshApprovals();
        } catch (err) { alert(err.message); }
      });
    });

    el.querySelectorAll('.approval-reject').forEach(btn => {
      btn.addEventListener('click', async () => {
        const note = prompt('Rejection reason (optional):') || '';
        try {
          await postJson('/api/approvals', { action: 'reject', id: btn.dataset.id, note });
          await refreshApprovals();
        } catch (err) { alert(err.message); }
      });
    });
  }

  // ── Snapshots ─────────────────────────────────────────────────────────
  async function refreshSnapshots() {
    try {
      const res = await fetch('/api/snapshots');
      const data = await res.json();
      renderSnapshots(data.snapshots || []);
    } catch {
      const el = document.getElementById('snapshots-content');
      if (el) el.innerHTML = '<div class="empty">Failed to load snapshots.</div>';
    }
  }

  function renderSnapshots(snapshots) {
    const el = document.getElementById('snapshots-content');
    if (!el) return;

    if (!snapshots.length) {
      el.innerHTML = '<div class="empty">No snapshots recorded yet. Start embed mode to begin capturing snapshots.</div>';
      return;
    }

    el.innerHTML = snapshots.map((s, i) => {
      const ts = s.capturedAt ? new Date(s.capturedAt).toLocaleString() : '—';
      const providers = Array.isArray(s.providers) ? s.providers.join(', ') : '—';
      const summary = s.markdown ? s.markdown.slice(0, 300) + (s.markdown.length > 300 ? '…' : '') : JSON.stringify(s).slice(0, 200);
      return `<div class="snapshot-card">
        <div class="snapshot-header">
          <span class="snapshot-ts">${esc(ts)}</span>
          <span class="snapshot-providers">providers: ${esc(providers)}</span>
        </div>
        <div class="snapshot-summary">${esc(summary)}</div>
      </div>`;
    }).join('');
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (data.configured && !data.authenticated) {
        showLoginOverlay();
      }
    } catch { /* server may be starting */ }
  }

  function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function initLogin() {
    const submit = document.getElementById('login-submit');
    const input = document.getElementById('login-token');
    const errEl = document.getElementById('login-error');
    if (!submit || !input) return;

    async function doLogin() {
      errEl.classList.add('hidden');
      try {
        const res = await postJson('/api/auth/login', { token: input.value });
        if (res.success) {
          hideLoginOverlay();
          refresh(); refreshRegistry(); refreshArtifacts(); refreshApprovals(); refreshSnapshots();
        }
      } catch {
        errEl.classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    }

    submit.addEventListener('click', doLogin);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  // ── Chat ──────────────────────────────────────────────────────────────
  let chatConvId = null;
  let chatStreaming = false;

  function appendChatBubble(role, text, streaming = false) {
    const el = document.getElementById('chat-messages');
    if (!el) return null;
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}${streaming ? ' streaming' : ''}`;
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function setChatStatus(text) {
    const el = document.getElementById('chat-status');
    if (el) el.textContent = text;
  }

  function initChat() {
    const sendBtn = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (!sendBtn || !input) return;

    async function sendMessage() {
      const message = input.value.trim();
      if (!message || chatStreaming) return;
      input.value = '';
      input.style.height = '';

      appendChatBubble('user', message);
      const assistantBubble = appendChatBubble('assistant', '', true);
      chatStreaming = true;
      sendBtn.disabled = true;
      setChatStatus('Thinking…');

      const params = new URLSearchParams({ message });
      if (chatConvId) params.set('id', chatConvId);

      try {
        const es = new EventSource('/api/chat/stream?' + params.toString());
        let responseText = '';

        es.addEventListener('message', e => {
          const evt = JSON.parse(e.data);
          if (evt.id && !chatConvId) chatConvId = evt.id;

          if (evt.type === 'chunk') {
            responseText += evt.text;
            if (assistantBubble) assistantBubble.textContent = responseText;
            const msgEl = document.getElementById('chat-messages');
            if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
          } else if (evt.type === 'done') {
            es.close();
            if (assistantBubble) assistantBubble.classList.remove('streaming');
            chatStreaming = false;
            sendBtn.disabled = false;
            setChatStatus('');
          } else if (evt.type === 'error') {
            if (assistantBubble) { assistantBubble.textContent = evt.text; assistantBubble.classList.remove('streaming'); }
            es.close();
            chatStreaming = false;
            sendBtn.disabled = false;
            setChatStatus('Error — check that the claude CLI is installed and authenticated.');
          }
        });

        es.onerror = () => {
          es.close();
          chatStreaming = false;
          sendBtn.disabled = false;
          setChatStatus('Connection error.');
        };
      } catch (err) {
        chatStreaming = false;
        sendBtn.disabled = false;
        setChatStatus('Failed: ' + err.message);
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // ── Config editor ─────────────────────────────────────────────────────
  async function refreshConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const envEl = document.getElementById('config-env-content');
      const embedEl = document.getElementById('config-embed-content');
      if (envEl) envEl.innerHTML = `<textarea class="config-editor" id="config-env-editor">${esc(data.env || '')}</textarea>`;
      if (embedEl) embedEl.innerHTML = `<textarea class="config-editor" id="config-embed-editor">${esc(data.embed || '')}</textarea>`;
    } catch {
      const envEl = document.getElementById('config-env-content');
      if (envEl) envEl.innerHTML = '<div class="empty">Failed to load config.</div>';
    }
  }

  // ── Knowledge panel ──────────────────────────────────────────────────

  function initKnowledgeTabs() {
    document.querySelectorAll('#knowledge-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#knowledge-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ktab;
        document.querySelectorAll('#section-knowledge .tab-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById('knowledge-tab-' + tab);
        if (panel) panel.classList.add('active');
        if (tab === 'trends') loadKnowledgeTrends();
        if (tab === 'index') loadKnowledgeIndex();
      });
    });
  }

  async function loadKnowledgeTrends() {
    const el = document.getElementById('knowledge-trends-content');
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const res = await authFetch('/api/knowledge/trends');
      if (!res.ok) { el.innerHTML = '<div class="error">Failed to load trends</div>'; return; }
      const report = await res.json();
      el.innerHTML = renderTrendReport(report);
    } catch (e) {
      el.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  }

  function renderTrendReport(report) {
    const parts = [];

    if (report.hotTopics?.length) {
      parts.push('<div class="agent-group"><div class="group-header"><span>Hot Topics</span></div>');
      parts.push('<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px">');
      for (const t of report.hotTopics) {
        const size = Math.round(11 + t.weightedFrequency * 4);
        parts.push(`<span style="font-size:${Math.min(size,20)}px;color:var(--accent)">${esc(t.term)}</span>`);
      }
      parts.push('</div></div>');
    }

    if (report.recurringPatterns?.length) {
      parts.push('<div class="agent-group"><div class="group-header"><span>Recurring Patterns</span></div>');
      for (const p of report.recurringPatterns) {
        parts.push(`<div class="agent-item"><span class="agent-name">${esc(p.summary)}</span>`);
        parts.push(`<span class="badge badge-healthy">×${p.count}</span>`);
        if (p.roles?.length) parts.push(`<span style="font-size:11px;color:var(--text-muted)">${esc(p.roles.join(', '))}</span>`);
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    if (report.escalatingRisks?.length) {
      parts.push('<div class="agent-group"><div class="group-header"><span>Escalating Risks</span></div>');
      for (const r of report.escalatingRisks) {
        parts.push(`<div class="agent-item"><span class="agent-name">${esc(r.summary)}</span>`);
        parts.push(`<span class="badge badge-degraded">↑ ${r.escalationScore}×</span>`);
        parts.push(`<span style="font-size:11px;color:var(--text-muted)">${r.recentCount} recent / ${r.olderCount} older</span>`);
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    if (report.decisionDrift?.length) {
      parts.push('<div class="agent-group"><div class="group-header"><span>Decision Drift</span></div>');
      for (const d of report.decisionDrift) {
        parts.push(`<div class="agent-item"><span class="agent-name">${esc(d.decision.summary)}</span>`);
        parts.push(`<span class="badge badge-unavailable">drift ${d.driftScore}</span>`);
        const conflicts = (d.conflictingObservations || []).map(c => esc(c.summary)).join('; ');
        if (conflicts) parts.push(`<div style="font-size:11px;color:var(--text-muted);padding:4px 0">${conflicts}</div>`);
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    if (!parts.length) return '<div class="empty-state">No trends detected yet — add observations to build the knowledge base.</div>';
    parts.push(`<div style="font-size:11px;color:var(--text-muted);padding:8px 14px">Generated ${report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''}</div>`);
    return parts.join('');
  }

  async function loadKnowledgeIndex() {
    const el = document.getElementById('knowledge-index-content');
    if (!el) return;
    el.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const res = await authFetch('/api/knowledge/index');
      if (!res.ok) { el.innerHTML = '<div class="error">Failed to load index</div>'; return; }
      const data = await res.json();
      const rows = Object.entries(data.sources || {})
        .map(([src, count]) => `<div class="agent-item"><span class="agent-name">${esc(src)}</span><span class="badge badge-healthy">${count} chunks</span></div>`)
        .join('');
      el.innerHTML = `<div class="agent-group"><div class="group-header"><span>Corpus — ${data.total} total chunks</span></div>${rows}</div>`;
    } catch (e) {
      el.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  }

  function initKnowledgeAsk() {
    const btn = document.getElementById('knowledge-ask-btn');
    const input = document.getElementById('knowledge-question');
    if (!btn || !input) return;

    async function doAsk() {
      const question = input.value.trim();
      if (!question) return;
      const loading = document.getElementById('knowledge-ask-loading');
      const answerDiv = document.getElementById('knowledge-answer');
      const answerText = document.getElementById('knowledge-answer-text');
      const sourcesDiv = document.getElementById('knowledge-sources');

      loading.style.display = 'block';
      answerDiv.style.display = 'none';
      btn.disabled = true;

      try {
        const res = await authFetch('/api/knowledge/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const data = await res.json();
        answerText.textContent = data.answer || '(no answer)';
        if (data.sources?.length) {
          sourcesDiv.innerHTML = '<strong>Sources:</strong> ' +
            data.sources.slice(0, 5).map(s =>
              `<span style="margin-right:8px">[${esc(s.source)}] ${esc(s.title)}</span>`
            ).join('');
        } else {
          sourcesDiv.innerHTML = '';
        }
        answerDiv.style.display = 'block';
      } catch (e) {
        answerText.textContent = 'Error: ' + e.message;
        answerDiv.style.display = 'block';
      } finally {
        loading.style.display = 'none';
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', doAsk);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });

    document.getElementById('knowledge-trends-refresh')?.addEventListener('click', loadKnowledgeTrends);
    document.getElementById('knowledge-index-refresh')?.addEventListener('click', loadKnowledgeIndex);
  }

  function initConfigEditor() {
    const envSave = document.getElementById('config-env-save');
    const embedSave = document.getElementById('config-embed-save');
    const envFb = document.getElementById('config-env-feedback');
    const embedFb = document.getElementById('config-embed-feedback');

    if (envSave) {
      envSave.addEventListener('click', async () => {
        const editor = document.getElementById('config-env-editor');
        if (!editor) return;
        try {
          await postJson('/api/config', { type: 'env', content: editor.value });
          envFb.textContent = 'Saved.'; envFb.className = 'feedback';
          setTimeout(() => { envFb.textContent = ''; }, 3000);
        } catch (err) { envFb.textContent = err.message; envFb.className = 'feedback error'; }
      });
    }

    if (embedSave) {
      embedSave.addEventListener('click', async () => {
        const editor = document.getElementById('config-embed-editor');
        if (!editor) return;
        try {
          await postJson('/api/config', { type: 'embed', content: editor.value });
          embedFb.textContent = 'Saved.'; embedFb.className = 'feedback';
          setTimeout(() => { embedFb.textContent = ''; }, 3000);
        } catch (err) { embedFb.textContent = err.message; embedFb.className = 'feedback error'; }
      });
    }

    // Config tabs
    document.querySelectorAll('[data-ctab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ctab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ctab;
        document.querySelectorAll('#config-tabs').forEach(() => {});
        ['env', 'embed'].forEach(t => {
          const panel = document.getElementById(`config-tab-${t}`);
          if (panel) panel.classList.toggle('active', t === tab);
        });
      });
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────────
  function init() {
    initNav();
    initTabs();
    initArtifactForm();
    initLogin();
    initChat();
    initKnowledgeTabs();
    initKnowledgeAsk();
    initConfigEditor();
    checkAuth();
    refresh();
    refreshRegistry();
    refreshArtifacts();
    refreshApprovals();
    refreshSnapshots();
    refreshConfig();
    connectSSE();
    setInterval(refresh, 10000);
    setInterval(refreshRegistry, 30000);
    setInterval(refreshArtifacts, 30000);
    setInterval(refreshApprovals, 15000);
    setInterval(refreshSnapshots, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
