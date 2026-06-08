/* ============================================================
   Merrell Family Archive — app.js
   Responsibilities:
     1. Render D3 force-directed graph from GRAPH_DATA
     2. Handle node selection → populate sidebar citations
     3. Load documents into the viewer panel
     4. Tweaks panel (live physics + display controls)
     5. Responsive behaviour (sidebar/viewer open/close on mobile/tablet)
   ============================================================ */

// ── Wait for D3 + data ────────────────────────────────────────
// graph-data.js is 1.7MB — it finishes parsing after DOMContentLoaded
// fires, so we poll briefly instead of relying on a single event.
function waitForData(attempts) {
  if (attempts <= 0) {
    document.getElementById('placeholder').innerHTML =
      'Failed to load graph data.<br>Check browser console for errors.';
    return;
  }
  if (typeof d3 === 'undefined' || typeof GRAPH_DATA === 'undefined') {
    setTimeout(() => waitForData(attempts - 1), 100);
    return;
  }
  initApp();
}
document.addEventListener('DOMContentLoaded', () => waitForData(50));

function initApp() {
  const { nodes, edges, docs } = GRAPH_DATA;

  // ── DOM refs ─────────────────────────────────────────────────
  const svgEl        = document.getElementById('graph-canvas');
  const graphWrap    = document.getElementById('graph-wrap');
  const infoPanel    = document.getElementById('info-panel');
  const backdrop     = document.getElementById('backdrop');
  const sidebar      = document.getElementById('sidebar');
  const viewer       = document.getElementById('viewer');
  const viewerTitle  = document.getElementById('viewer-title');
  const viewerClose  = document.getElementById('viewer-close');
  const docFrame     = document.getElementById('doc-frame');
  const imgViewer    = document.getElementById('img-viewer');
  const imgEl        = document.getElementById('doc-image');
  const viewerLoading = document.getElementById('viewer-loading');
  const dlBtn        = document.getElementById('dl-btn');
  const tooltip      = document.getElementById('tooltip');

  // ── Responsive helpers ────────────────────────────────────────
  const isMobile  = () => window.innerWidth < 640;
  const isTablet  = () => window.innerWidth >= 640 && window.innerWidth < 1024;
  const isDesktop = () => window.innerWidth >= 1024;

  function openSidebar() {
    sidebar.classList.add('open');
    if (!isDesktop()) backdrop.classList.add('active');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
  }
  function openViewer() {
    viewer.classList.remove('hidden');
    viewer.classList.add('open');
    if (!isDesktop()) backdrop.classList.add('active');
    document.getElementById('btn-viewer').classList.add('active');
  }
  function closeViewer() {
    viewer.classList.remove('open');
    if (!isDesktop()) {
      backdrop.classList.remove('active');
    }
    document.getElementById('btn-viewer').classList.remove('active');
    // Clear content
    docFrame.src = 'about:blank';
    imgViewer.classList.remove('active');
    imgEl.src = '';
  }

  backdrop.addEventListener('click', () => {
    closeSidebar();
    closeViewer();
  });

  // Header button wiring
  document.getElementById('btn-graph').addEventListener('click', () => {
    closeSidebar();
    closeViewer();
  });
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (!isDesktop() && sidebar.classList.contains('open')) {
      backdrop.classList.add('active');
    } else if (!sidebar.classList.contains('open')) {
      backdrop.classList.remove('active');
    }
  });
  document.getElementById('btn-viewer').addEventListener('click', () => {
    if (viewer.classList.contains('open')) {
      closeViewer();
    } else {
      openViewer();
    }
  });
  viewerClose.addEventListener('click', closeViewer);

  // ── SVG setup ─────────────────────────────────────────────────
  const svg = d3.select(svgEl);
  const g   = svg.append('g').attr('id', 'scene');

  let width  = graphWrap.clientWidth;
  let height = graphWrap.clientHeight;

  const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  // Click on background de-selects
  svg.on('click', () => {
    selectedNode = null;
    resetHighlight();
    showPlaceholder();
  });

  // ── Node helpers ──────────────────────────────────────────────
  let nodeScaleFactor = 1.0;

  function nodeRadius(n) {
    const base = Math.sqrt(n.doc_count || 1) * 2.5;
    let r;
    if (n.type === 'category') r = Math.max(18, base);
    else if (n.role === 'patriarch' || n.role === 'matriarch') r = Math.max(16, base);
    else r = Math.max(7, Math.min(base, 28));
    return r * nodeScaleFactor;
  }

  const COLOR = {
    patriarch:  '#c084fc',
    matriarch:  '#c084fc',
    child:      '#818cf8',
    ancestor:   '#94a3b8',
    grandchild: '#a78bfa',
    other_person: '#a8a29e',
    place:      '#34d399',
    theme:      '#fb923c',
    category:   '#38bdf8',
  };
  function nodeColor(n) {
    if (n.type === 'person')   return COLOR[n.role] || COLOR.other_person;
    if (n.type === 'place')    return COLOR.place;
    if (n.type === 'theme')    return COLOR.theme;
    if (n.type === 'category') return COLOR.category;
    return '#6b7280';
  }

  // ── Simulation ────────────────────────────────────────────────
  const sim = d3.forceSimulation(nodes)
    .alphaDecay(0.015)
    .velocityDecay(0.55)
    .force('link', d3.forceLink(edges)
      .id(d => d.id)
      .distance(d => 120 - Math.min(d.weight || 1, 30) * 1.5)
      .strength(0.15))
    .force('charge', d3.forceManyBody()
      .strength(d => -nodeRadius(d) * 6)
      .distanceMax(300))
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 6).strength(0.7));

  // ── Draw links ─────────────────────────────────────────────────
  const link = g.append('g').attr('id', 'links').selectAll('line')
    .data(edges).enter().append('line')
      .attr('class', 'link')
      .attr('stroke', d => {
        if (d.type === 'person_person') return '#818cf8';
        if (d.type === 'person_place')  return '#34d399';
        if (d.type === 'person_theme')  return '#fb923c';
        return '#38bdf8';
      })
      .attr('stroke-width', d => Math.max(0.5, Math.sqrt(d.weight || 1) * 0.4));

  // ── Draw nodes ─────────────────────────────────────────────────
  const node = g.append('g').attr('id', 'nodes').selectAll('.node')
    .data(nodes).enter().append('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on('click', (e, d) => { e.stopPropagation(); selectNode(d); })
      .on('mouseover', (e, d) => showTooltip(e, d))
      .on('mousemove', (e)    => moveTooltip(e))
      .on('mouseout',  ()     => hideTooltip());

  node.append('circle')
    .attr('r', d => nodeRadius(d))
    .attr('fill', d => nodeColor(d))
    .attr('stroke', d => d3.color(nodeColor(d)).darker(0.8));

  node.append('text')
    .attr('dy', d => nodeRadius(d) + 11)
    .attr('text-anchor', 'middle')
    .text(d => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label);

  // Tick
  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // ── Edge map for adjacency ────────────────────────────────────
  const edgeMap = new Map();
  edges.forEach(e => {
    const s = e.source.id || e.source;
    const t = e.target.id || e.target;
    if (!edgeMap.has(s)) edgeMap.set(s, new Set());
    if (!edgeMap.has(t)) edgeMap.set(t, new Set());
    edgeMap.get(s).add(t);
    edgeMap.get(t).add(s);
  });

  // Stats
  document.getElementById('stat-nodes').textContent = nodes.length;
  document.getElementById('stat-edges').textContent = edges.length;

  // ── Tooltip ───────────────────────────────────────────────────
  function showTooltip(e, d) {
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong>${esc(d.label)}</strong><br>${d.type} · ${d.doc_count} docs`;
    moveTooltip(e);
  }
  function moveTooltip(e) {
    const rect = graphWrap.getBoundingClientRect();
    tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
    tooltip.style.top  = (e.clientY - rect.top  - 12) + 'px';
  }
  function hideTooltip() { tooltip.style.display = 'none'; }

  // ── Node selection ────────────────────────────────────────────
  let selectedNode = null;

  function selectNode(d) {
    selectedNode = d;
    const connected = new Set([d.id]);
    (edgeMap.get(d.id) || new Set()).forEach(id => connected.add(id));

    node.classed('highlighted', n => n.id === d.id)
        .classed('dimmed', n => !connected.has(n.id));
    link.classed('dimmed', l => {
      const s = l.source.id || l.source;
      const t = l.target.id || l.target;
      return !connected.has(s) || !connected.has(t);
    });

    renderSidebar(d);
    if (isMobile()) openSidebar();
  }

  function resetHighlight() {
    node.classed('highlighted', false).classed('dimmed', false);
    link.classed('dimmed', false);
  }

  // ── Sidebar rendering ─────────────────────────────────────────
  const CAT_COLOR = {
    '02_Journals':       '#818cf8',
    '03_Family_History': '#c084fc',
    '04_Church_LDS':     '#34d399',
    '05_Financial':      '#fb923c',
    '07_Work':           '#94a3b8',
  };

  function showPlaceholder() {
    infoPanel.innerHTML = `<div id="placeholder" style="text-align:center;color:var(--muted);font-size:12px;margin-top:40px;line-height:2">
      Click any node to explore<br>documents and connections
    </div>`;
  }
  showPlaceholder();

  function renderSidebar(d) {
    const color = nodeColor(d);
    const connected = Array.from(edgeMap.get(d.id) || []);
    const connNodes = nodes.filter(n => connected.includes(n.id))
      .sort((a, b) => b.doc_count - a.doc_count).slice(0, 20);

    let html = `
      <div class="node-title">${esc(d.label)}</div>
      <div class="node-meta">
        <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${d.type}</span>
        ${d.role ? `<span class="badge" style="background:#ffffff10;color:var(--muted)">${d.role}</span>` : ''}
        <span style="color:var(--muted)">${d.doc_count} document${d.doc_count !== 1 ? 's' : ''}</span>
      </div>`;

    // Connected nodes
    if (connNodes.length) {
      html += `<div class="sec-title">Connected To</div><div class="connections-list">`;
      connNodes.forEach(n => {
        const nc = nodeColor(n);
        html += `<span class="conn-chip" style="background:${nc}18;color:${nc};border-color:${nc}40"
          data-node-id="${esc(n.id)}">${esc(n.label)}</span>`;
      });
      html += `</div>`;
    }

    // Citation cards
    const docIds = d.docs || [];
    if (docIds.length) {
      html += `<div class="sec-title">Source Documents · ${docIds.length}${docIds.length >= 50 ? '+' : ''}</div>`;
      docIds.slice(0, 30).forEach(did => {
        const doc = docs[did];
        if (!doc) return;
        const cc = CAT_COLOR[doc.category] || '#666';
        const date = doc.file_date || doc.mod_date || '';
        const people = (doc.people || []).slice(0, 4).join(', ');
        const places = (doc.places || []).slice(0, 3).join(', ');
        const themes = (doc.themes || []).map(t =>
          `<span class="theme-chip">${t.replace('_', ' ')}</span>`).join('');

        html += `<div class="doc-card" data-path="${esc(doc.path)}" data-title="${esc(doc.title || doc.filename)}">
          <div class="dc-title">${esc(doc.title || doc.filename)}</div>
          <div class="dc-meta">
            <span style="color:${cc};font-weight:600">${doc.category}</span>
            ${date ? ` · <span style="color:var(--green)">${esc(date)}</span>` : ''}
            ${doc.word_count ? ` · ${doc.word_count.toLocaleString()} words` : ''}
            ${doc.size_kb ? ` · ${doc.size_kb} KB` : ''}
          </div>
          <div class="dc-path">${esc(doc.path)}</div>
          ${people ? `<div class="dc-people">👤 ${esc(people)}</div>` : ''}
          ${places ? `<div class="dc-places">📍 ${esc(places)}</div>` : ''}
          ${themes ? `<div class="dc-themes">${themes}</div>` : ''}
          ${doc.summary ? `<div class="dc-summary">${esc(doc.summary.slice(0, 220))}…</div>` : ''}
        </div>`;
      });
      if (docIds.length > 30) {
        html += `<div class="more-docs">+ ${docIds.length - 30} more documents</div>`;
      }
    }

    infoPanel.innerHTML = html;

    // Wire citation clicks
    infoPanel.querySelectorAll('.doc-card').forEach(card => {
      card.addEventListener('click', () => {
        infoPanel.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        loadDoc(card.dataset.path, card.dataset.title);
      });
    });

    // Wire connection chip clicks
    infoPanel.querySelectorAll('.conn-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const n = nodes.find(nd => nd.id === chip.dataset.nodeId);
        if (n) selectNode(n);
      });
    });
  }

  // ── Document viewer ───────────────────────────────────────────
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.JPG', '.PNG']);
  const PDF_EXTS   = new Set(['.pdf']);

  function loadDoc(relPath, title) {
    const ext = relPath.split('.').pop().toLowerCase();
    const base = window.APP_BASE || '';
    const apiUrl = `${base}/api/doc?path=${encodeURIComponent(relPath)}`;
    const rawUrl = `${base}/api/raw?path=${encodeURIComponent(relPath)}`;

    viewerTitle.textContent = title || relPath.split('/').pop();
    dlBtn.href = rawUrl;
    dlBtn.download = relPath.split('/').pop();

    // Show viewer
    openViewer();

    // Show loading
    viewerLoading.classList.add('active');
    imgViewer.classList.remove('active');
    docFrame.style.display = 'none';
    docFrame.src = 'about:blank';

    if (IMAGE_EXTS.has('.' + ext)) {
      // Image: use the img tag inside img-viewer
      imgEl.onload  = () => { viewerLoading.classList.remove('active'); };
      imgEl.onerror = () => { viewerLoading.classList.remove('active'); };
      imgEl.src = apiUrl;
      imgViewer.classList.add('active');
      viewerLoading.classList.remove('active');
    } else {
      // HTML/PDF: load in iframe
      docFrame.style.display = 'block';
      docFrame.onload = () => { viewerLoading.classList.remove('active'); };
      docFrame.src = apiUrl;
    }
  }

  // ── Search ────────────────────────────────────────────────────
  document.getElementById('search').addEventListener('input', function () {
    const q = this.value.toLowerCase().trim();
    if (!q) { resetHighlight(); return; }
    const matched = new Set(nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
    node.classed('dimmed', n => !matched.has(n.id));
    link.classed('dimmed', l => {
      const s = l.source.id || l.source;
      const t = l.target.id || l.target;
      return !matched.has(s) && !matched.has(t);
    });
  });

  // ── Filters ───────────────────────────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const type = this.dataset.type;
      node.style('display', d => type === 'all' || d.type === type ? null : 'none');
      link.style('display', l => {
        if (type === 'all') return null;
        const s = nodes.find(n => n.id === (l.source.id || l.source));
        const t = nodes.find(n => n.id === (l.target.id || l.target));
        return (s && s.type === type) || (t && t.type === type) ? null : 'none';
      });
      resetHighlight();
    });
  });

  // ── Tweaks panel ──────────────────────────────────────────────
  document.getElementById('tweaks-toggle').addEventListener('click', () => {
    document.getElementById('tweaks-toggle').classList.toggle('open');
    document.getElementById('tweaks-panel').classList.toggle('open');
  });

  function tw(id)  { return document.getElementById(id); }
  function setVal(id, v) { tw(id).textContent = v; }

  tw('sl-spacing').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-spacing', v);
    sim.force('link').distance(d => v - Math.min(d.weight||1,30)*1.5);
    sim.alpha(0.3).restart();
  });
  tw('sl-charge').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-charge', v);
    sim.force('charge').strength(d => -nodeRadius(d) * v);
    sim.alpha(0.3).restart();
  });
  tw('sl-link').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-link', v.toFixed(2));
    sim.force('link').strength(v);
    sim.alpha(0.3).restart();
  });
  tw('sl-friction').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-friction', v.toFixed(2));
    sim.velocityDecay(v);
    sim.alpha(0.1).restart();
  });
  tw('sl-collide').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-collide', v);
    sim.force('collision').radius(d => nodeRadius(d) + v);
    sim.alpha(0.2).restart();
  });
  tw('sl-scale').addEventListener('input', function () {
    const v = +this.value;
    nodeScaleFactor = v;
    setVal('val-scale', v.toFixed(2));
    node.select('circle').attr('r', d => nodeRadius(d));
    node.select('text').attr('dy', d => nodeRadius(d) + 11);
    sim.force('collision').radius(d => nodeRadius(d) + +tw('sl-collide').value);
    sim.alpha(0.1).restart();
  });
  tw('sl-opacity').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-opacity', v.toFixed(2));
    link.attr('stroke-opacity', v);
  });
  tw('sl-label').addEventListener('input', function () {
    const v = +this.value;
    setVal('val-label', v);
    node.select('text').style('font-size', d => (d.type === 'category' ? v+2 : v) + 'px');
  });

  document.getElementById('tweak-reheat').addEventListener('click',  () => sim.alpha(0.8).restart());
  document.getElementById('tweak-freeze').addEventListener('click',  () => sim.stop());
  document.getElementById('tweak-reset').addEventListener('click',   () => {
    const defaults = { 'sl-spacing':120,'sl-charge':6,'sl-link':0.15,
                       'sl-friction':0.55,'sl-collide':6,'sl-scale':1.0,
                       'sl-opacity':0.25,'sl-label':9 };
    Object.entries(defaults).forEach(([id, v]) => { tw(id).value = v; tw(id).dispatchEvent(new Event('input')); });
  });

  // ── Resize ────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    width  = graphWrap.clientWidth;
    height = graphWrap.clientHeight;
    sim.force('center', d3.forceCenter(width/2, height/2)).alpha(0.05).restart();
  });
  ro.observe(graphWrap);

  // ── Utility ───────────────────────────────────────────────────
  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
