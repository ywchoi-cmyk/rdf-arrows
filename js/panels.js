/* RDF Arrows · 오른쪽 패널 (클래스·개체·관계 편집) */
'use strict';

/* ---------- 패널 ---------- */
function field(label, inner, extra = ''){ return `<div class="field"><label>${label}</label>${inner}${extra}</div>`; }
function renderPanel(){
  const p = $('#panel');
  if (selection && selection.type === 'node') return nodePanel(p, nodeById(selection.id));
  if (selection && selection.type === 'edge') return edgePanel(p, edgeById(selection.id));
  emptyPanel(p);
}
function bindInputs(root, obj, onChange){
  root.querySelectorAll('[data-f]').forEach(inp => {
    inp.addEventListener('focus', checkpoint);
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      if (inp.type === 'checkbox') checkpoint();
      obj[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
      onChange(inp.dataset.f, inp);
      renderCanvas(); persist();
    });
  });
}
function setNodeKind(n, kind){
  if ((n.kind || 'class') === kind) return;
  checkpoint();
  n.kind = kind;
  if (n.nameAuto && !iriFirst()){ const nm = deriveName(n.label, nameKind(n)); if (nm) n.name = nm; }
  n.attrs.forEach(a => { if (a.value === undefined) a.value = ''; });
  state.edges.forEach(e => { if (e.from === n.id || e.to === n.id) normalizeEdge(e); });
  renderAll(); persist();
}
function nodePanel(p, n){
  const indiv = isIndiv(n);
  const dupe = state.nodes.some(o => o !== n && o.name === n.name);
  const links = state.edges.filter(e => (e.from === n.id || e.to === n.id) && e.kind !== 'type');
  const types = indiv ? typesOf(n) : [];
  const classes = state.nodes.filter(c => !isIndiv(c) && !types.includes(c));
  const linkLabel = e => e.kind === 'subclass' ? 'subClassOf' : (e.label || e.name);
  p.innerHTML = `<h3>${indiv ? '개체 (individual)' : '클래스'}</h3>
    ${field('종류', `<div class="seg"><button data-nk="class" class="${indiv ? '' : 'on'}">클래스 (TBox)</button><button data-nk="individual" class="${indiv ? 'on' : ''}">개체 (ABox)</button></div>`)}
    ${(() => {
      const il = importedLabel(fullIri(n.name));
      const labelF = field('라벨 (rdfs:label)', `<input type="text" data-f="label" value="${esc(n.label)}"${il ? ` placeholder="비워 두면 외부 라벨 “${esc(il)}”이 보입니다"` : iriFirst() ? ' placeholder="비워 두면 IRI 이름이 보입니다"' : ''}>`);
      const nameInput = indiv ? `<input type="text" class="mono" data-f="name" value="${esc(n.name)}">` : comboHTML(`class="mono" data-f="name" value="${esc(n.name)}"`, 'cls');
      const nameF = field('이름 (IRI)', `<div class="orow">${nameInput}${iriFirst() ? '' : autoChip(n.nameAuto, '라벨')}</div>`,
        `<div class="hint" id="iriPrev"></div><div class="warn" id="dupWarn"${dupe ? '' : ' hidden'}>같은 이름의 노드가 이미 있습니다.</div>`);
      return iriFirst() ? nameF + labelF : labelF + nameF; })()}
    ${indiv ? `<h4>타입 (rdf:type)</h4>
      <div>${types.map(c => `<span class="tag">${esc(nodeTitle(c))}<button data-untype="${c.id}" title="타입 해제">×</button></span>`).join('') || '<div class="hint" style="margin:0 0 8px">아직 타입이 없습니다. 개체 테두리를 끌어 클래스에 놓거나 아래에서 고르세요.</div>'}</div>
      ${classes.length ? `<select id="addType" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px;margin-bottom:12px"><option value="">+ 타입 추가…</option>${classes.map(c => `<option value="${c.id}">${esc(nodeTitle(c))}</option>`).join('')}</select>` : ''}` : ''}
    ${field('설명 (rdfs:comment)', `<textarea data-f="comment">${esc(n.comment)}</textarea>`)}
    <h4>${indiv ? '데이터 값' : '데이터 속성 (owl:DatatypeProperty)'}</h4>
    <div id="attrs">${n.attrs.map((a, i) => indiv ? `<div class="vrow">
        ${comboHTML(`class="mono" data-ai="${i}" data-af="name" value="${esc(a.name)}" placeholder="속성"`, 'dp')}
        <input type="text" data-ai="${i}" data-af="value" value="${esc(a.value ?? '')}" placeholder="값">
        <select data-ai="${i}" data-af="type">${XSD_TYPES.map(t => `<option${t === a.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <button class="x" data-del="${i}" title="삭제">×</button></div>` : `<div class="attr">
        ${comboHTML(`class="mono" data-ai="${i}" data-af="name" value="${esc(a.name)}" placeholder="이름"`, 'dp')}
        <select data-ai="${i}" data-af="type">${XSD_TYPES.map(t => `<option${t === a.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <button class="x" data-del="${i}" title="삭제">×</button></div>`).join('')}</div>
    <button class="btn" id="addAttr">+ ${indiv ? '데이터 값 추가' : '데이터 속성 추가'}</button>
    ${indiv ? '<div class="hint">속성 칸의 ▾를 누르면 클래스에 정의한 데이터 속성 목록이 나옵니다. 이 개체의 타입에 맞는 것은 "추천"으로 표시됩니다.</div>' : ''}
    ${indiv ? '' : `<h4>이어서 만들기</h4><div class="mkrow"><button class="btn" id="mkSub">+ 하위 클래스</button><button class="btn" id="mkInd">+ 이 클래스의 개체</button></div>`}
    <h4>색상</h4>
    ${(() => { const a = autoColor(n); return `<button class="swauto${n.color ? '' : ' on'}" data-color=""><i style="background:${a.fill};border-color:${a.stroke}"></i>자동 (${esc(a.name)})</button>`; })()}
    <div class="swatches">${PALETTE.map(c => `<button class="swatch${c.fill === n.color ? ' on' : ''}" data-color="${c.fill}" title="${esc(c.name)}" aria-label="${esc(c.name)}" style="background:${c.fill};border-color:${c.stroke}"></button>`).join('')}</div>
    <div class="hint">${indiv ? '자동이면 첫 번째 타입 클래스의 색을 씁니다.' : '자동이면 IRI로 색이 정해져, 같은 클래스는 어느 파일에서나 같은 색입니다.'}</div>
    ${links.length ? `<h4>연결된 관계</h4><ul class="linklist">${links.map(e => {
      const o = nodeById(e.from === n.id ? e.to : e.from);
      const txt = e.from === n.id ? `→ ${esc(linkLabel(e))} → ${esc(o ? (o.label || o.name) : '?')}` : `← ${esc(linkLabel(e))} ← ${esc(o ? (o.label || o.name) : '?')}`;
      return `<li data-goto="${e.id}">${txt}</li>`; }).join('')}</ul>` : ''}
    <h4></h4>
    <div class="btn-row"><button class="btn danger" id="delBtn">${indiv ? '개체' : '클래스'} 삭제</button></div>`;
  const prev = () => { $('#iriPrev').textContent = fullIri(n.name); };
  prev();
  bindInputs(p, n, (f) => {
    if (f === 'label' && n.nameAuto && !iriFirst()){
      const nm = deriveName(n.label, nameKind(n));
      if (nm){ n.name = nm; p.querySelector('[data-f=name]').value = nm; }
    }
    if (f === 'name'){ n.nameAuto = !n.name; if (!n.name) n.name = deriveName(n.label, nameKind(n)); setAutoChip(n.nameAuto, '라벨'); }
    prev();
    $('#dupWarn').hidden = !state.nodes.some(o => o !== n && o.name === n.name);
  });
  if ($('#nmAuto')) $('#nmAuto').addEventListener('click', () => {
    checkpoint(); n.nameAuto = !n.nameAuto;
    if (n.nameAuto){ const nm = deriveName(n.label, nameKind(n)); if (nm){ n.name = nm; p.querySelector('[data-f=name]').value = nm; } }
    setAutoChip(n.nameAuto, '라벨'); prev(); $('#dupWarn').hidden = !state.nodes.some(o => o !== n && o.name === n.name);
    renderCanvas(); persist();
  });
  attachCombos(p, { dp: { list: inp => dpOptions(n, n.attrs[+inp.dataset.ai]), ext: 'dp' }, cls: { list: () => [], ext: 'class', onExt: () => { n.nameAuto = false; setAutoChip(false, '라벨'); prev(); } } });
  p.querySelectorAll('[data-nk]').forEach(b => b.addEventListener('click', () => setNodeKind(n, b.dataset.nk)));
  p.querySelectorAll('[data-untype]').forEach(b => b.addEventListener('click', () => {
    checkpoint(); state.edges = state.edges.filter(e => !(e.from === n.id && e.to === b.dataset.untype && e.kind === 'type')); renderAll(); persist();
  }));
  const at = $('#addType');
  if (at) at.addEventListener('change', () => { if (!at.value) return; checkpoint(); addEdge(n.id, at.value); renderAll(); persist(); });
  p.querySelectorAll('[data-ai]').forEach(inp => {
    inp.addEventListener('focus', checkpoint);
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const a = n.attrs[+inp.dataset.ai];
      a[inp.dataset.af] = inp.value;
      if (inp.dataset.af === 'name' && indiv){
        // 클래스에 정의된 같은 이름의 데이터 속성이 있으면 타입을 맞춤
        const def = state.nodes.filter(c => !isIndiv(c)).flatMap(c => c.attrs).find(x => x.name === a.name);
        if (def){ a.type = def.type; const sel = p.querySelector(`select[data-ai="${inp.dataset.ai}"]`); if (sel) sel.value = def.type; }
      }
      renderCanvas(); persist();
    });
  });
  p.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    checkpoint(); n.attrs.splice(+b.dataset.del, 1); renderAll(); persist();
  }));
  $('#addAttr').addEventListener('click', () => {
    checkpoint();
    if (indiv){
      // 타입 클래스에 정의된 데이터 속성 중 아직 안 쓴 것을 먼저 제안
      const have = new Set(n.attrs.map(a => a.name));
      const def = typesOf(n).flatMap(c => c.attrs).find(a => a.name && !have.has(a.name));
      n.attrs.push(def ? { name: def.name, value: '', type: def.type } : { name: uniqueName('속성' + (n.attrs.length + 1), have), value: '', type: 'xsd:string' });
    } else {
      const used = new Set(n.attrs.map(a => a.name));
      n.attrs.push({ name: uniqueName('속성' + (n.attrs.length + 1), used), type: 'xsd:string' });
    }
    renderAll(); persist();
    const ins = p.querySelectorAll(indiv ? '[data-af=value]' : '[data-af=name]'); const last = ins[ins.length - 1];
    if (last){ last.focus(); last.select(); }
  });
  p.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    checkpoint(); n.color = b.dataset.color || null; renderAll(); persist();
  }));
  p.querySelectorAll('[data-goto]').forEach(li => li.addEventListener('click', () => select({ type: 'edge', id: li.dataset.goto })));
  $('#delBtn').addEventListener('click', deleteSelection);
  const mk = (kind, dy) => {
    checkpoint();
    const pos = placeNear(n, dy), c = addNode(pos.x, pos.y, kind), e = addEdge(c.id, n.id);
    if (kind === 'class') e.kind = 'subclass';
    selection = { type: 'node', id: c.id }; renderAll(); persist(); focusField(primaryField());
  };
  if ($('#mkSub')){ $('#mkSub').onclick = () => mk('class', 150); $('#mkInd').onclick = () => mk('individual', 170); }
}
/** 노드 아래쪽 빈 자리 찾기 */
function placeNear(n, dy){
  const y = n.y + dy;
  for (let k = 0; k < 24; k++){
    const x = n.x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 180;
    if (!state.nodes.some(o => Math.abs(o.x - x) < 160 && Math.abs(o.y - y) < 70)) return { x, y };
  }
  return { x: n.x + 200, y };
}
function edgePanel(p, e){
  const a = nodeById(e.from), b = nodeById(e.to);
  const shape = edgeShape(e);
  const sub = e.kind === 'subclass';
  const sameName = state.edges.filter(o => o.kind === 'object' && edgeShape(o) === 'CC' && o.name === e.name).length;
  const ends = `<div class="info">${esc(a ? (a.label || a.name) : '?')} <b>→</b> ${esc(b ? (b.label || b.name) : '?')}</div>`;
  const nameFields = (assert) => `
      ${(() => { const labelF = field('라벨 (rdfs:label)', `<input type="text" data-f="label" value="${esc(e.label)}" placeholder="${iriFirst() ? '비워 두면 IRI 이름이 보입니다' : '예: 소속되다'}">`);
        const nameF = field('이름 (IRI)', `<div class="orow">${comboHTML(`class="mono" data-f="name" value="${esc(e.name)}"`, 'op')}${iriFirst() ? '' : autoChip(e.nameAuto, '라벨')}</div>`, `<div class="hint" id="iriPrev"></div><div class="hint">▾를 누르면 이미 있는 관계 목록이 나옵니다. 같은 이름을 고르면 같은 속성으로 합쳐집니다.</div>`);
        return iriFirst() ? nameF + labelF : labelF + nameF; })()}
      ${assert ? '' : `<div class="info" id="mergeInfo"${sameName > 1 ? '' : ' hidden'}>같은 이름을 쓰는 관계 <b id="mergeN">${sameName}</b>개는 하나의 속성으로 합쳐집니다. 출발·도착 클래스가 여러 개면 domain·range가 owl:unionOf로 나갑니다.</div>
      ${field('설명 (rdfs:comment)', `<textarea data-f="comment">${esc(e.comment)}</textarea>`)}
      <div class="field"><label class="check"><input type="checkbox" data-f="functional"${e.functional ? ' checked' : ''}> 값이 하나만 허용됨 (owl:FunctionalProperty)</label></div>`}`;
  let body;
  if (shape === 'IC'){
    body = `<h3>타입 지정 (rdf:type)</h3>${ends}
      <div class="hint" style="margin-bottom:12px">이 개체가 해당 클래스의 인스턴스라는 뜻입니다.</div>
      <div class="btn-row"><button class="btn danger" id="delBtn">타입 해제</button></div>`;
  } else if (shape === 'II'){
    body = `<h3>개체 관계 (속성 값)</h3>${ends}
      <div class="hint" style="margin-bottom:12px">TTL에 <span class="mono">개체 속성 개체</span> 트리플로 나갑니다. 이름 칸의 ▾ 목록에서 두 개체의 타입에 맞는 관계는 "추천"으로 표시됩니다.</div>
      ${nameFields(true)}
      <div class="btn-row"><button class="btn" id="flipBtn">방향 뒤집기</button><button class="btn danger" id="delBtn">관계 삭제</button></div>`;
  } else if (shape === 'CI'){
    body = `<h3>관계</h3>${ends}
      <div class="warn" style="margin-bottom:12px">클래스에서 개체로 가는 연결은 TTL로 내보내지 않습니다. 타입을 지정하려면 방향을 뒤집으세요.</div>
      <div class="btn-row"><button class="btn" id="flipBtn">방향 뒤집기</button><button class="btn danger" id="delBtn">관계 삭제</button></div>`;
  } else {
    body = `<h3>관계</h3>${ends}
      ${field('유형', `<div class="seg"><button data-kind="object" class="${sub ? '' : 'on'}">객체 속성</button><button data-kind="subclass" class="${sub ? 'on' : ''}">subClassOf (상속)</button></div>`)}
      ${sub ? `<div class="hint" style="margin-bottom:12px">출발 클래스가 도착 클래스의 하위 클래스가 됩니다 (rdfs:subClassOf).</div>` : nameFields(false)}
      <div class="btn-row"><button class="btn" id="flipBtn">방향 뒤집기</button><button class="btn danger" id="delBtn">관계 삭제</button></div>`;
  }
  p.innerHTML = body;
  p.querySelectorAll('[data-kind]').forEach(btn => btn.addEventListener('click', () => {
    if (e.kind === btn.dataset.kind) return;
    checkpoint(); e.kind = btn.dataset.kind; renderAll(); persist();
  }));
  if (p.querySelector('[data-f=name]')){
    const prev = () => { $('#iriPrev').textContent = fullIri(e.name); };
    prev();
    bindInputs(p, e, (f) => {
      if (f === 'label' && e.nameAuto && !iriFirst()){
        const nm = deriveName(e.label, 'prop');
        if (nm){ e.name = nm; p.querySelector('[data-f=name]').value = nm; }
      }
      if (f === 'name'){
        e.nameAuto = !e.name; if (!e.name) e.name = deriveName(e.label, 'prop') || 'relatedTo'; setAutoChip(e.nameAuto, '라벨');
        // 이미 정의된 관계 이름을 고르면 라벨도 맞춤
        const def = state.edges.find(o => o !== e && o.kind === 'object' && o.name === e.name && o.label);
        if (def && !e.label){ e.label = def.label; p.querySelector('[data-f=label]').value = def.label; }
      }
      prev();
      const mi = $('#mergeInfo');
      if (mi){ const n2 = state.edges.filter(o => o.kind === 'object' && edgeShape(o) === 'CC' && o.name === e.name).length; mi.hidden = n2 < 2; $('#mergeN').textContent = n2; }
    });
    if ($('#nmAuto')) $('#nmAuto').addEventListener('click', () => {
      checkpoint(); e.nameAuto = !e.nameAuto;
      if (e.nameAuto){ const nm = deriveName(e.label, 'prop'); if (nm){ e.name = nm; p.querySelector('[data-f=name]').value = nm; } }
      setAutoChip(e.nameAuto, '라벨'); prev(); renderCanvas(); persist();
    });
    attachCombos(p, { op: { list: () => opOptions(e), ext: 'op', onPick: (inp, o) => {
      // 같은 속성을 골랐으면 라벨도 그 속성의 라벨로
      const def = state.edges.find(x => x !== e && x.kind === 'object' && x.name === o.value && x.label);
      if (def){ e.label = def.label; p.querySelector('[data-f=label]').value = def.label; }
      e.nameAuto = false; setAutoChip(false, '라벨'); renderCanvas(); persist();
    } } });
  }
  const fb = $('#flipBtn');
  if (fb) fb.addEventListener('click', () => { checkpoint(); [e.from, e.to] = [e.to, e.from]; normalizeEdge(e); renderAll(); persist(); });
  $('#delBtn').addEventListener('click', deleteSelection);
}
function focusField(f){
  const inp = $('#panel').querySelector(`[data-f=${f}]`);
  if (inp){ inp.focus(); inp.select && inp.select(); }
}
