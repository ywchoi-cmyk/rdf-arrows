/* RDF Arrows · 캔버스 그리기, 자동 배치, 화면 이동·확대, 마우스 조작 */
'use strict';

/* ---------- 렌더링 ---------- */
function el(tag, attrs, text){
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}
function renderAll(){ renderCanvas(); renderPanel(); renderOntoCard(); }
function applyView(){
  gView.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  $('#zoomLabel').textContent = Math.round(view.k * 100) + '%';
}
function renderCanvas(){
  applyView();
  gEdges.textContent = ''; gNodes.textContent = '';
  const sizes = new Map(state.nodes.map(n => [n.id, nodeSize(n)]));
  const nameCount = new Map();
  state.nodes.forEach(n => nameCount.set(n.name, (nameCount.get(n.name) || 0) + 1));
  const groups = new Map();
  state.edges.forEach(e => {
    const key = e.from === e.to ? 'self:' + e.from : [e.from, e.to].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  groups.forEach(list => list.forEach((e, i) => drawEdge(e, i, list.length, sizes)));
  if (typeof inferOverlay !== 'undefined' && inferOverlay && inferOverlay.show) inferOverlay.edges.forEach(o => {
    const a = nodeById(o.from), b = nodeById(o.to); if (!a || !b) return;
    const P0 = rectPoint(a, sizes.get(a.id), b.x, b.y), P2 = rectPoint(b, sizes.get(b.id), a.x, a.y);
    const d = `M${P0.x},${P0.y} L${P2.x},${P2.y}`;
    const g = el('g', { class: 'edge inferred' });
    g.append(el('path', { class: 'line', d, 'marker-end': 'url(#arrow)' }));
    const lx = (P0.x + P2.x) / 2, ly = (P0.y + P2.y) / 2, tw = textW('추론된 타입', `italic 11px ${FONT}`) + 14;
    g.append(el('rect', { class: 'pill', x: lx - tw / 2, y: ly - 10, width: tw, height: 20, rx: 10 }));
    g.append(el('text', { class: 'ltext', x: lx, y: ly + 4, 'text-anchor': 'middle' }, '추론된 타입'));
    gEdges.append(g);
  });
  state.nodes.forEach(n => drawNode(n, sizes.get(n.id), nameCount.get(n.name) > 1));
  $('#empty').hidden = state.nodes.length > 0;
}
function drawNode(n, s, dup){
  const sel = selection && selection.type === 'node' && selection.id === n.id;
  const indiv = isIndiv(n);
  const cls = ['node']; if (sel) cls.push('selected'); if (dup) cls.push('dup'); if (isExternal(n.name)) cls.push('external'); if (indiv) cls.push('indiv');
  const g = el('g', { class: cls.join(' '), 'data-node': n.id, transform: `translate(${n.x - s.w / 2},${n.y - s.h / 2})` });
  const rx = indiv ? Math.min(s.h / 2, 20) : 8;
  g.append(el('rect', { class: 'halo', 'data-halo': n.id, x: -10, y: -10, width: s.w + 20, height: s.h + 20, rx: rx + 8 }));
  const col = colorOf(n);
  g.append(el('rect', { class: 'body', x: 0, y: 0, width: s.w, height: s.h, rx, fill: col.fill, stroke: col.stroke }));
  g.append(el('text', { class: 'title', x: s.w / 2, y: 23, 'text-anchor': 'middle' }, nodeTitle(n)));
  if (s.sub) g.append(el('text', { class: 'sub', x: s.w / 2, y: 37, 'text-anchor': 'middle' }, s.sub));
  if (n.attrs.length){
    g.append(el('line', { class: 'divider', x1: 0, x2: s.w, y1: s.head, y2: s.head }));
    n.attrs.forEach((a, i) => g.append(el('text', { class: 'attrtext', x: 12, y: s.head + 18 + i * 18 }, attrText(n, a))));
  }
  gNodes.append(g);
}
function drawEdge(e, i, m, sizes){
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return;
  const sa = sizes.get(a.id), sb = sizes.get(b.id);
  let d, lx, ly;
  if (a === b){
    const r = 34 + i * 22;
    const S = { x: a.x + sa.w / 2 - 20, y: a.y - sa.h / 2 }, E = { x: a.x + sa.w / 2, y: a.y - sa.h / 2 + 18 };
    d = `M${S.x},${S.y} C${S.x},${S.y - r * 1.4} ${E.x + r * 1.4},${E.y} ${E.x},${E.y}`;
    lx = S.x + r * 0.75; ly = S.y - r * 0.6;
  } else {
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = (i - (m - 1) / 2) * 46;
    if (off){
      const cx = (a.x + b.x) / 2 + nx * off * 2, cy = (a.y + b.y) / 2 + ny * off * 2;
      const P0 = rectPoint(a, sa, cx, cy), P2 = rectPoint(b, sb, cx, cy);
      d = `M${P0.x},${P0.y} Q${cx},${cy} ${P2.x},${P2.y}`;
      lx = 0.25 * P0.x + 0.5 * cx + 0.25 * P2.x; ly = 0.25 * P0.y + 0.5 * cy + 0.25 * P2.y;
    } else {
      const P0 = rectPoint(a, sa, b.x, b.y), P2 = rectPoint(b, sb, a.x, a.y);
      d = `M${P0.x},${P0.y} L${P2.x},${P2.y}`;
      lx = (P0.x + P2.x) / 2; ly = (P0.y + P2.y) / 2;
    }
  }
  const sel = selection && selection.type === 'edge' && selection.id === e.id;
  const sub = e.kind === 'subclass', typ = e.kind === 'type', bad = edgeShape(e) === 'CI';
  const g = el('g', { class: 'edge' + (sel ? ' selected' : '') + (sub ? ' sub' : '') + (typ ? ' type' : '') + (bad ? ' bad' : ''), 'data-edge': e.id });
  g.append(el('path', { class: 'hit', d }));
  g.append(el('path', { class: 'line', d, 'marker-end': `url(#${sub ? 'tri' : 'arrow'}${sel ? '-sel' : ''})` }));
  const text = sub ? 'subClassOf' : typ ? 'rdf:type' : edgeTitle(e);
  if (text){
    const tw = textW(text, (sub || typ) ? `italic 11px ${FONT}` : `12px ${FONT}`) + 14;
    g.append(el('rect', { class: 'pill', x: lx - tw / 2, y: ly - 10, width: tw, height: 20, rx: 10 }));
    g.append(el('text', { class: 'ltext', x: lx, y: ly + 4, 'text-anchor': 'middle' }, text));
  }
  gEdges.append(g);
}
function select(sel){
  const same = (selection && sel && selection.type === sel.type && selection.id === sel.id) || (!selection && !sel);
  selection = sel;
  if (same) return;
  renderCanvas(); renderPanel();
}

/* ---------- 자동 배치 (간단한 힘 기반) ---------- */
function autoLayout(st, onlyUnplaced){
  const nodes = st.nodes; const N = nodes.length; if (!N) return;
  const movable = n => !onlyUnplaced || !n.placed;
  const R = Math.max(150, N * 32);
  nodes.forEach((n, i) => { if (movable(n)){ const a = (i / N) * Math.PI * 2; n.x = Math.cos(a) * R + (Math.random() - .5) * 10; n.y = Math.sin(a) * R + (Math.random() - .5) * 10; } });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const links = st.edges.filter(e => e.from !== e.to).map(e => [idx.get(e.from), idx.get(e.to)]).filter(l => l[0] !== undefined && l[1] !== undefined);
  const sizes = nodes.map(nodeSize);
  const ideal = 230;
  for (let it = 0; it < 400; it++){
    const t = 1 - it / 400;
    const fx = new Float64Array(N), fy = new Float64Array(N);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++){
      let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y; let d2 = dx * dx + dy * dy;
      if (d2 < 1){ dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
      const minD = (sizes[i].w + sizes[j].w) / 2 + 40;
      const f = (ideal * ideal + minD * minD) / d2;
      const d = Math.sqrt(d2); fx[i] += dx / d * f; fy[i] += dy / d * f; fx[j] -= dx / d * f; fy[j] -= dy / d * f;
    }
    links.forEach(([a, b]) => {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y, d = Math.hypot(dx, dy) || 1;
      const f = (d - ideal) * 0.08; fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
    });
    for (let i = 0; i < N; i++){
      fx[i] -= nodes[i].x * 0.01; fy[i] -= nodes[i].y * 0.01;
      if (!movable(nodes[i])) continue;
      const m = Math.hypot(fx[i], fy[i]) || 1, step = Math.min(m, 30 * t + 1);
      nodes[i].x += fx[i] / m * step; nodes[i].y += fy[i] / m * step;
    }
  }
  nodes.forEach(n => { n.x = Math.round(n.x); n.y = Math.round(n.y); });
}

/* ---------- 화면 ---------- */
function toWorld(ev){
  const r = svg.getBoundingClientRect();
  return { x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k };
}
function fit(){
  const r = svg.getBoundingClientRect();
  if (!state.nodes.length){ view = { x: r.width / 2, y: r.height / 2, k: 1 }; applyView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  state.nodes.forEach(n => { const s = nodeSize(n); x0 = Math.min(x0, n.x - s.w / 2); y0 = Math.min(y0, n.y - s.h / 2 - 60); x1 = Math.max(x1, n.x + s.w / 2 + 60); y1 = Math.max(y1, n.y + s.h / 2); });
  const pad = 60;
  const k = Math.min(1.4, Math.max(0.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  view = { k, x: r.width / 2 - (x0 + x1) / 2 * k, y: r.height / 2 - (y0 + y1) / 2 * k };
  applyView(); persist();
}
function zoomAt(k2, mx, my){
  k2 = Math.min(3, Math.max(0.2, k2));
  view.x = mx - (mx - view.x) * k2 / view.k; view.y = my - (my - view.y) * k2 / view.k; view.k = k2;
  applyView(); persist();
}

/* ---------- 포인터 ---------- */
let drag = null;
const nodeAtPoint = (cx, cy) => { const t = document.elementFromPoint(cx, cy); const g = t && t.closest && t.closest('[data-node]'); return g ? g.dataset.node : null; };
svg.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  const t = ev.target;
  const halo = t.closest('[data-halo]'), nodeG = t.closest('[data-node]'), edgeG = t.closest('[data-edge]');
  const p = toWorld(ev);
  if (halo){
    drag = { mode: 'link', from: halo.dataset.halo, sx: ev.clientX, sy: ev.clientY, moved: false };
  } else if (nodeG){
    const id = nodeG.dataset.node; select({ type: 'node', id });
    const n = nodeById(id); drag = { mode: 'move', id, start: p, orig: { x: n.x, y: n.y }, moved: false };
  } else if (edgeG){
    select({ type: 'edge', id: edgeG.dataset.edge }); drag = null;
  } else {
    drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y, moved: false };
  }
});
window.addEventListener('pointermove', ev => {
  if (!drag) return;
  if (drag.mode === 'move'){
    const p = toWorld(ev), n = nodeById(drag.id); if (!n) return;
    if (!drag.moved){ if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.k < 3) return; checkpoint(); drag.moved = true; }
    n.x = Math.round(drag.orig.x + p.x - drag.start.x); n.y = Math.round(drag.orig.y + p.y - drag.start.y);
    renderCanvas();
  } else if (drag.mode === 'pan'){
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true; view.x = drag.ox + dx; view.y = drag.oy + dy; applyView();
  } else if (drag.mode === 'link'){
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 8) return;
    drag.moved = true;
    const a = nodeById(drag.from); const p = toWorld(ev);
    const s = rectPoint(a, nodeSize(a), p.x, p.y);
    gOverlay.textContent = '';
    gOverlay.append(el('path', { class: 'temp', d: `M${s.x},${s.y} L${p.x},${p.y}`, 'marker-end': 'url(#arrow-sel)' }));
    const target = nodeAtPoint(ev.clientX, ev.clientY);
    gNodes.querySelectorAll('.linktarget').forEach(g => g.classList.remove('linktarget'));
    if (target){ const g = gNodes.querySelector(`[data-node="${target}"]`); g && g.classList.add('linktarget'); }
  }
});
window.addEventListener('pointerup', ev => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'link'){
    gOverlay.textContent = '';
    gNodes.querySelectorAll('.linktarget').forEach(g => g.classList.remove('linktarget'));
    if (!d.moved) return;
    const target = nodeAtPoint(ev.clientX, ev.clientY);
    checkpoint();
    let toId = target;
    if (!toId){ const p = toWorld(ev); toId = addNode(Math.round(p.x), Math.round(p.y), nodeById(d.from).kind || 'class').id; }
    const e = addEdge(d.from, toId);
    selection = { type: 'edge', id: e.id }; renderAll(); persist(); focusField(primaryField());
  } else if (d.mode === 'move'){ if (d.moved) persist(); }
  else if (d.mode === 'pan'){ if (d.moved) persist(); else { select(null); if (ui.card === 'open'){ ui.card = 'card'; ui.imports = false; renderOntoCard(); } } }
});
svg.addEventListener('dblclick', ev => {
  const nodeG = ev.target.closest('[data-node]'), edgeG = ev.target.closest('[data-edge]');
  if (nodeG){ select({ type: 'node', id: nodeG.dataset.node }); focusField(primaryField()); return; }
  if (edgeG){ select({ type: 'edge', id: edgeG.dataset.edge }); focusField(primaryField()); return; }
  checkpoint();
  const kind = ev.shiftKey ? (addKind === 'class' ? 'individual' : 'class') : addKind;
  const p = toWorld(ev); const n = addNode(Math.round(p.x), Math.round(p.y), kind);
  selection = { type: 'node', id: n.id }; renderAll(); persist(); focusField(primaryField());
});
svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  if (ev.ctrlKey || ev.metaKey){ zoomAt(view.k * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top); }
  else { view.x -= ev.deltaX; view.y -= ev.deltaY; applyView(); persist(); }
}, { passive: false });
$('#zIn').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(view.k * 1.2, r.width / 2, r.height / 2); };
$('#zOut').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(view.k / 1.2, r.width / 2, r.height / 2); };
$('#zFit').onclick = fit;

window.addEventListener('keydown', ev => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 'z' && !typing){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && ev.key.toLowerCase() === 'y' && !typing){ ev.preventDefault(); redo(); return; }
  if (typing){ if (ev.key === 'Escape') document.activeElement.blur(); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace'){ ev.preventDefault(); deleteSelection(); }
  else if (ev.key === 'Escape'){ if (!$('#helpModal').hidden) $('#helpModal').hidden = true; else if (!$('#checkModal').hidden) closeCheck(); else if (!$('#modal').hidden) closeModal(); else if (ui.card === 'open'){ ui.card = 'card'; renderOntoCard(); } else select(null); }
});
