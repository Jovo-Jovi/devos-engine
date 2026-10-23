/* DEV_OS guided UI. Vanilla JS, no build step, no CDN, no remote font.
   Keyboard: Up/Down move between focusable choices, Enter confirms, Esc goes back. */
(() => {
  const S = {
    data: null,          // /api/state payload
    draft: null,
    stepIndex: 0,
    running: false,
    final: null,
    done: false,
    progress: null,      // latest /api/events progress snapshot
    proposal: null,      // a waiting fix-proposal from the consultation
    keysIntake: null,    // a waiting keys intake: {missing, unconfirmed, repo, round, total, sources}
    showResume: false,   // the continue card (a started project was found)
    resumeDismissed: false,
  };
  const $main = document.getElementById('main');
  const $railSteps = document.getElementById('rail-steps');
  const $aside = document.getElementById('aside-list');
  const $foot = document.getElementById('rail-foot');
  const PHASES = { 'writing-project': 'Writing project', 'creating-github': 'Creating GitHub', repairing: 'Repairing', 'usage-limit': 'Waiting on usage limit' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- icons ----------
  // Thin-line SVG icons (hairline style): one accent, stroke only, no emoji, no images.
  const ICONS = {
    dot: '<circle cx="12" cy="12" r="4"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/>',
    terminal: '<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
    sparkles: '<path d="m12 4 1.8 4.6L18 10l-4.2 1.4L12 16l-1.8-4.6L6 10l4.2-1.4L12 4Z"/><path d="m19 15 .9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15Z"/>',
    tag: '<path d="M3 12V4h8l9 9-8 8-9-9Z"/><circle cx="8" cy="8" r="1.4"/>',
    repo: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    box: '<path d="m21 8-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 20V9"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/>',
    code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13 5-2 14"/>',
    droplet: '<path d="M12 3s6 6.2 6 10.2a6 6 0 1 1-12 0C6 9.2 12 3 12 3Z"/>',
    components: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><circle cx="16.8" cy="6.8" r="3.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="3.75"/><rect x="13" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flask: '<path d="M10 3h4"/><path d="M10 3v6L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7.5 15h9"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M6.5 7.5h1"/><path d="M6.5 16.5h1"/>',
    activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M17.5 14.7c2 .8 3.5 2.6 3.5 5.3"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M12 13h6v5h-6z"/>',
    megaphone: '<path d="M3 11v3"/><path d="m3 11 13-5v12L3 14v-3Z"/><path d="M16 8.5c2 .5 3.5 1.8 3.5 3.5s-1.5 3-3.5 3.5"/><path d="m6.5 14.5 1.5 5.5"/>',
    gauge: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="m12 12 4.5-4.5"/>',
    store: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M5 11v9h14v-9"/><path d="M9 20v-5h6v5"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.6 11h10.8L21 8H6"/>',
    plug: '<path d="M9 7V3"/><path d="M15 7V3"/><path d="M7 7h10v4a5 5 0 0 1-10 0V7Z"/><path d="M12 16v5"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    bolt: '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>',
  };
  const icon = (name) => `<svg class="s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;
  const MODULE_ICON = { language: 'code', styling: 'droplet', 'ui-kit': 'components', database: 'database', auth: 'shield', storage: 'archive', payments: 'card', email: 'mail', jobs: 'clock', search: 'search', 'product-ai': 'sparkles', i18n: 'globe', testing: 'flask', hosting: 'server', observability: 'activity', automation: 'gear' };
  const TYPE_ICON = { saas: 'users', 'web-app': 'window', marketing: 'megaphone', dashboard: 'gauge', marketplace: 'store', commerce: 'cart', api: 'plug', mobile: 'phone', 'ai-product': 'sparkles', realtime: 'bolt', docs: 'repo', cli: 'terminal', library: 'box', worker: 'gear', extension: 'layout', full: 'layers' };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok && !body.error) body.error = `Request failed with status ${r.status}.`;
    return body;
  }

  // A draft saved by an older engine must never blank the page. Every field the
  // renderers touch is filled from this shape before anything renders.
  function normalizeDraft(d) {
    d = d && typeof d === 'object' ? d : {};
    const m = d.models && typeof d.models === 'object' ? d.models : {};
    const row = (x) => (x && typeof x === 'object' ? { cli: x.cli || null, model: x.model || null } : { cli: null, model: null });
    const lr = m.lightReviewer && typeof m.lightReviewer === 'object' ? { same: m.lightReviewer.same !== false, cli: m.lightReviewer.cli || null, model: m.lightReviewer.model || null } : { same: true, cli: null, model: null };
    return {
      schema: d.schema || 'devos/draft@1',
      theme: d.theme === 'light' ? 'light' : 'dark',
      models: {
        reviewer: row(m.reviewer),
        builder: row(m.builder),
        extraBuilders: Array.isArray(m.extraBuilders) ? m.extraBuilders : [],
        lightReviewer: lr,
        pickPolicy: m.pickPolicy || 'reviewer-picks',
        configurationModel: row(m.configurationModel),
      },
      saveDefaults: Boolean(d.saveDefaults),
      project: {
        name: (d.project && d.project.name) || '',
        slug: (d.project && d.project.slug) || '',
        brief: (d.project && d.project.brief) || '',
        audience: (d.project && d.project.audience) || '',
        visibility: (d.project && d.project.visibility) || 'private',
        docs: Array.isArray(d.project && d.project.docs) ? d.project.docs : [],
      },
      type: d.type || 'full',
      framework: d.framework || 'next',
      customCommands: { install: '', typecheck: '', lint: '', test: '', build: '', e2e: '', ...((d.customCommands && typeof d.customCommands === 'object' && d.customCommands) || {}) },
      modules: (d.modules && typeof d.modules === 'object' && d.modules) || {},
      languages: Array.isArray(d.languages) && d.languages.length ? d.languages : ['en'],
      touched: { framework: false, modules: false, ...((d.touched && typeof d.touched === 'object' && d.touched) || {}) },
    };
  }

  function showFatal(message) {
    $main.innerHTML = `
      <h1>The guided UI could not load</h1>
      <p class="lede">The engine answered with an error, so the page stopped before drawing anything.</p>
      <div class="card"><p class="error-line">${esc(message)}</p>
      <p>Open this address again, or close this tab and run start.bat / start.sh once more.</p></div>
      <div class="actions"><button class="primary" id="retry-load">Try again</button></div>`;
    const btn = document.getElementById('retry-load');
    if (btn) btn.onclick = () => load(false);
  }

  function saveDraft() {
    const body = JSON.stringify(S.draft);
    navigator.sendBeacon && navigator.sendBeacon('/api/draft', new Blob([body], { type: 'application/json' }));
    return fetch('/api/draft', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  }

  function touched(node) { node.addEventListener('change', saveDraft); }

  // ---------- rail ----------
  function railState(i) {
    if (S.stepIndex > i) return 'done';
    if (S.stepIndex === i) return 'now';
    return 'waiting';
  }
  function renderRail() {
    const steps = S.data.steps;
    let html = '';
    steps.forEach((s, i) => {
      if (S.running || S.done) {
        html += `<li class="${railState(i)}">${esc(s.title)}</li>`;
      } else {
        html += `<li class="${railState(i)}">${esc(s.title)}</li>`;
      }
    });
    if (S.running || S.done) {
      const phaseDefs = [
        ['writing-project', 'Writing project'],
        ['assessing', 'Checking for misses'],
        ['installing', 'Installing dependencies'],
        ['creating-github', 'Creating GitHub'],
        ['syncing-repo', 'Syncing the repository'],
        ['consulting', 'Consulting the model'],
        ['applying-fix', 'Applying the fix'],
        ['restarting-cycle', 'Starting a fresh cycle'],
        ['watching-cycle', 'Watching the new cycle'],
        ['cycle-report', 'Writing the cycle report'],
      ];
      for (const [id, label] of phaseDefs) {
        let cls = 'waiting';
        const seen = (S.events || []).some((e) => (id === 'creating-github' ? e.type === 'github' || e.name === 'creating-github' : e.name === id || (id === 'writing-project' && (e.name === 'writing-project' || e.type === 'file'))));
        if (!seen) continue; // continue-only phases stay hidden unless this run used them
        const current = S.running && phaseNow() === id;
        if (current) cls = 'phase-now';
        else cls = 'done';
        html += `<li class="${cls}">${label}</li>`;
      }
    }
    $railSteps.innerHTML = html;
    const theme = S.draft && S.draft.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.getElementById('theme').textContent = theme === 'light' ? 'Dark' : 'Light';
  }
  // The phase that is live RIGHT NOW: the last phase event wins (assessing
  // during a continue, syncing-repo after a repair, ...). The old version
  // defaulted to writing-project, which painted "Checking for misses" as done
  // the instant a continue run started — the opposite of what it felt like.
  function phaseNow() {
    const evs = S.events || [];
    const last = [...evs].reverse().find((e) => e.type === 'phase' && e.name);
    if (last) return last.name;
    if (evs.some((e) => e.type === 'github' || e.name === 'creating-github')) return 'creating-github';
    if (evs.some((e) => e.name === 'writing-project' || e.type === 'file')) return 'writing-project';
    return 'writing-project';
  }

  function renderAside() {
    if (!S.draft) return;
    const rows = summaryRows();
    $aside.innerHTML = rows.map((r) => `<div><dt>${icon(r.typeIcon || r.icon)}${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('');
  }

  function summaryRows() {
    const d = S.draft, m = d.models;
    const rows = [];
    const val = (x) => (x && x.cli && x.model ? `${x.cli} · ${x.model}` : null);
    const t = S.data.types.find((x) => x.id === d.type) || {};
    const st = S.data.stacks.find((x) => x.id === d.framework) || {};
    rows.push({ icon: 'eye', label: 'Reviewer', value: val(m.reviewer) || 'not chosen' });
    rows.push({ icon: 'terminal', label: 'Builder', value: val(m.builder) || 'not chosen' });
    if ((m.extraBuilders || []).length) {
      for (const b of m.extraBuilders) rows.push({ icon: 'layers', label: 'Extra builder', value: `${b.cli || '?'} · ${b.model || '?'}${b.strength ? ` (${b.strength})` : ''}` });
    } else {
      rows.push({ icon: 'layers', label: 'Extra builders', value: 'none' });
    }
    rows.push({ icon: 'check', label: 'Light reviewer', value: m.lightReviewer.same ? 'same as the reviewer' : (val(m.lightReviewer) || 'not chosen') });
    rows.push({ icon: 'sparkles', label: 'Configuration model', value: val(m.configurationModel) ? `${val(m.configurationModel)} (runs once)` : 'not chosen' });
    rows.push({ icon: 'tag', label: 'Name', value: d.project.name || 'not set' });
    rows.push({ icon: 'repo', label: 'Repository', value: d.project.slug ? `${d.project.slug} (${d.project.visibility})` : 'not set' });
    rows.push({ icon: 'box', label: 'Attached docs', value: (d.project.docs || []).length ? (d.project.docs || []).map((x) => x.name).join(', ') : 'none' });
    rows.push({ icon: TYPE_ICON[d.type] || 'box', typeIcon: TYPE_ICON[d.type] || 'box', label: 'Type', value: t.label || d.type });
    rows.push({ icon: 'layout', label: 'Framework', value: st.label || d.framework });
    for (const mod of S.data.modules) {
      const s = d.modules[mod.id];
      if (!s) continue;
      if (mod.id === 'automation') { rows.push({ icon: 'gear', label: 'Automation', value: 'always on' }); continue; }
      if (mod.id === 'language') { rows.push({ icon: 'code', label: 'Language', value: s.provider || 'typescript' }); continue; }
      if (mod.id === 'testing') { rows.push({ icon: 'flask', label: 'Testing', value: s.playwright ? 'unit + playwright' : 'unit' }); continue; }
      if (!s.on) continue;
      const pv = (mod.providers || []).find((p) => p.id === s.provider);
      let v = pv ? pv.label : (s.provider || '');
      if (s.impl && s.impl !== 'none') {
        const ip = (mod.implProviders || []).find((p) => p.id === s.impl);
        v += ` · ${ip ? ip.label : s.impl}`;
      }
      rows.push({ icon: MODULE_ICON[mod.id] || 'dot', label: mod.label, value: v || 'on' });
    }
    rows.push({ icon: 'globe', label: 'Languages', value: (d.languages || []).join(', ') || 'en' });
    return rows;
  }

  // moduleSummary kept for the summary step's module jump-link logic.

  // ---------- step renderers ----------
  const renderers = {
    machine() {
      const mc = S.data.machine || { rows: [], blocks: [], ready: false };
      const rows = (mc.rows || []).map((r) => `
        <tr><td>${esc(r.label)}</td><td>${esc(r.detail)}</td>
        <td class="state-${esc(r.state)}">${r.state === 'ready' ? 'ready' : r.state === 'blocked' ? 'blocked' : r.state === 'signed-out' ? 'signed out' : r.state}</td></tr>`).join('')
        || '<tr><td colspan="3">No machine information came back. Press Re-check.</td></tr>';
      return `
        <h1>Machine check</h1>
        <p class="lede">DEV_OS runs on this computer and drives GitHub with your existing gh login. Nothing is created until you confirm the summary.</p>
        <div class="card"><table class="status">${rows}</table></div>
        ${mc.blocks.length ? mc.blocks.map((b) => `<p class="error-line">${esc(b)} Fix it, then press Re-check.</p>`).join('') : '<p class="ok-line">This machine can run devos init.</p>'}
        <div class="actions">
          <button class="primary" id="next" ${mc.ready ? '' : 'disabled'}>Continue</button>
          <button class="ghost" id="recheck">Re-check</button>
        </div>`;
    },
    intro() {
      return `
        <h1>How this works</h1>
        <p class="lede">Two stages, in order. They do not overlap.</p>
        <div class="card"><p>You choose the reviewer, the builder, and the configuration model.</p></div>
        <div class="card"><p>You choose the project type and the core modules.</p></div>
        <div class="card"><p>The configuration model writes the project from those answers and creates the GitHub repository. It runs once, then stops.</p></div>
        <div class="card"><p>GitHub Actions then continues with the reviewer and the builder. Secret values are typed only into gh's own prompt.</p></div>
        <div class="actions"><button class="primary" id="next">Continue</button></div>`;
    },
    models() {
      const githubAgents = S.data.agents.filter((a) => a.status === 'installed' && a.githubCapable && a.promptTemplate);
      const anyAgents = S.data.agents.filter((a) => a.status === 'installed' && a.promptTemplate);
      const m = S.draft.models;
      const rec = S.data.recommendation || null;
      // Preselect the strongest signed-in model for the one run that writes the
      // whole project. A pick the user made manually (_touched) is never replaced.
      if (rec && !m.configurationModel.cli && !m.configurationModel._touched) {
        m.configurationModel.cli = rec.cli;
        m.configurationModel.model = rec.model;
        m.configurationModel._touched = true;
      }
      const ready = m.reviewer.cli && m.reviewer.model && m.builder.cli && m.builder.model && m.configurationModel.cli && m.configurationModel.model
        && (m.extraBuilders || []).every((b) => b.cli && b.model);
      const selfGrade = m.reviewer.cli && m.builder.cli && m.reviewer.cli === m.builder.cli && m.reviewer.model === m.builder.model;
      return `
        <h1>Models</h1>
        <p class="lede">Selection happens only here. The configuration model runs once now; the reviewer and builder run on GitHub after the repository exists.</p>
        ${modelRow('reviewer', 'After GitHub exists, this model reviews every task and writes the next task.', githubAgents)}
        ${modelRow('builder', 'After GitHub exists, this model writes the code. This row is the default builder.', githubAgents)}
        <div class="card">
          <h3>Extra builders <span class="badge">optional</span></h3>
          <p class="consequence">Each extra row is a builder the reviewer may pick, with a strength you can edit.</p>
          <div id="extra-builders">${(m.extraBuilders || []).map((b, i) => extraBuilderRow(b, i)).join('')}</div>
          <div class="actions" style="margin-top:10px"><button class="ghost" id="add-builder">Add another builder</button></div>
        </div>
        ${modelRow('lightReviewer', 'Optional second model for risk 1 and 2 tasks when no critical path changed. Default: same as the reviewer.', githubAgents, { sameToggle: true })}
        <div class="card">
          <h3>Who picks the builder on later tasks</h3>
          <p class="consequence">An id outside the pool falls back to the default builder, and the run log says why.</p>
          ${S.data.pickPolicies.map((p, i) => `
            <label class="checkline"><input type="radio" name="pickPolicy" value="${esc(p.id)}" ${m.pickPolicy === p.id || (!m.pickPolicy && i === 0) ? 'checked' : ''}>
            <span>${esc(p.label)}</span></label>`).join('')}
        </div>
        ${modelRow('configurationModel', 'This model runs once. It uses your answers, your attached documents, and the core modules to write the project and create the GitHub repository. It does not build later tasks. Only tools installed and signed in on this computer.', anyAgents, { allowLocal: true, rec })}
        ${selfGrade ? '<p class="warn-line">This model would be grading its own work. You can continue.</p>' : ''}
        <div class="actions">
          <button class="ghost" id="back">Back</button>
          <button class="primary" id="next" ${ready ? '' : 'disabled'}>Next</button>
        </div>
        ${ready ? '' : '<p class="hint">Next stays disabled until the reviewer, the builder, and the configuration model each have a tool and a model id.</p>'}`;
    },
    project() {
      const p = S.draft.project;
      const docs = p.docs || [];
      const fmtSize = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
      return `
        <h1>Project</h1>
        <p class="lede">These answers are the only product brief the configuration model receives. Nothing is created until you confirm.</p>
        <div class="card">
          <label class="field"><span>Name</span><input type="text" id="f-name" value="${esc(p.name)}" placeholder="Order Desk"></label>
          <label class="field"><span>Live slug owner/name</span><input type="text" id="f-slug" value="${esc(p.slug)}" placeholder="octodev/order-desk"></label>
          <label class="field"><span>One-paragraph brief</span><textarea id="f-brief" placeholder="What the product does, for whom, and the one behavior that matters most.">${esc(p.brief)}</textarea></label>
          <label class="field"><span>Who it is for</span><input type="text" id="f-audience" value="${esc(p.audience)}" placeholder="Small shops that take phone orders"></label>
          <div class="field"><span>Visibility</span>
            <label class="checkline"><input type="radio" name="visibility" value="private" ${p.visibility !== 'public' ? 'checked' : ''}><span>private</span></label>
            <label class="checkline"><input type="radio" name="visibility" value="public" ${p.visibility === 'public' ? 'checked' : ''}><span>public</span></label>
            <p class="consequence">Defaults from your machine profile, otherwise private.</p>
          </div>
        </div>
        <div class="card">
          <h3>Attach documentation <span class="badge">optional</span></h3>
          <p class="consequence">Upload any documents you already have — specs, PRDs, notes, FAQs. The configuration model reads every attached file, compares it with your answers, and collects anything still missing as questions for you (in devos/OPEN_QUESTIONS.md and the setup issue). It never invents product facts that are not in your answers or documents.</p>
          <label class="field"><span>Files (.md, .txt, .csv, .json, .yaml, .rst, .adoc, .html — text formats only)</span>
            <input type="file" id="f-docs" multiple accept=".md,.markdown,.txt,.text,.rst,.adoc,.csv,.tsv,.json,.yaml,.yml,.log,.html,.xml,.tex">
          </label>
          <p class="consequence">For a PDF or Word file, save or export it as .md or .txt first — this step reads text. Up to 8 files, 120,000 characters each.</p>
          <div id="docs-list">${docs.map((d, i) => `
            <div class="doc-row"><span class="doc-name mono">${esc(d.name)}</span><span class="doc-size">${fmtSize(d.size || (d.content || '').length)}</span><button type="button" class="ghost btn-small" data-doc-remove="${i}">Remove</button></div>`).join('')}</div>
          <label class="field"><span>Or paste notes here</span><textarea id="f-docs-paste" placeholder="Paste any extra context — requirements, edge cases, tone of voice..."></textarea></label>
          <div class="actions" style="margin-top:8px"><button class="ghost" id="f-docs-add-paste">Add pasted notes</button></div>
        </div>
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="next">Next</button></div>`;
    },
    type() {
      return `
        <h1>Project type</h1>
        <p class="lede">One card. It preselects a framework and modules; you can change those next. Changing type updates only recommendations you have not touched.</p>
        <div class="cards">
        ${S.data.types.map((t) => `
          <div class="card ${S.draft.type === t.id ? 'selected' : ''}" data-type="${esc(t.id)}" tabindex="0" role="button" aria-pressed="${S.draft.type === t.id}">
            <h3>${icon(TYPE_ICON[t.id] || 'box')}${esc(t.label)}</h3><p class="line">${esc(t.line)}</p>
          </div>`).join('')}
        </div>
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="next">Next</button></div>`;
    },
    framework() {
      const fits = (S.data.types.find((t) => t.id === S.draft.type) || {}).id;
      const cards = S.data.stacks.filter((s) => s.fits.includes(fits));
      const cmdLine = (c) => [c.install && `install: ${c.install}`, c.typecheck && `typecheck: ${c.typecheck}`, c.lint && `lint: ${c.lint}`, c.test && `test: ${c.test}`, c.build && `build: ${c.build}`].filter(Boolean).join(' · ');
      const isCustom = S.draft.framework === 'custom';
      return `
        <h1>Framework</h1>
        <p class="lede">Cards filtered by the type. Each card shows the commands the cycle will run. The configuration model pins versions by running the package manager; it never invents numbers.</p>
        <div class="cards">
        ${cards.map((s) => `
          <div class="card ${S.draft.framework === s.id ? 'selected' : ''}" data-fw="${esc(s.id)}" tabindex="0" role="button" aria-pressed="${S.draft.framework === s.id}">
            <h3>${esc(s.label)}</h3>
            <p class="line mono" style="font-size:.8em">${esc(cmdLine(s.commands))}</p>
            ${s.note ? `<p class="line">${esc(s.note)}</p>` : ''}
          </div>`).join('')}
        </div>
        ${isCustom ? `
        <div class="card">
          <h3>Custom commands</h3>
          <p class="consequence">These five commands run in the cycle. Fill them all.</p>
          ${['install', 'typecheck', 'lint', 'test', 'build'].map((k) => `
            <label class="field"><span>${k}</span><input type="text" data-cc="${k}" value="${esc(S.draft.customCommands[k] || '')}"></label>`).join('')}
        </div>` : ''}
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="next">Next</button></div>`;
    },
    modules() {
      const type = S.data.types.find((t) => t.id === S.draft.type) || {};
      const hasUi = Boolean(type.ui);
      const rows = S.data.modules.map((m) => {
        if (m.id === 'language') return languageRow(m);
        const hidden = m.hiddenWhenNoUi && !hasUi;
        const s = S.draft.modules[m.id] || { on: false };
        if (hidden) return '';
        if (m.id === 'automation') {
          return `<div class="mrow"><div class="mrow-head"><h3>${esc(m.label)}<span class="badge">always on</span></h3></div><p class="consequence">${esc(m.consequence)}</p></div>`;
        }
        if (m.id === 'i18n') {
          return `<div class="mrow"><div class="mrow-head"><label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" ${s.on ? 'checked' : ''}><i></i></label><h3>${esc(m.label)}</h3></div>
            <p class="consequence">${esc(m.consequence)}</p>
            <p class="consequence">${s.on ? 'The language codes are on the next step.' : 'Turn it on to serve more than one language. The codes are set on the next step.'}</p></div>`;
        }
        if (m.id === 'testing') {
          return `<div class="mrow"><div class="mrow-head"><label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" data-sub="unit" checked disabled><i></i></label><h3>${esc(m.label)}</h3></div>
            <p class="consequence">${esc(m.consequence)}</p>
            <div class="provider"><label class="checkline"><input type="checkbox" data-mod="testing" data-sub="playwright" ${s.playwright ? 'checked' : ''}><span>Playwright end-to-end</span></label></div></div>`;
        }
        const db = S.draft.modules.database || {};
        const providers = (m.providers || []).filter((pv) => {
          if (m.id === 'ui-kit' && pv.needs === 'react') return ['next', 'remix', 'vite-react'].includes(S.draft.framework);
          if (m.id === 'ui-kit' && pv.needs === 'svelte') return S.draft.framework === 'sveltekit';
          if (pv.needs === 'postgres') return Boolean(db.on && ['supabase', 'neon', 'postgres'].includes(db.provider));
          if (pv.needs === 'supabase') return Boolean(db.on && db.provider === 'supabase');
          if (pv.needs === 'firebase') return Boolean(db.on && db.provider === 'firebase');
          return true;
        });
        const impl = m.implProviders ? implRow(m, s) : '';
        return `<div class="mrow"><div class="mrow-head">
            <label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" ${s.on ? 'checked' : ''}><i></i></label>
            <h3>${esc(m.label)}</h3>
          </div>
          <p class="consequence">${esc(m.consequence)}</p>
          ${s.on ? `<div class="provider"><label class="field"><span>Provider</span>
            <select data-modp="${esc(m.id)}">${providers.map((pv) => `<option value="${esc(pv.id)}" ${s.provider === pv.id ? 'selected' : ''}>${esc(pv.label)}</option>`).join('')}</select></label>
            ${m.id === 'auth' && s.provider !== 'none' ? authImplRow(m, s) : ''}${m.id === 'product-ai' && s.provider !== 'none' ? aiImplRow(m, s) : ''}
          </div>` : ''}
          ${impl}</div>`;
      }).join('');
      return `
        <h1>Core modules</h1>
        <p class="lede">Each module off or on. Turning one on shows its provider. Database, auth, and hosting are not asked again later. Inactive modules leave no folders.</p>
        ${rows}
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="next">Next</button></div>`;
    },
    languages() {
      const multi = (S.draft.languages || []).length > 1;
      return `
        <h1>Languages</h1>
        <p class="lede">Comma-separated language codes. Default en.</p>
        <div class="card">
          <label class="field"><span>Language codes</span><input type="text" id="f-langs" value="${esc((S.draft.languages || []).join(', '))}"></label>
          <p class="consequence">${multi ? 'More than one language: the catalogue-parity guard is on.' : 'One language: the catalogue-parity guard stays off.'}</p>
        </div>
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="next">Next</button></div>`;
    },
    summary() {
      const rows = summaryRows();
      const jump = { models: 'Models', project: 'Project', type: 'Type', framework: 'Framework', modules: 'Modules', languages: 'Languages' };
      const seenSteps = new Set();
      const links = rows.filter((r) => jump[r.step] && !seenSteps.has(r.step) && seenSteps.add(r.step)).length
        ? [...new Set(rows.map((r) => r.step))].filter((s) => jump[s]).map((s) => `<button class="link" data-jump="${s}">edit ${jump[s]}</button>`).join(' · ')
        : '';
      return `
        <h1>Summary</h1>
        <p class="lede">Confirm is the first moment a project folder may exist. The configuration model writes the project from these answers and creates the GitHub repository. It may not swap the framework, add a module you turned off, or drop a module you turned on.</p>
        <div class="card">
          ${rows.map((r) => `<div class="checkline">${icon(r.typeIcon || r.icon)}<span class="s-label">${esc(r.label)}</span><span class="s-value">${esc(r.value)}</span></div>`).join('')}
        </div>
        <div class="card">
          <label class="checkline"><input type="checkbox" id="f-save-defaults" ${S.draft.saveDefaults ? 'checked' : ''}><span>Save these models as the default for the next project.</span></label>
        </div>
        <p class="hint">Jump back: ${links}</p>
        <div class="actions"><button class="ghost" id="back">Back</button><button class="primary" id="confirm">Confirm — write the project and create GitHub</button></div>`;
    },
    // The continue card: a started project was found (last run, or beside the
    // workspace). The checklist comes from the server's local assessment, so the
    // card states exactly what is done and what the continue run would finish.
    resume() {
      const c = (S.data.resume && S.data.resume.candidates || [])[0];
      if (!c) return renderers.models();
      const TICK = { done: '✓', todo: '▸', wait: '·', blocked: '!' };
      return `
        <h1>Continue where it stopped</h1>
        <p class="lede">A started DEV_OS project is here from an earlier run — an error, a usage limit, or a Stop. Nothing was lost. devos checks every step, finishes the missing ones itself (dependencies, GitHub — an existing repository is adopted), and only wakes the model when the project tree still fails its guards.</p>
        <div class="card resume-card">
          <div class="resume-head">
            <h3>${esc(c.name || c.slug || 'Started project')}</h3>
            <span class="badge">${c.doneCount} of ${c.steps.length} steps done</span>
          </div>
          <p class="mono hint">${esc(c.path)}</p>
          <ul class="resume-steps">
            ${(c.steps || []).map((s) => `<li class="${esc(s.state)}"><span class="tick">${TICK[s.state] || '·'}</span><span class="s-label">${esc(s.label)}</span>${s.detail ? `<span class="s-detail">${esc(s.detail)}</span>` : ''}</li>`).join('')}
          </ul>
          <div class="actions">
            <button class="primary" id="resume-continue" data-folder="${esc(c.path)}">▸ Continue ${esc(c.name || c.slug || 'this project')} — check for misses and finish</button>
            <button class="ghost" id="resume-dismiss">Start something new instead</button>
          </div>
        </div>
        <p class="hint">The same continue lives in the terminal: <code>devos continue "${esc(c.path)}"</code> (or <code>devos init --continue</code>, the same flow).</p>`;
    },
    progress() {
      if (S.final) {
        const okFinal = Boolean(S.final.ok);
        const hasReport = okFinal && Array.isArray(S.final.cycleReport) && S.final.cycleReport.length > 0;
        const reportFailed = hasReport && String(S.final.cycleReport[0] || '').includes('FAILED');
        const firstGreen = Boolean(S.final.firstRunGreen);
        const heading = firstGreen ? 'Setup finished — the first cycle run is green'
          : reportFailed ? 'Setup finished — the first cycle run is still red'
          : hasReport ? 'Setup finished — and the cycle was watched'
          : okFinal ? 'Setup finished' : 'Setup stopped';
        const lede = firstGreen
          ? 'The one-time configuration run is done and its goal is proven: the first GitHub Actions cycle finished green with the selected keys. The configuration model\'s job is done — from here any issue continues on GitHub.'
          : reportFailed
          ? 'The one-time configuration run is done, and the fresh cycle was watched to the end. The report below names the fix — apply it, then run devos continue again: the engine keeps starting fresh rounds until the first cycle run is green.'
          : hasReport
          ? 'The one-time configuration run is done, and the fresh GitHub Actions cycle was watched to the end. The report below says exactly what happened — no link-staring required.'
          : okFinal
          ? 'The one-time configuration run is done. From here GitHub Actions runs the tasks — the configuration model is not called again.'
          : 'The configuration run has stopped, and everything written so far is kept. Resume any time — nothing is lost.';
        return `
          <h1>${heading}</h1>
          <p class="lede">${lede}</p>
          ${finalCard()}<div class="actions"><button class="ghost" id="new-run">Start a new setup</button></div>`;
      }
      return `
        <h1>Writing your project</h1>
        <p class="lede">Everything the model does streams below — every file, every log line, with a percentage and a todo list. Nothing is hidden.</p>
        <div class="card run-card">
          <p class="run-sitback">Sit back — while the model works, a hairline figure keeps you company and rotates to the next one as the run moves on.</p>
          <div class="run-figure" id="run-figure" aria-hidden="true"></div>
          <p class="run-figure-cap" id="run-figure-cap"></p>
          <div class="run-head">
            <span class="run-percent" id="run-percent">0%</span>
            <div class="run-bar"><div class="run-bar-fill" id="run-bar-fill" style="width:0%"></div></div>
            <span class="run-elapsed" id="run-elapsed">0s</span>
          </div>
          <ol class="run-steps" id="run-steps"></ol>
          <p class="run-counters pulse" id="run-counters">waiting for the first event…</p>
          <div class="actions">
            <button class="danger" id="stop-run">■ Stop — kill the model process</button>
            <span class="hint">Stopping keeps everything written so far. Resume later: <code>devos continue &lt;folder&gt;</code></span>
          </div>
        </div>
        <div id="proposal-slot"></div>
        <div id="keys-slot"></div>
        <div class="log" id="log"></div>`;
    },
  };

  // Live run panel: the progress SSE event carries the whole snapshot, so the
  // panel is a pure function of the latest one — no timers, no guessing.
  const TICKS = { done: '✓', active: '▸', pending: '·', stopped: '!' };

  // Engine phases the browser names in the log and on the stage line. The same
  // words the terminal echoes — one story in both places.
  const PHASE_LOG = {
    assessing: 'Checking what is already done and what is missing…',
    installing: 'Installing dependencies…',
    'syncing-repo': 'Pushing the repaired tree to the repository…',
    consulting: 'Asking the configuration model to propose a fix…',
    'applying-fix': 'Applying the fix you approved…',
    'restarting-cycle': 'Starting a FRESH cycle run with the keys in place (a new run appears in Actions)…',
    'watching-cycle': 'Watching the fresh cycle run — the report comes when it finishes…',
    'cycle-report': 'Reading the last cycle run and writing the report…',
    'keys-intake': 'The keys intake card is open — type the missing values there (values never reach the model)…',
  };

  // The hairline figure stage. The module (hairline-stage.js) owns the rotation;
  // app.js only mounts it when the run view is on screen, advances it on phase
  // changes, and stops it when the run view goes away.
  function mountFigureStage() {
    const el = document.getElementById('run-figure');
    if (!el) return;
    const api = window.DEVOS_FIGURES;
    if (api) api.mount(el);
    else document.addEventListener('devos:figures-ready', () => {
      const again = document.getElementById('run-figure');
      if (again && window.DEVOS_FIGURES) window.DEVOS_FIGURES.mount(again);
    }, { once: true });
  }
  function nextFigure() { if (window.DEVOS_FIGURES) window.DEVOS_FIGURES.setPhase(); }
  function stopFigureStage() { if (window.DEVOS_FIGURES) window.DEVOS_FIGURES.stop(); }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }
  function updateRunPanel(p) {
    const pct = document.getElementById('run-percent');
    if (!pct) return; // not on the run view
    pct.textContent = `${p.percent}%`;
    const fill = document.getElementById('run-bar-fill');
    if (fill) fill.style.width = `${p.percent}%`;
    const el = document.getElementById('run-elapsed');
    if (el) el.textContent = fmtDur(p.elapsedMs);
    const steps = document.getElementById('run-steps');
    if (steps) {
      steps.innerHTML = (p.steps || []).map((s) => `
        <li class="${esc(s.state)}"><span class="tick">${TICKS[s.state] || '·'}</span>
        <span class="s-label">${esc(s.label)}</span>${s.detail ? `<span class="s-detail">${esc(s.detail)}</span>` : ''}</li>`).join('');
    }
    const c = p.counters || {};
    const ago = p.lastOutputAgoMs == null ? 'no output yet' : (p.lastOutputAgoMs < 2000 ? 'just now' : `${fmtDur(p.lastOutputAgoMs)} ago`);
    const counters = document.getElementById('run-counters');
    if (counters) {
      counters.classList.remove('pulse'); // real data landed — the stage pulse is over
      counters.textContent = [
        `${c.files || 0} files written`,
        `${c.modules || 0} modules`,
        `${c.lines || 0} model lines`,
        c.rounds ? `repair round ${c.rounds}` : null,
        c.reconnects ? `reconnecting ×${c.reconnects}` : null,
        `last output: ${ago}`,
      ].filter(Boolean).join(' · ');
    }
    if (p.stopping) {
      const b = document.getElementById('stop-run');
      if (b) { b.disabled = true; b.textContent = 'Stopping…'; }
    }
  }

  // Between "run started" and the first progress snapshot the panel would sit
  // mute; this paints the current engine phase into the counters line, pulsing
  // (CSS .pulse) until real data overwrites it.
  function setRunStage(label) {
    const counters = document.getElementById('run-counters');
    if (!counters || S.progress) return; // a real snapshot already owns the line
    if (!label) return;
    counters.classList.add('pulse');
    counters.textContent = label;
  }
  async function stopRunClick() {
    const b = document.getElementById('stop-run');
    if (b) { b.disabled = true; b.textContent = 'Stopping…'; }
    appendLog('Stop requested — killing the model process…');
    try { await api('/api/stop', { method: 'POST' }); }
    catch (e) { appendLog(`Stop failed: ${e && e.message ? e.message : e}`); }
  }

  // Continue = the smart resume: the engine checks what is done, finishes the
  // missing steps itself (install, init_github — an existing repo is adopted),
  // and only wakes the model when the guards still fail. Used by the resume card
  // AND by the Continue button on a stopped/failed final card.
  async function continueRunClick(folder) {
    S.running = false; S.done = false; S.final = null; S.events = []; S.progress = null; S.proposal = null; S.keysIntake = null;
    S.showResume = false;
    // Immediate feedback: the button itself becomes the checking indicator while
    // the engine reads the project (guards + GitHub) before the first event.
    const btn = document.getElementById('resume-continue') || document.getElementById('final-continue');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Checking what is done and what is missing…'; }
    appendLog(`Continuing ${folder} — checking what is done and what is missing…`);
    try {
      const r = await api('/api/continue', { method: 'POST', body: JSON.stringify({ folder }), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) { S.running = false; alert(r.error || 'Could not continue. Check the terminal output.'); render(); return; }
    } catch (e) { alert(e && e.message ? e.message : String(e)); render(); return; }
    enterRunView();
  }

  function bindResume() {
    const btn = document.getElementById('resume-continue');
    if (btn) btn.onclick = () => continueRunClick(btn.dataset.folder || '');
    const dismiss = document.getElementById('resume-dismiss');
    if (dismiss) dismiss.onclick = () => { S.showResume = false; S.resumeDismissed = true; render(); };
  }

  // The Approve/Decline card: a built-in continue step failed, the configuration
  // model proposed a fix, and nothing runs until the developer decides here.
  function renderProposal() {
    const slot = document.getElementById('proposal-slot');
    if (!slot) return;
    const p = S.proposal;
    if (!p) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="card proposal-card">
        <h3>The configuration model proposes a fix</h3>
        ${p.diagnosis ? `<p class="consequence">${esc(p.diagnosis)}</p>` : ''}
        ${(p.commands || []).length
    ? `<ul class="proposal-commands">${p.commands.map((c) => `<li><code>${esc(c.run)}</code>${c.why ? `<span class="why">${esc(c.why)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="hint">No commands — the model only lists steps for you.</p>'}
        ${(p.userSteps || []).length ? `<p class="hint">Only you can: ${p.userSteps.map((s) => esc(s)).join(' · ')}</p>` : ''}
        <div class="actions">
          <button class="primary" id="proposal-approve">✓ Approve — apply and retry</button>
          <button class="ghost" id="proposal-decline">✕ Decline</button>
        </div>
        <p class="hint">Approve runs only the listed commands, then the engine retries the step that failed. Decline ends the run with a resume command. Stop still kills the run.</p>
      </div>`;
    const a = document.getElementById('proposal-approve');
    const d = document.getElementById('proposal-decline');
    if (a) a.onclick = () => decideProposal(true, a, d);
    if (d) d.onclick = () => decideProposal(false, a, d);
  }
  async function decideProposal(approve, a, d) {
    if (a) { a.disabled = true; a.textContent = approve ? 'Applying…' : 'Approved'; }
    if (d) d.disabled = true;
    try {
      const r = await api('/api/proposal', { method: 'POST', body: JSON.stringify({ approve }), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(r.error || 'The engine refused the decision.');
    } catch (e) {
      appendLog(`Could not send the decision: ${e && e.message ? e.message : e}`);
      if (a) { a.disabled = false; a.textContent = approve ? '✓ Approve — apply and retry' : '✕ Decline'; }
      if (d) d.disabled = false;
    }
  }

  // The keys intake card: the run is waiting because selected keys have no value
  // on GitHub. The user types each value here; POST /api/keys hands them to the
  // engine, which uploads each one to GitHub (gh secret set over stdin) and
  // re-checks GitHub's own list — anything still missing re-opens this card with
  // only those names. A value lives in the POST body and the gh pipe only: it is
  // never logged, never stored, never sent to any model (the inputs are
  // type=password, and only NAMES travel back in events).
  function renderKeysIntake() {
    const slot = document.getElementById('keys-slot');
    if (!slot) return;
    const k = S.keysIntake;
    if (!k) { slot.innerHTML = ''; return; }
    // Three statuses, rendered once each: missing (not on GitHub), unconfirmed
    // (on GitHub, not set from this machine), suspected (on GitHub, but the
    // last run had no working value — re-typing overwrites it safely).
    const seen = new Set();
    const rowsSpec = [];
    for (const n of (k.missing || [])) { if (!seen.has(n)) { seen.add(n); rowsSpec.push({ name: n, status: 'missing' }); } }
    for (const n of (k.unconfirmed || [])) { if (!seen.has(n)) { seen.add(n); rowsSpec.push({ name: n, status: 'unconfirmed' }); } }
    for (const n of (k.suspected || [])) { if (!seen.has(n)) { seen.add(n); rowsSpec.push({ name: n, status: 'suspected' }); } }
    if (!rowsSpec.length) { slot.innerHTML = ''; return; }
    const statusHint = (s, n) => s === 'missing'
      ? 'not on GitHub yet — the run cannot see it at all'
      : s === 'unconfirmed'
        ? 'on GitHub, but not set from this machine — paste the real value (or type __keep__ to keep it)'
        : `on GitHub, but the last run had no working value for it — re-typing it here overwrites the stale one safely`;
    const rows = rowsSpec.map(({ name: n, status: s }) => `
      <div class="key-row">
        <label class="key-name" for="key-input-${esc(n)}"><code>${esc(n)}</code><span class="hint">${esc((k.sources || {})[n] || 'See devos/SECRETS_GUIDE.md for where to get it.')}</span><span class="hint key-status">${esc(statusHint(s, n))}</span></label>
        <input type="password" id="key-input-${esc(n)}" data-key-name="${esc(n)}" autocomplete="off" spellcheck="false" placeholder="paste the value for ${esc(n)}">
      </div>`).join('');
    const again = (k.round || 1) > 1
      ? `<p class="warn-line">The last round did not fix it — fill the fields below and submit again; the run continues the moment GitHub confirms every value.</p>`
      : '';
    const note = k.note ? `<p class="warn-line">${esc(k.note)}</p>` : '';
    slot.innerHTML = `
      <div class="card keys-card">
        <h3>Missing keys — type them right here${(k.total && k.total > rowsSpec.length) ? ` (${rowsSpec.length} of ${k.total} left)` : ''}</h3>
        <p class="consequence">The run is waiting for ${rowsSpec.length} key(s) this project selected. Get each one where the hint says, paste it below, and press Submit — the engine uploads every value straight to GitHub and continues on its own (it re-checks, and re-opens this card if something is still missing).</p>
        ${note}
        ${again}
        ${rows}
        <div class="actions">
          <button class="primary" id="keys-submit">Submit ${rowsSpec.length} key(s) — upload to GitHub and continue</button>
          <button class="ghost" id="keys-skip">Skip for now</button>
        </div>
        <p class="hint">A value travels browser → GitHub only: it is never shown again, never logged, never sent to the model. Prefer the terminal? Paste into <code>devos/secrets.local.json</code> and run <code>devos continue</code> — the same engine uploads it. Skip ends this run with exact instructions; the next continue opens this card again.</p>
      </div>`;
    const sub = document.getElementById('keys-submit');
    const skip = document.getElementById('keys-skip');
    if (sub) sub.onclick = () => submitKeysIntake(sub, skip);
    if (skip) skip.onclick = () => skipKeysIntake(sub, skip);
  }
  function collectKeyValues() {
    const values = {};
    document.querySelectorAll('#keys-slot input[data-key-name]').forEach((inp) => {
      const v = String(inp.value || '').trim();
      if (v) values[inp.dataset.keyName] = v;
    });
    return values;
  }
  async function submitKeysIntake(sub, skip) {
    const values = collectKeyValues();
    if (!Object.keys(values).length) {
      appendLog('No value was typed — fill at least one field, or press Skip for now.');
      return;
    }
    if (sub) { sub.disabled = true; sub.textContent = 'Uploading to GitHub…'; }
    if (skip) skip.disabled = true;
    try {
      const r = await api('/api/keys', { method: 'POST', body: JSON.stringify({ values }), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(r.error || 'The engine refused the submit.');
      appendLog(`Submitted ${r.names.length} key value(s) — the engine uploads them and re-checks GitHub (names only are shown).`);
    } catch (e) {
      appendLog(`Could not send the keys: ${e && e.message ? e.message : e}`);
      if (sub) { sub.disabled = false; sub.textContent = `Submit ${Object.keys(values).length} key(s) — upload to GitHub and continue`; }
      if (skip) skip.disabled = false;
    }
  }
  async function skipKeysIntake(sub, skip) {
    if (sub) sub.disabled = true;
    if (skip) { skip.disabled = true; skip.textContent = 'Skipping…'; }
    try {
      const r = await api('/api/keys', { method: 'POST', body: JSON.stringify({ skip: true }), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(r.error || 'The engine refused the skip.');
    } catch (e) {
      appendLog(`Could not skip the intake: ${e && e.message ? e.message : e}`);
      if (sub) sub.disabled = false;
      if (skip) { skip.disabled = false; skip.textContent = 'Skip for now'; }
    }
  }

  function finalCard() {
    const r = S.final;
    if (!r.ok) {
      const dir = r.projectDir || 'the project folder';
      const next = r.stopped
        ? 'everything written so far is kept — run "devos continue ' + dir + '" when you are ready'
        : r.usageLimit
        ? 'wait for the limit to reset, then run devos continue ' + dir
        : r.trustIssue
          ? 'open a terminal in ' + dir + ', run the agent CLI once and answer Yes to the trust question, quit, then run devos continue ' + dir
          : r.planIssue
            ? 'run "devos continue ' + dir + ' --model auto" (Cursor Free plans run only Auto), or switch tools with "devos continue ' + dir + ' --cli <tool>", or upgrade the plan'
            : r.permissionIssue
              ? 'the engine passes --force automatically; update the agent CLI ("agent update"), then run devos continue ' + dir
              : r.installError
                ? 'check the install output above (network, lockfile), then run devos continue ' + dir
                : r.githubError
                  ? 'check the GitHub error above (branch protection, remote state), then run devos continue ' + dir
                  : 'fix the message above, then run devos continue ' + dir;
      const steps = Array.isArray(r.verify) ? r.verify.filter((s) => s && s.label) : [];
      const stepHtml = steps.length ? `
        <div class="card fix-steps">
          <p class="consequence">What still stands between you and a finished setup:</p>
          <ul>
            ${steps.map((s) => `<li><span class="who ${s.who === 'model' ? 'who-model' : s.who === 'devos' ? 'who-devos' : 'who-you'}">${s.who === 'model' ? 'model fixes' : s.who === 'devos' ? 'devos fixes it' : 'you fix'}</span><span class="fix-body"><strong>${esc(s.label)}</strong> — ${esc(s.detail || '')}${s.fix ? `<br><code class="fix-cmd">${esc(s.fix)}</code>` : ''}</span></li>`).join('')}
          </ul>
          <p class="hint">Hand the model-fixable steps to the model: <code>devos fix ${esc(dir)}</code> — or let the whole resume run: <code>devos continue ${esc(dir)}</code>. Steps marked "you fix" (logins, plans, key values) never go to a model.</p>
        </div>` : '';
      const headline = r.stopped ? 'Stopped by you. Nothing is lost.' : (r.message || 'The configuration model failed.');
      const continueBtn = r.projectDir ? `<div class="actions"><button class="primary" id="final-continue" data-folder="${esc(r.projectDir)}">▸ Continue where it stopped — check for misses and finish</button></div>` : '';
      return `<div class="card"><p class="${r.stopped ? 'warn-line' : 'error-line'}">${esc(headline)} Next action: ${esc(next)}</p>${continueBtn}</div>${stepHtml}`;
    }
    const RESUMED_LABELS = {
      model: 'the configuration model finished the tree',
      install: 'dependencies installed',
      github: 'GitHub repository + first cycle',
      'github-sync': 'the repaired tree was pushed to the repository',
      secrets: 'keys uploaded to GitHub',
      'cycle-dispatch': 'a fresh devos-cycle run was dispatched and watched — the report is below',
      'cycle-watch': 'the running cycle was watched to the end — the report is below',
      'cycle-rerun': 'a fresh devos-cycle run was started and watched — the report is below',
      'workflow-secrets-fix': 'the cycle workflow now maps every selected key for every step (repaired and pushed — no value was touched)',
    };
    const resumedNote = Array.isArray(r.resumed) && r.resumed.length
      ? `<p>Picked up where it stopped — ${esc(r.resumed.map((x) => RESUMED_LABELS[x] || x).join(' · '))}.${Array.isArray(r.keysMissing) && r.keysMissing.length ? ` Secrets still to type: ${esc(r.keysMissing.join(', '))} (devos keys shows where each one comes from).` : ''}</p>`
      : '';
    const reportNote = Array.isArray(r.cycleReport) && r.cycleReport.length
      ? `<div class="cycle-report"><h4>Cycle report</h4><pre>${esc(r.cycleReport.join('\n'))}</pre><p class="hint">The same report in the terminal: <code>devos report${r.projectDir ? ` ${r.projectDir}` : ''}</code> — reads the latest run, restarts nothing.</p></div>`
      : '';
    return `
      <div class="card final-links">
        <p class="ok-line mono">${esc(r.finalLine)}</p>
        ${resumedNote}
        ${reportNote}
        <p>Repository: <a href="${esc(r.repoUrl)}" target="_blank" rel="noreferrer">${esc(r.repoUrl)}</a></p>
        <p>Actions run: <a href="${esc(r.actionsUrl)}" target="_blank" rel="noreferrer">${esc(r.actionsUrl)}</a></p>
        ${r.setupIssueUrl ? `<p>Setup issue: <a href="${esc(r.setupIssueUrl)}" target="_blank" rel="noreferrer">${esc(r.setupIssueUrl)}</a></p>` : ''}
        ${r.firstRunGreen
          ? `<p>The configuration model's job is done — the first cycle run is green with the selected keys. From here, continue any issue on GitHub: merge pull requests labeled <code>devos:human-gate</code> when <code>devos/checks</code>, <code>devos/verdict</code>, and <code>devos/gate</code> are green, and add anything the setup issue lists.</p>`
          : `<p>The configuration model's job is not done yet — it keeps going until the first cycle run is green. The cycle report above names the fix; run <code>devos continue</code> again — the intake for missing keys opens right in the flow: type the values into the <strong>Missing keys card in this window</strong>, or paste into <code>devos/secrets.local.json</code>, or type into gh's hidden prompt — a value never reaches the model — and the engine starts the next fresh round itself.</p>`}
        <p>Keys: run <code>devos keys</code> in the project folder for the where-to-get-each-token guide, then <code>devos keys --check</code> to confirm every needed key is set on GitHub. A key value is typed only into this window's Missing keys card, gh's terminal prompt, or the gitignored local file — never into chat or an issue.</p>
      </div>`;
  }

  function modelRow(key, label, agents, opts = {}) {
    const m = S.draft.models[key];
    const groupsFor = (a) => (a.groups || []).map((g) => `<optgroup label="${esc(g.label)}">${g.models.map((x) => `<option value="${esc(x.id)}" ${m.model === x.id ? 'selected' : ''}>${esc(x.id)}${x.available ? ' — on your account' : x.reported ? ' (reported by the CLI)' : ''}</option>`).join('')}</optgroup>`).join('');
    const tools = agents.map((a) => `<option value="${esc(a.toolId)}" ${m.cli === a.toolId ? 'selected' : ''}>${esc(a.label)}</option>`).join('');
    const chosen = agents.find((a) => a.toolId === m.cli);
    const badge = chosen ? (chosen.githubCapable ? '<span class="badge github">Runs on GitHub</span>' : '<span class="badge local">This computer only</span>') : '';
    const recBadge = opts.rec && m.cli === opts.rec.cli && m.model === opts.rec.model ? '<span class="badge rec">Recommended — best start</span>' : '';
    const recHint = opts.rec && !recBadge
      ? `<p class="consequence">Recommended for the best start: ${esc(opts.rec.label)} · <code>${esc(opts.rec.model)}</code>. The configuration model writes the whole project in one run, so the strongest reasoning model wins.</p>`
      : '';
    const planHint = chosen && chosen.toolId === 'cursor'
      ? (() => {
          const acc = chosen.account || {};
          if (acc.signedIn === true && acc.plan && /free|hobby/i.test(acc.plan)) {
            return `<p class="consequence">Your Cursor account${acc.email ? ' (' + esc(acc.email) + ')' : ''} is on ${esc(acc.plan)} — only "Auto" runs. Pick Auto from the list, or upgrade the plan first.</p>`;
          }
          if (acc.signedIn === true && acc.plan) {
            return `<p class="consequence">Signed in as ${esc(acc.email || 'unknown')} (${esc(acc.plan)} plan). Models marked "on your account" came from the CLI itself and are enabled for you; the rest of the catalogue may need plan access. Grok and Composer are part of Cursor's paid plans.</p>`;
          }
          return '<p class="consequence">Cursor\'s Free plan runs only "Auto" — every named model is refused with "Named models unavailable". Models marked "on your account" are the ones your plan can run. If you have two Cursor accounts, confirm the signed-in one at cursor.com/settings.</p>';
        })()
      : '';
    const sameToggle = opts.sameToggle ? `
      <label class="checkline"><input type="checkbox" data-model-sub="${key}" data-sub="same" ${m.same ? 'checked' : ''}><span>Same as the reviewer</span></label>` : '';
    return `
      <div class="card">
        <h3>${key === 'lightReviewer' ? 'Light reviewer' : key === 'configurationModel' ? 'Configuration model' : key === 'reviewer' ? 'Reviewer' : 'Builder'} ${badge}${recBadge}</h3>
        <p class="consequence">${esc(label)}</p>
        ${recHint}
        ${planHint}
        <div class="row">
          <label class="field"><span>Tool</span>
            <select data-model="${key}" data-part="cli"><option value="">Choose a tool</option>${tools}</select>
          </label>
          <label class="field"><span>Model id</span>
            <select data-model="${key}" data-part="model"><option value="">${chosen ? 'Choose a model id' : 'Pick a tool first'}</option>${groupsFor(chosen || {})}</select>
          </label>
        </div>
        ${sameToggle}
      </div>`;
  }

  function extraBuilderRow(b, i) {
    const githubAgents = S.data.agents.filter((a) => a.status === 'installed' && a.githubCapable && a.promptTemplate);
    const chosen = githubAgents.find((a) => a.toolId === b.cli);
    return `<div class="mrow">
      <div class="row">
        <label class="field"><span>Tool</span><select data-eb="${i}" data-part="cli"><option value="">Choose</option>${githubAgents.map((a) => `<option value="${esc(a.toolId)}" ${b.cli === a.toolId ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Model id</span><select data-eb="${i}" data-part="model"><option value=""></option>${(chosen?.groups || []).map((g) => `<optgroup label="${esc(g.label)}">${g.models.map((x) => `<option value="${esc(x.id)}" ${b.model === x.id ? 'selected' : ''}>${esc(x.id)}${x.reported ? ' (reported by the CLI)' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label class="field"><span>Strength</span><select data-eb="${i}" data-part="strength">${S.data.builderStrengths.map((s) => `<option value="${esc(s)}" ${b.strength === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <button type="button" class="ghost btn-small" data-eb-remove="${i}" title="Remove this extra builder">Remove</button>
      </div></div>`;
  }

  function languageRow(m) {
    const s = S.draft.modules.language || { provider: 'typescript' };
    return `<div class="mrow"><div class="mrow-head"><h3>${esc(m.label)}</h3></div>
      <p class="consequence">${esc(m.consequence)}</p>
      <div class="provider"><label class="field"><span>Provider</span>
      <select data-modp="language">${m.providers.map((pv) => `<option value="${esc(pv.id)}" ${s.provider === pv.id ? 'selected' : ''}>${esc(pv.label)}</option>`).join('')}</select></label></div></div>`;
  }
  function autoStorage(dbProvider) {
    if (dbProvider === 'supabase') return 'supabase-storage';
    if (dbProvider === 'firebase') return 'firebase-storage';
    return null;
  }
  function authImplRow(m, s) {
    const db = S.draft.modules.database || {};
    const impls = m.implProviders.filter((p) => {
      if (p.id === 'supabase-auth') return Boolean(db.on && db.provider === 'supabase');
      if (p.id === 'firebase-auth') return Boolean(db.on && db.provider === 'firebase');
      return true;
    });
    return `<label class="field"><span>Auth implementation</span><select data-modi="auth">${impls.map((p) => `<option value="${esc(p.id)}" ${s.impl === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
  }
  function aiImplRow(m, s) {
    return `<label class="field"><span>AI provider</span><select data-modi="product-ai">${m.implProviders.map((p) => `<option value="${esc(p.id)}" ${s.impl === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
  }
  function implRow() { return ''; }

  // ---------- events ----------
  function bindCommon() {
    const next = document.getElementById('next');
    const back = document.getElementById('back');
    if (next) next.onclick = () => move(1);
    if (back) back.onclick = () => move(-1);
    const recheck = document.getElementById('recheck');
    if (recheck) recheck.onclick = async () => { await load(true); };
    const newRun = document.getElementById('new-run');
    if (newRun) newRun.onclick = () => {
      S.running = false; S.done = false; S.final = null; S.events = []; S.stepIndex = 0; S.progress = null; S.proposal = null; S.keysIntake = null;
      stopPolling();
      render();
    };
    const stopBtn = document.getElementById('stop-run');
    if (stopBtn) stopBtn.onclick = stopRunClick;
    const finalContinue = document.getElementById('final-continue');
    if (finalContinue) finalContinue.onclick = () => continueRunClick(finalContinue.dataset.folder || '');
    document.getElementById('theme').onclick = () => {
      S.draft.theme = S.draft.theme === 'light' ? 'dark' : 'light';
      saveDraft(); renderRail();
    };
  }

  // The progress view lives one index past the last step. Calling .id on undefined
  // there crashed render() and left the run looking stuck (fixed 2026-10).
  const stepId = () => (S.stepIndex >= S.data.steps.length ? 'progress' : S.data.steps[S.stepIndex].id);

  function bindStep() {
    const id = stepId();
    if (id === 'models') bindModels();
    if (id === 'project') bindProject();
    if (id === 'type') bindType();
    if (id === 'framework') bindFramework();
    if (id === 'modules') bindModules();
    if (id === 'languages') bindLanguages();
    if (id === 'summary') bindSummary();
  }

  function bindModels() {
    document.querySelectorAll('[data-model]').forEach((sel) => {
      sel.onchange = () => {
        const key = sel.dataset.model;
        const part = sel.dataset.part;
        if (part === 'cli') {
          S.draft.models[key].cli = sel.value || null;
          S.draft.models[key].model = null;
          if (key === 'configurationModel' && !S.draft.models.configurationModel.cli) return;
          // Default the configuration model to the reviewer when the reviewer is set.
          if (key === 'configurationModel' && !S.draft.models.configurationModel._touched && S.draft.models.reviewer.cli) {
            S.draft.models.configurationModel.cli = S.draft.models.reviewer.cli;
            S.draft.models.configurationModel.model = S.draft.models.reviewer.model;
          }
        } else {
          S.draft.models[key].model = sel.value || null;
          if (key === 'configurationModel') S.draft.models.configurationModel._touched = true;
        }
        saveDraft(); refresh();
      };
    });
    document.querySelectorAll('[data-model-sub]').forEach((el) => {
      el.onchange = () => {
        S.draft.models.lightReviewer.same = el.checked;
        saveDraft(); refresh();
      };
    });
    const add = document.getElementById('add-builder');
    if (add) add.onclick = () => {
      S.draft.models.extraBuilders = S.draft.models.extraBuilders || [];
      S.draft.models.extraBuilders.push({ cli: null, model: null, strength: 'ui' });
      saveDraft(); refresh();
    };
    document.querySelectorAll('[data-eb]').forEach((sel) => {
      sel.onchange = () => {
        const i = Number(sel.dataset.eb);
        S.draft.models.extraBuilders[i][sel.dataset.part] = sel.value || null;
        saveDraft(); refresh();
      };
    });
    document.querySelectorAll('[data-eb-remove]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.ebRemove);
        S.draft.models.extraBuilders.splice(i, 1);
        saveDraft(); refresh();
      };
    });
    document.querySelectorAll('[name="pickPolicy"]').forEach((el) => {
      el.onchange = () => { S.draft.models.pickPolicy = el.value; saveDraft(); };
    });
  }

  function bindProject() {
    const map = { 'f-name': ['project', 'name'], 'f-slug': ['project', 'slug'], 'f-brief': ['project', 'brief'], 'f-audience': ['project', 'audience'] };
    for (const [id, [a, b]] of Object.entries(map)) {
      const el = document.getElementById(id);
      el.oninput = () => {
        S.draft[a][b] = el.value;
        if (b === 'name' && !S.draft.project._slugTouched) S.draft.project.slug = '';
      };
      el.onchange = () => { saveDraft(); };
    }
    const slug = document.getElementById('f-slug');
    slug.oninput = () => { S.draft.project._slugTouched = true; S.draft.project.slug = slug.value; };
    document.querySelectorAll('[name="visibility"]').forEach((el) => {
      el.onchange = () => { S.draft.project.visibility = el.value; saveDraft(); };
    });

    // Attached documentation: read as text in the browser, kept in the draft, and
    // later written into devos/intake-docs/ for the configuration model to read.
    const DOC_LIMIT = 8;
    const CHAR_LIMIT = 120_000;
    const docs = () => { S.draft.project.docs = S.draft.project.docs || []; return S.draft.project.docs; };
    const readFile = (file) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => resolve('');
      r.readAsText(file);
    });
    const fileInput = document.getElementById('f-docs');
    if (fileInput) fileInput.onchange = async () => {
      const list = docs();
      const files = [...fileInput.files || []];
      fileInput.value = '';
      const room = Math.max(0, DOC_LIMIT - list.length);
      const picked = files.slice(0, room);
      for (const f of picked) {
        let content = await readFile(f);
        if (content.length > CHAR_LIMIT) {
          content = content.slice(0, CHAR_LIMIT);
          list.push({ name: f.name, size: content.length, content, truncated: true });
        } else {
          list.push({ name: f.name, size: content.length, content });
        }
      }
      await saveDraft();
      render();
    };
    const pasteBtn = document.getElementById('f-docs-add-paste');
    if (pasteBtn) pasteBtn.onclick = async () => {
      const box = document.getElementById('f-docs-paste');
      const text = (box && box.value || '').trim();
      if (!text) return;
      const list = docs();
      if (list.length >= DOC_LIMIT) return;
      const n = list.filter((d) => /^pasted-notes/.test(d.name)).length + 1;
      list.push({ name: `pasted-notes-${n}.md`, size: text.length, content: text.slice(0, CHAR_LIMIT) });
      if (box) box.value = '';
      await saveDraft();
      render();
    };
    document.querySelectorAll('[data-doc-remove]').forEach((btn) => {
      btn.onclick = async () => {
        const i = Number(btn.dataset.docRemove);
        S.draft.project.docs.splice(i, 1);
        await saveDraft();
        render();
      };
    });
  }

  function bindType() {
    document.querySelectorAll('[data-type]').forEach((card) => {
      const pick = () => {
        S.draft.type = card.dataset.type;
        // applyType runs server-side semantics here, mirrored:
        const t = S.data.types.find((x) => x.id === S.draft.type);
        if (!S.draft.touched.framework) S.draft.framework = t.framework;
        if (!S.draft.touched.modules) {
          const rec = new Set(t.modules || []);
          for (const m of S.data.modules) {
            const cur = S.draft.modules[m.id] || {};
            if (m.id === 'automation') continue;
            if (m.id === 'language' || m.id === 'testing' || m.id === 'i18n') continue;
            if (m.id === 'hosting') { S.draft.modules.hosting = { on: (t.hosting && t.hosting !== 'none') || rec.has('hosting'), provider: t.hosting || 'none' }; continue; }
            S.draft.modules[m.id] = { on: rec.has(m.id), provider: rec.has(m.id) ? (S.draft.modules[m.id]?.provider || (m.providers || []).find((p) => p.id !== 'none')?.id || 'none') : 'none' };
          }
          S.draft.modules['product-ai'] = { on: rec.has('product-ai'), provider: rec.has('product-ai') ? 'chat' : 'none', impl: rec.has('product-ai') ? 'claude' : 'none' };
        }
        saveDraft(); refresh();
      };
      card.onclick = pick;
      card.onkeydown = (e) => { if (e.key === 'Enter') { pick(); } };
    });
  }

  function bindFramework() {
    document.querySelectorAll('[data-fw]').forEach((card) => {
      const pick = () => {
        S.draft.framework = card.dataset.fw;
        S.draft.touched.framework = true;
        saveDraft(); refresh();
      };
      card.onclick = pick;
      card.onkeydown = (e) => { if (e.key === 'Enter') pick(); };
    });
    document.querySelectorAll('[data-cc]').forEach((el) => {
      el.oninput = () => { S.draft.customCommands[el.dataset.cc] = el.value; };
      el.onchange = () => saveDraft();
    });
  }

  function bindModules() {
    document.querySelectorAll('[data-mod]').forEach((el) => {
      el.onchange = () => {
        const id = el.dataset.mod;
        if (id === 'testing' && el.dataset.sub === 'playwright') {
          S.draft.modules.testing.playwright = el.checked;
        } else if (el.dataset.sub === 'unit') {
          /* locked on */
        } else {
          S.draft.modules[id] = S.draft.modules[id] || {};
          S.draft.modules[id].on = el.checked;
          if (el.checked && !S.draft.modules[id].provider) {
            const m = S.data.modules.find((x) => x.id === id);
            const first = (m.providers || []).find((p) => p.id !== 'none');
            S.draft.modules[id].provider = first ? first.id : 'none';
          }
          // Storage follows the database when it can: Supabase database -> Supabase
          // Storage, Firebase database -> Firebase Storage. A manual pick sticks.
          if (id === 'storage' && el.checked) {
            const auto = autoStorage((S.draft.modules.database || {}).provider);
            const cur = S.draft.modules[id].provider;
            if (auto && (!cur || cur === 'none' || S.draft.modules[id]._auto)) {
              S.draft.modules[id].provider = auto;
              S.draft.modules[id]._auto = true;
            }
          }
          if (el.checked) S.draft.touched.modules = true;
        }
        saveDraft(); refresh();
      };
    });
    document.querySelectorAll('[data-modp]').forEach((el) => {
      el.onchange = () => {
        const id = el.dataset.modp;
        S.draft.modules[id].provider = el.value;
        if (id === 'storage') S.draft.modules.storage._auto = false; // a manual pick sticks
        if (id === 'database') {
          const st = S.draft.modules.storage = S.draft.modules.storage || { on: false, provider: 'none' };
          const auto = autoStorage(el.value);
          if (st.on && auto && (!st.provider || st.provider === 'none' || st._auto)) {
            st.provider = auto;
            st._auto = true;
          } else if (st.on && st._auto && !auto) {
            st.provider = 'none';
            st._auto = false;
          }
        }
        S.draft.touched.modules = true;
        saveDraft(); refresh();
      };
    });
    document.querySelectorAll('[data-modi]').forEach((el) => {
      el.onchange = () => {
        S.draft.modules[el.dataset.modi].impl = el.value;
        S.draft.touched.modules = true;
        saveDraft();
      };
    });
  }

  function bindLanguages() {
    const el = document.getElementById('f-langs');
    el.oninput = () => {
      S.draft.languages = el.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    };
    el.onchange = () => saveDraft();
  }

  function bindSummary() {
    const btn = document.getElementById('confirm');
    btn.onclick = confirmRun;
    document.getElementById('f-save-defaults').onchange = (el) => {
      S.draft.saveDefaults = el.target.checked; saveDraft();
    };
    document.querySelectorAll('[data-jump]').forEach((b) => {
      b.onclick = () => {
        const target = S.data.steps.findIndex((s) => s.id === b.dataset.jump);
        if (target >= 0) { S.stepIndex = target; refresh(); }
      };
    });
  }

  async function confirmRun() {
    if (S.running || S.done) return; // one run at a time; re-taps must never re-enter
    await saveDraft();
    const r = await api('/api/confirm', { method: 'POST' });
    if (!r.ok) { alert(r.error || 'Could not start the configuration model. Check the terminal output.'); return; }
    enterRunView();
  }

  function enterRunView() {
    S.running = !S.done;
    S.events = S.events || [];
    S.stepIndex = S.data.steps.length; // progress view
    render();
    if (S.progress) updateRunPanel(S.progress); // reload mid-run: paint the latest snapshot
    if (S.proposal) renderProposal(); // reload mid-decision: re-show the Approve/Decline card
    if (S.keysIntake) renderKeysIntake(); // reload mid-intake: re-show the keys card
    connectEvents();
  }

  function handleFinal(evt) {
    const res = evt && evt.result ? evt.result : {};
    S.running = false;
    S.done = true;
    S.proposal = null; // a final card replaces any waiting proposal
    S.keysIntake = null; // and any waiting keys card
    stopFigureStage(); // the run view is about to be replaced by the final card
    // The event is flat (ok/finalLine/repoUrl at the top). Older nested shapes
    // and error shapes are merged in so the final card always has its fields.
    S.final = {
      ...res,
      ...evt,
      ok: Boolean(evt && evt.ok !== undefined ? evt.ok : res.ok),
      message: (evt && (evt.message || evt.error)) || res.message || '',
      projectDir: (evt && evt.projectDir) || res.projectDir || '',
    };
    stopPolling();
    if (S.es) { S.es.close(); S.es = null; }
    render();
  }

  function connectEvents() {
    if (S.es) return;
    const es = new EventSource('/api/events');
    S.es = es;
    es.onmessage = (e) => {
      let evt; try { evt = JSON.parse(e.data); } catch { return; }
      stopPolling(); // the stream is alive again; polling would only double lines
      (S.events = S.events || []).push(evt);
      if (evt.type === 'progress') { S.progress = evt; updateRunPanel(evt); }
      if (evt.type === 'log') appendLog(evt.line);
      if (evt.type === 'phase') {
        renderRail();
        nextFigure(); // each new phase is a beat: the stage switches figures
        if (PHASE_LOG[evt.name]) {
          appendLog(PHASE_LOG[evt.name]);
          setRunStage(PHASE_LOG[evt.name]); // pulse the stage line until real progress lands
        }
        if (evt.name === 'repairing') appendLog(`Repair round ${evt.round}: ${((evt.report || []).slice(0, 3)).join(' | ')}`);
        if (evt.name === 'stopping') {
          appendLog('Stopping — killing the model process…');
          S.progress = { ...(S.progress || {}), stopping: true };
          updateRunPanel(S.progress);
        }
        if (evt.name === 'stopped') appendLog('Stopped. Everything written so far is saved in the project folder.');
        if (evt.name === 'creating-github') appendLog('Creating your GitHub repository and dispatching the first cycle.');
      }
      if (evt.type === 'file') appendLog(`wrote ${evt.path}`);
      if (evt.type === 'module') appendLog(`module ${evt.id} included`);
      if (evt.type === 'github') appendLog('Creating GitHub repository.');
      if (evt.type === 'error') appendLog(evt.message || 'The engine reported an error.');
      if (evt.type === 'proposal') { S.proposal = evt.proposal || null; renderProposal(); }
      if (evt.type === 'keys-intake') {
        S.keysIntake = { missing: evt.missing || [], unconfirmed: evt.unconfirmed || [], suspected: evt.suspected || [], note: evt.note || '', repo: evt.repo || null, round: evt.round || 1, total: evt.total || 0, sources: evt.sources || {} };
        renderKeysIntake();
      }
      if (evt.type === 'keys-intake-done') {
        S.keysIntake = null;
        renderKeysIntake();
        if (evt.stopped) appendLog('The keys intake was closed by a stop — the run winds down.');
        else if (evt.skipped) appendLog('Keys skipped for now — the run finishes with exact instructions; the next continue opens the intake again.');
        else if ((evt.names || []).length) appendLog(`Received ${evt.names.length} key value(s) — uploading to GitHub and re-checking (names only: ${evt.names.join(', ')}).`);
      }
      if (evt.type === 'proposal-decision') {
        appendLog(evt.stopped ? 'Stopped — the proposal was not applied.' : evt.approve ? 'Approved — the engine applies the fix and retries the step.' : 'Declined — nothing was applied. The run ends with a resume command.');
        S.proposal = null;
        renderProposal();
      }
      if (evt.type === 'final') handleFinal(evt);
    };
    // If the stream drops (sleep, tab throttle, proxy), /api/result keeps the
    // run visible. Without this the page used to sit on the summary forever.
    es.onerror = () => { startPolling(); };
  }

  let pollTimer = null;
  function startPolling() {
    if (pollTimer || S.done) return;
    pollTimer = setInterval(async () => {
      try {
        const r = await api('/api/result');
        if (r && r.run && r.run.done) handleFinal(r.run.result || { ok: false, message: 'The run ended without a result.' });
      } catch { /* server briefly busy; the next tick retries */ }
    }, 2000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function appendLog(line) {
    const el = document.getElementById('log');
    if (!el) return;
    el.textContent += line + '\n';
    const lines = el.textContent.split('\n');
    if (lines.length > 800) el.textContent = lines.slice(-800).join('\n'); // never grow unbounded
    el.scrollTop = el.scrollHeight;
  }

  function move(delta) {
    // While idle, the summary is the last reachable step; the progress view is
    // entered only by Confirm (or by a finished run on load).
    const max = (S.running || S.done) ? S.data.steps.length : S.data.steps.length - 1;
    S.stepIndex = Math.max(0, Math.min(max, S.stepIndex + delta));
    refresh();
  }

  // ---------- render loop ----------
  function render() {
    renderRail();
    renderAside();
    try {
      const resumeShown = S.showResume && !S.running && !S.done && !S.final;
      const id = stepId();
      const fn = resumeShown ? renderers.resume : (renderers[id] || renderers.progress);
      $main.innerHTML = fn();
      bindCommon();
      if (resumeShown) bindResume();
      else if (!S.running && !S.done) bindStep();
      if (id === 'progress' && !S.final && !resumeShown) mountFigureStage(); else stopFigureStage();
    } catch (e) {
      // A renderer must never leave a silent blank page behind.
      showFatal(`A step failed to draw: ${e && e.message ? e.message : e}`);
      return;
    }
    $foot.innerHTML = 'Up/Down move · Enter confirms · Esc goes back';
  }
  function refresh() { saveDraft(); render(); }

  async function load(isRecheck) {
    try {
      S.data = await api('/api/state');
      if (!S.data || S.data.error) throw new Error((S.data && S.data.error) || 'The engine returned no state.');
      if (!S.draft || isRecheck) {
        S.draft = S.data.draft || (await api('/api/state')).draft;
      }
      if (!S.draft) {
        // first visit: build a default draft locally then persist
        S.draft = {
          schema: 'devos/draft@1', theme: 'dark',
          models: { reviewer: { cli: null, model: null }, builder: { cli: null, model: null }, extraBuilders: [], lightReviewer: { same: true, cli: null, model: null }, pickPolicy: 'reviewer-picks', configurationModel: { cli: null, model: null } },
          saveDefaults: false,
          project: { name: '', slug: '', brief: '', audience: '', visibility: (S.data.defaults && S.data.defaults.visibility) || 'private', docs: [] },
          type: 'full', framework: 'next',
          customCommands: { install: '', typecheck: '', lint: '', test: '', build: '', e2e: '' },
          modules: {}, languages: ['en'], touched: { framework: false, modules: false },
        };
        await api('/api/draft', { method: 'POST', body: JSON.stringify(S.draft), headers: { 'Content-Type': 'application/json' } });
        S.data = await api('/api/state');
        S.draft = S.data.draft;
      }
      S.draft = normalizeDraft(S.draft);
      document.documentElement.dataset.theme = S.draft.theme === 'light' ? 'light' : 'dark';
      // A run may exist from before a reload or from another tab. Re-attach to it
      // instead of showing the summary as if nothing happened.
      if (!S.running && !S.done && S.data.running) { if (S.data.proposal) S.proposal = S.data.proposal; if (S.data.keysIntake) S.keysIntake = S.data.keysIntake; enterRunView(); return; }
      if (!S.running && !S.done && S.data.lastRun && S.data.lastRun.done) {
        const rr = S.data.lastRun.result || {};
        S.stepIndex = S.data.steps.length; // the final card lives on the progress view
        handleFinal({ ...rr, ok: rr.ok !== false, message: rr.message || rr.error || '', projectDir: rr.projectDir });
        return;
      }
      // A started project near the workspace gets first say: continue it, or
      // dismiss once and configure something new.
      if (!S.running && !S.done && !S.resumeDismissed && (S.data.resume?.candidates || []).length) {
        S.showResume = true;
      }
      render();
    } catch (e) {
      showFatal(e && e.message ? e.message : String(e));
    }
  }

  document.addEventListener('keydown', (e) => {
    if (S.running || S.done) return;
    if (e.key === 'Escape') { move(-1); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
      const next = document.getElementById('next') || document.getElementById('confirm');
      if (next && !next.disabled) next.click();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const focusables = [...document.querySelectorAll('[tabindex="0"], button, input, select, textarea, a')].filter((x) => !x.disabled && x.offsetParent);
      if (!focusables.length) return;
      const i = focusables.indexOf(document.activeElement);
      e.preventDefault();
      const n = focusables[(i + (e.key === 'ArrowDown' ? 1 : -1) + focusables.length) % focusables.length];
      n.focus();
    }
  });

  load(false);
})();
