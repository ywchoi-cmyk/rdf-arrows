/* RDF Arrows · Turtle 내보내기와 내보내기 전 점검 */
'use strict';

/* ---------- Turtle 내보내기 ---------- */
const escLit = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
function lit(s){
  const lang = (state.meta.lang || '').trim();
  return `"${escLit(s)}"` + (lang ? '@' + lang : '');
}
/** 개체의 데이터 값 → 타입이 붙은 리터럴 */
function valueLit(a, pm){
  const q = `"${escLit(a.value ?? '')}"`, t = a.type || 'xsd:string';
  if (t === 'xsd:string' || t === 'rdfs:Literal') return q;
  if (t === 'rdf:langString') return lit(a.value ?? '');
  return q + '^^' + ttlTerm(t, pm);
}
function classExpr(terms){
  const u = [...new Set(terms)];
  return u.length === 1 ? u[0] : `[ a owl:Class ; owl:unionOf ( ${u.join(' ')} ) ]`;
}
function block(subject, types, props){
  const lines = [`${subject} a ${types.join(' , ')}`];
  props.forEach(([p, o]) => lines.push(`    ${p} ${o}`));
  return lines.join(' ;\n') + ' .';
}
const section = title => ['#################################################################', '#    ' + title, '#################################################################', ''];
function toTurtle(){
  const pm = prefixMap(), m = state.meta;
  const out = [];
  const extra = Object.entries(pm).filter(([k]) => !(k in STD) && k !== (m.prefix || ''));
  out.push(`@prefix ${m.prefix || ''}: <${m.baseIri}> .`);
  extra.forEach(([k, v]) => out.push(`@prefix ${k}: <${v}> .`));
  Object.entries(STD).forEach(([k, v]) => out.push(`@prefix ${k}: <${v}> .`));
  out.push('');
  const onto = [];
  if (m.title) onto.push(['rdfs:label', lit(m.title)]);
  out.push(block(`<${m.ontologyIri}>`, ['owl:Ontology'], onto), '');

  const term = n => ttlTerm(n.name, pm);
  const classes = state.nodes.filter(n => !isIndiv(n)), indivs = state.nodes.filter(isIndiv);
  const tboxEdges = state.edges.filter(e => e.kind === 'object' && edgeShape(e) === 'CC');
  const aboxEdges = state.edges.filter(e => e.kind === 'object' && edgeShape(e) === 'II');

  if (classes.length){
    out.push(...section('Classes'));
    classes.forEach(n => {
      const props = [];
      if (n.label) props.push(['rdfs:label', lit(n.label)]);
      if (n.comment) props.push(['rdfs:comment', lit(n.comment)]);
      const parents = [...new Set(state.edges.filter(e => e.kind === 'subclass' && e.from === n.id).map(e => nodeById(e.to)).filter(Boolean).map(term))];
      parents.forEach(t => props.push(['rdfs:subClassOf', t]));
      out.push(block(term(n), ['owl:Class'], props), '');
    });
  }
  // 객체 속성: 클래스 사이 관계를 이름별로 묶어 domain/range, 개체 관계에만 쓰인 이름은 선언만
  const ops = new Map();
  const opOf = key => { if (!ops.has(key)) ops.set(key, { label: '', comment: '', functional: false, dom: [], rng: [] }); return ops.get(key); };
  tboxEdges.forEach(e => {
    const o = opOf(ttlTerm(e.name || 'relatedTo', pm));
    if (!o.label && e.label) o.label = e.label;
    if (!o.comment && e.comment) o.comment = e.comment;
    o.functional = o.functional || !!e.functional;
    o.dom.push(term(nodeById(e.from))); o.rng.push(term(nodeById(e.to)));
  });
  aboxEdges.forEach(e => { const o = opOf(ttlTerm(e.name || 'relatedTo', pm)); if (!o.label && e.label) o.label = e.label; });
  if (ops.size){
    out.push(...section('Object Properties'));
    ops.forEach((o, key) => {
      const props = [];
      if (o.label) props.push(['rdfs:label', lit(o.label)]);
      if (o.comment) props.push(['rdfs:comment', lit(o.comment)]);
      if (o.dom.length) props.push(['rdfs:domain', classExpr(o.dom)], ['rdfs:range', classExpr(o.rng)]);
      out.push(block(key, o.functional ? ['owl:ObjectProperty', 'owl:FunctionalProperty'] : ['owl:ObjectProperty'], props), '');
    });
  }
  // 데이터 속성
  const dps = new Map();
  classes.forEach(n => n.attrs.forEach(a => {
    if (!a.name) return;
    const key = ttlTerm(a.name, pm);
    if (!dps.has(key)) dps.set(key, { dom: [], types: new Set() });
    dps.get(key).dom.push(term(n)); dps.get(key).types.add(a.type || 'rdfs:Literal');
  }));
  indivs.forEach(n => n.attrs.forEach(a => { if (a.name){ const key = ttlTerm(a.name, pm); if (!dps.has(key)) dps.set(key, { dom: [], types: new Set() }); } }));
  if (dps.size){
    out.push(...section('Data Properties'));
    dps.forEach((o, key) => {
      const props = [];
      if (o.dom.length) props.push(['rdfs:domain', classExpr(o.dom)], ['rdfs:range', o.types.size === 1 ? ttlTerm([...o.types][0], pm) : 'rdfs:Literal']);
      out.push(block(key, ['owl:DatatypeProperty'], props), '');
    });
  }
  // 개체 (ABox)
  if (indivs.length){
    out.push(...section('Individuals'));
    indivs.forEach(n => {
      const types = ['owl:NamedIndividual', ...new Set(typesOf(n).map(term))];
      const props = [];
      if (n.label) props.push(['rdfs:label', lit(n.label)]);
      if (n.comment) props.push(['rdfs:comment', lit(n.comment)]);
      aboxEdges.filter(e => e.from === n.id).forEach(e => props.push([ttlTerm(e.name || 'relatedTo', pm), term(nodeById(e.to))]));
      n.attrs.forEach(a => { if (a.name && a.value !== '' && a.value !== undefined) props.push([ttlTerm(a.name, pm), valueLit(a, pm)]); });
      out.push(block(term(n), types, props), '');
    });
  }
  // 배치 정보 (주석이라 다른 도구는 무시함). 개체 관계는 트리플에서 그대로 복원되므로 넣지 않음
  const layout = { v: 2, nodes: {}, edges: [] };
  state.nodes.forEach(n => { layout.nodes[fullIri(n.name, pm)] = n.color ? [Math.round(n.x), Math.round(n.y), n.color] : [Math.round(n.x), Math.round(n.y)]; });
  state.edges.forEach(e => {
    const a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) return;
    const s = edgeShape(e);
    if (s === 'CC') layout.edges.push([fullIri(a.name, pm), e.kind === 'subclass' ? 'sub' : fullIri(e.name, pm), fullIri(b.name, pm)]);
  });
  if ((m.imports || []).length) layout.imports = m.imports.map(t => [t.iri, t.label, t.kind]);
  out.push('# 아래 줄은 RDF Arrows가 다시 불러올 때 쓰는 배치 정보입니다 (주석이라 다른 도구는 무시합니다).');
  out.push('# ' + LAYOUT_TAG + ' ' + JSON.stringify(layout));
  return out.join('\n') + '\n';
}
const VALUE_CHECK = {
  'xsd:integer': v => /^[+-]?\d+$/.test(v),
  'xsd:decimal': v => /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(v),
  'xsd:double': v => /^[+-]?((\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|INF|NaN)$/.test(v) || v === '-INF',
  'xsd:boolean': v => /^(true|false|1|0)$/.test(v),
  'xsd:date': v => /^-?\d{4,}-\d{2}-\d{2}(Z|[+-]\d{2}:\d{2})?$/.test(v),
  'xsd:dateTime': v => /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(v)
};
function problems(){
  const list = [];
  const cnt = new Map();
  state.nodes.forEach(n => cnt.set(n.name, (cnt.get(n.name) || 0) + 1));
  cnt.forEach((c, nm) => { if (c > 1) list.push(`이름 "${nm}"이 ${c}번 쓰여서 하나로 합쳐집니다.`); });
  state.nodes.forEach(n => { if (!n.name) list.push(`이름 없는 노드가 있습니다.`); });
  const nodeIris = new Set(state.nodes.map(n => fullIri(n.name)));
  state.edges.filter(e => e.kind === 'object').forEach(e => { if (nodeIris.has(fullIri(e.name))) list.push(`관계 이름 "${e.name}"이 노드 이름과 겹칩니다.`); });
  state.edges.forEach(e => { if (edgeShape(e) === 'CI'){ const a = nodeById(e.from), b = nodeById(e.to); list.push(`클래스 "${a.label || a.name}" → 개체 "${b.label || b.name}" 연결은 내보내지 않았습니다.`); } });
  state.nodes.filter(isIndiv).forEach(n => {
    if (!typesOf(n).length) list.push(`개체 "${n.label || n.name}"에 타입이 없습니다 (owl:NamedIndividual로만 나감).`);
    n.attrs.forEach(a => { const chk = VALUE_CHECK[a.type]; if (chk && a.value !== '' && a.value !== undefined && !chk(String(a.value).trim())) list.push(`개체 "${n.label || n.name}"의 ${a.name} 값 "${a.value}"이 ${a.type} 형식이 아닙니다.`); });
  });
  return [...new Set(list)];
}
