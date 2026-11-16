/* RDF Arrows · 이름 칸 드롭다운 (▾ 목록, 추천, 외부 용어 구역) */
'use strict';

/* ---------- 콤보: 입력칸 + ▾ 누르면 전체 목록 ---------- */
function comboHTML(inputAttrs, kind){
  return `<div class="combo"><input type="text" ${inputAttrs} data-combo="${kind}" autocomplete="off" spellcheck="false"><button type="button" class="combo-btn" tabindex="-1" aria-label="목록 열기" title="목록 열기">▾</button><div class="combo-menu" role="listbox" hidden></div></div>`;
}
const autoChip = (on, what) => `<button type="button" class="ochip${on ? ' on' : ''}" id="nmAuto" title="${on ? '이름을 직접 고치면 고정됩니다' : '누르면 라벨을 따라 이름이 바뀝니다'}">${on ? `${what} 따라감` : '직접 지정 · 따라가게'}</button>`;
function setAutoChip(on, what){ const c = $('#nmAuto'); if (!c) return; c.classList.toggle('on', on); c.textContent = on ? `${what} 따라감` : '직접 지정 · 따라가게'; c.title = on ? '이름을 직접 고치면 고정됩니다' : '누르면 라벨을 따라 이름이 바뀝니다'; }
const nlabel = n => n ? nodeTitle(n) : '?';
/** 객체 속성 후보: 이름별로 묶고 쓰이는 곳(출발 → 도착)을 함께 보여 줌 */
function opOptions(edge){
  const map = new Map();
  state.edges.filter(o => o.kind === 'object' && o.name && o !== edge).forEach(o => {
    if (!map.has(o.name)) map.set(o.name, { value: o.name, label: '', uses: [], tbox: false, suggest: false });
    const it = map.get(o.name); if (!it.label && o.label) it.label = o.label;
    if (edgeShape(o) === 'CC'){ it.tbox = true; it.uses.push(`${nlabel(nodeById(o.from))} → ${nlabel(nodeById(o.to))}`); }
  });
  if (edge && edgeShape(edge) === 'II'){
    const ta = typeClosure(nodeById(edge.from)), tb = typeClosure(nodeById(edge.to));
    state.edges.filter(o => o.kind === 'object' && edgeShape(o) === 'CC' && ta.has(o.from) && tb.has(o.to)).forEach(o => { map.get(o.name).suggest = true; });
  }
  return [...map.values()].map(it => ({ value: it.value, title: it.label || it.value, sub: it.value, hint: it.tbox ? [...new Set(it.uses)].join(', ') : '개체 사이에서만 쓰임', badge: it.suggest ? '추천' : '' }))
    .sort((x, y) => (y.badge ? 1 : 0) - (x.badge ? 1 : 0));
}
/** 데이터 속성 후보: 클래스에 정의된 것 우선, 개체의 타입에 맞으면 추천 */
function dpOptions(node, skip){
  const map = new Map();
  state.nodes.forEach(n => n.attrs.forEach(a => {
    if (!a.name || a === skip) return;
    if (!map.has(a.name)) map.set(a.name, { value: a.name, types: new Set(), classes: [], ids: new Set() });
    const it = map.get(a.name); if (!isIndiv(n)){ it.types.add(a.type); it.classes.push(nlabel(n)); it.ids.add(n.id); }
  }));
  const tc = node && isIndiv(node) ? typeClosure(node) : new Set();
  return [...map.values()].map(it => ({ value: it.value, title: it.value, sub: [...it.types].join(', '), hint: it.classes.length ? it.classes.join(', ') + '에 정의' : '개체에서만 쓰임', badge: [...it.ids].some(id => tc.has(id)) ? '추천' : '' }))
    .sort((x, y) => (y.badge ? 1 : 0) - (x.badge ? 1 : 0));
}
function attachCombos(root, providers){
  root.querySelectorAll('input[data-combo]').forEach(inp => {
    const wrap = inp.parentElement, menu = wrap.querySelector('.combo-menu'), btn = wrap.querySelector('.combo-btn');
    const prov = providers[inp.dataset.combo]; if (!prov) return;
    let items = [], act = -1, lastAll = false, picking = false;
    const close = () => { menu.hidden = true; act = -1; if (activeCombo && activeCombo.menu === menu) activeCombo = null; };
    const hl = () => menu.querySelectorAll('.combo-item').forEach((b, i) => { b.classList.toggle('act', i === act); if (i === act) b.scrollIntoView({ block: 'nearest' }); });
    const pick = o => {
      inp.value = o.value; inp.dispatchEvent(new Event('input', { bubbles: true }));
      if (o.ext){ pinImport(o.ext); if (prov.onExt) prov.onExt(inp, o.ext); }
      if (prov.onPick) prov.onPick(inp, o);
      renderCanvas(); persist(); close();
    };
    const itemHTML = o => { items.push(o); return `<button type="button" role="option" class="combo-item" data-i="${items.length - 1}">${o.badge ? `<span class="chip info">${esc(o.badge)}</span> ` : ''}<b>${esc(o.title)}</b>${o.sub && o.sub !== o.title ? ` <span class="mono">${esc(o.sub)}</span>` : ''}<span class="hint">${esc(o.hint || '')}</span></button>`; };
    const open = all => {
      lastAll = all; items = [];
      const q = inp.value.trim().toLowerCase(), opts = prov.list(inp), want = prov.ext;
      const local = all || !q || opts.some(o => o.value.toLowerCase() === q) ? opts : opts.filter(o => (o.value + ' ' + o.title).toLowerCase().includes(q));
      let html = '';
      if (local.length) html += (want ? '<div class="combo-sec">이 온톨로지</div>' : '') + local.map(itemHTML).join('');
      if (want){
        const eq = (all ? '' : q);
        const pinned = (state.meta.imports || []).filter(t => kindOk(t.kind, want) && (!eq || (t.label + ' ' + t.iri).toLowerCase().includes(eq)) && compactIri(t.iri) !== inp.value.trim());
        if (pinned.length) html += '<div class="combo-sec">가져온 외부 용어</div>' + pinned.map(t => itemHTML({ value: compactIri(t.iri), title: t.label, sub: compactIri(t.iri), hint: KIND_KO[t.kind], ext: t })).join('');
        if (eq){
          const r = searchVocab(eq, want, 30);
          if (r.total) html += `<div class="combo-sec">외부에서 찾음 · ${r.total}개${r.total > 30 ? ' (앞 30개)' : ''}</div>` + r.list.map(t => itemHTML({ value: compactIri(t.iri), title: t.label, sub: compactIri(t.iri), hint: t.def || KIND_KO[t.kind], ext: t })).join('');
        }
        const extras = extraList(state.meta);
        html += '<div class="combo-sec">외부 온톨로지</div>' + (extras.length ? extras.map(sourceRowHTML).join('') : '<div class="combo-empty">온톨로지 카드 설정의 "외부 온톨로지"에서 추가하면 여기서 용어를 불러올 수 있습니다.</div>');
      }
      if (!items.length && !want) html = `<div class="combo-empty">${opts.length ? '맞는 항목이 없습니다. 입력한 이름으로 새로 만듭니다.' : '아직 정의된 항목이 없습니다.'}</div>`;
      menu.innerHTML = html; menu.hidden = false; act = -1;
      activeCombo = { menu, reopen: () => { const st = menu.scrollTop; open(lastAll); menu.scrollTop = st; } };
      menu.querySelectorAll('.combo-item').forEach(b => { b.addEventListener('mousedown', ev => ev.preventDefault()); b.addEventListener('click', () => pick(items[+b.dataset.i])); });
      menu.querySelectorAll('.combo-src button').forEach(b => {
        b.addEventListener('mousedown', ev => ev.preventDefault());
        b.addEventListener('click', () => {
          const ns = b.dataset.ns;
          if (b.dataset.act === 'load') loadVocab(ns);
          else if (b.dataset.act === 'cancel'){ const v = vocab[ns]; if (v && v.ctl) v.ctl.abort(); }
          else if (b.dataset.act === 'file'){
            const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.ttl,.rdf,.owl,.xml,.nt,.n3,text/turtle,application/rdf+xml';
            picking = true;
            fi.onchange = () => { picking = false; const f = fi.files[0]; if (f) uploadVocab(ns, f); };
            fi.click();
          }
        });
      });
      menu.querySelectorAll('.combo-src a').forEach(a => a.addEventListener('mousedown', ev => ev.preventDefault()));
    };
    btn.addEventListener('mousedown', ev => ev.preventDefault());
    btn.addEventListener('click', () => { if (!menu.hidden) return close(); inp.focus(); open(true); });
    inp.addEventListener('input', ev => { if (ev.isTrusted) open(false); });
    inp.addEventListener('blur', () => setTimeout(() => { if (!picking && document.activeElement !== inp) close(); }, 150));
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown'){ ev.preventDefault(); if (menu.hidden) open(true); else { act = Math.min(items.length - 1, act + 1); hl(); } }
      else if (ev.key === 'ArrowUp' && !menu.hidden){ ev.preventDefault(); act = Math.max(0, act - 1); hl(); }
      else if (ev.key === 'Enter' && !menu.hidden && act >= 0){ ev.preventDefault(); pick(items[act]); }
      else if (ev.key === 'Escape' && !menu.hidden){ ev.preventDefault(); ev.stopPropagation(); close(); }
    });
  });
}
