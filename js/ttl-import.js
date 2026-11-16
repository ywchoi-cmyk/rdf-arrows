/* RDF Arrows · Turtle 불러오기 */
'use strict';

/* ---------- Turtle 불러오기 ---------- */
function importTurtle(text){
  const prefixes = {};
  const parser = new N3.Parser();
  const quads = parser.parse(text, { onPrefix: (p, iri) => { prefixes[p] = iri && iri.value !== undefined ? iri.value : String(iri); } });
  const R = STD.rdf, RS = STD.rdfs, O = STD.owl;
  const bySub = new Map();
  quads.forEach(q => {
    const s = q.subject.termType + '|' + q.subject.value;
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s).push(q);
  });
  const qsOf = subj => bySub.get(subj.termType + '|' + subj.value) || [];
  const objs = (subj, pred) => qsOf(subj).filter(q => q.predicate.value === pred).map(q => q.object);
  const hasType = (subj, t) => objs(subj, R + 'type').some(o => o.value === t);
  const listItems = (node) => { const out = []; let cur = node, guard = 0;
    while (cur && cur.value !== R + 'nil' && guard++ < 1000){ const f = objs(cur, R + 'first')[0]; if (f) out.push(f); cur = objs(cur, R + 'rest')[0]; } return out; };
  const namedClasses = (o) => {
    if (o.termType === 'NamedNode') return [o.value];
    if (o.termType === 'BlankNode'){ const u = objs(o, O + 'unionOf')[0]; if (u) return listItems(u).filter(x => x.termType === 'NamedNode').map(x => x.value); }
    return [];
  };
  const term = iri => ({ termType: 'NamedNode', value: iri });
  const uniqSubjects = []; const seen = new Set();
  quads.forEach(q => { if (q.subject.termType === 'NamedNode' && !seen.has(q.subject.value)){ seen.add(q.subject.value); uniqSubjects.push(q.subject); } });

  // --- TBox ---
  const classIris = new Set();
  uniqSubjects.forEach(s => { if (hasType(s, O + 'Class') || hasType(s, RS + 'Class')) classIris.add(s.value); });
  const objProps = uniqSubjects.filter(s => hasType(s, O + 'ObjectProperty'));
  const dataProps = uniqSubjects.filter(s => hasType(s, O + 'DatatypeProperty'));
  const annProps = new Set(uniqSubjects.filter(s => hasType(s, O + 'AnnotationProperty')).map(s => s.value));
  const propIris = new Set([...objProps, ...dataProps].map(p => p.value));
  uniqSubjects.forEach(s => objs(s, RS + 'subClassOf').forEach(o => { if (classIris.has(s.value) && o.termType === 'NamedNode') classIris.add(o.value); }));
  objProps.forEach(p => { objs(p, RS + 'domain').forEach(o => namedClasses(o).forEach(c => classIris.add(c))); objs(p, RS + 'range').forEach(o => namedClasses(o).forEach(c => classIris.add(c))); });
  dataProps.forEach(p => objs(p, RS + 'domain').forEach(o => namedClasses(o).forEach(c => classIris.add(c))));
  const builtin = iri => iri.startsWith(O) || iri.startsWith(RS) || iri.startsWith(R) || iri.startsWith(STD.xsd);
  [...classIris].forEach(c => { if (builtin(c) || propIris.has(c)) classIris.delete(c); });
  const ontoSub = uniqSubjects.find(s => hasType(s, O + 'Ontology'));

  // --- ABox ---
  const SKIP_NS = [RS, O, 'http://purl.org/dc/terms/', 'http://purl.org/dc/elements/1.1/', 'http://www.w3.org/2004/02/skos/core#'];
  const isAssertionPred = p => p !== R + 'type' && !annProps.has(p) && !SKIP_NS.some(ns => p.startsWith(ns));
  const indivIris = new Set();
  uniqSubjects.forEach(s => {
    if (classIris.has(s.value) || propIris.has(s.value) || annProps.has(s.value) || (ontoSub && s.value === ontoSub.value)) return;
    const types = objs(s, R + 'type').filter(o => o.termType === 'NamedNode').map(o => o.value);
    const usesProp = qsOf(s).some(q => propIris.has(q.predicate.value));
    if (types.includes(O + 'NamedIndividual') || types.some(t => classIris.has(t) || !builtin(t)) || usesProp) indivIris.add(s.value);
  });
  indivIris.forEach(i => {
    objs(term(i), R + 'type').forEach(o => { if (o.termType === 'NamedNode' && !builtin(o.value)) classIris.add(o.value); });
    qsOf(term(i)).forEach(q => {
      if (isAssertionPred(q.predicate.value) && q.object.termType === 'NamedNode' && !classIris.has(q.object.value)) indivIris.add(q.object.value);
    });
  });
  classIris.forEach(c => indivIris.delete(c));

  // 기본 네임스페이스 결정
  const nsOf = iri => iri.replace(/[^#/]*$/, '');
  const nsCount = new Map();
  [...classIris, ...indivIris].forEach(c => nsCount.set(nsOf(c), (nsCount.get(nsOf(c)) || 0) + 1));
  // 온톨로지 IRI와 맞는 네임스페이스 우선, 다음은 알려진 외부 온톨로지를 뺀 가장 많이 쓰인 것
  const knownExt = new Set(PRESETS.map(x => x.iri).concat(Object.values(STD)));
  const byCount = [...nsCount.entries()].sort((a, b) => b[1] - a[1]);
  const ontoNs = ontoSub ? [ontoSub.value + '#', ontoSub.value + '/', ontoSub.value.replace(/[#/]$/, '') + '#', ontoSub.value.replace(/[#/]$/, '') + '/'] : [];
  const declared = ontoSub ? Object.values(prefixes).find(v => ontoNs.includes(v)) : null;
  const base = ontoNs.find(ns => nsCount.has(ns)) || declared || (byCount.find(([ns]) => !knownExt.has(ns)) || byCount[0] || [])[0] || (ontoSub ? ontoSub.value + '#' : 'http://example.org/onto#');
  const prefix = Object.keys(prefixes).find(k => prefixes[k] === base && k !== '') ?? (Object.keys(prefixes).find(k => prefixes[k] === base) ?? 'ex');
  const lang = (() => {
    const langs = new Map();
    quads.forEach(q => { if (q.object.termType === 'Literal' && q.object.language) langs.set(q.object.language, (langs.get(q.object.language) || 0) + 1); });
    // 여러 언어가 섞여 있으면 한국어, 다음은 영어를 먼저 씀
    if (langs.has('ko')) return 'ko';
    if (langs.has('en')) return 'en';
    return [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  })();
  const pickLit = (subj, pred) => {
    const ls = objs(subj, pred).filter(o => o.termType === 'Literal');
    return (ls.find(l => l.language === lang) || ls.find(l => l.language === 'ko') || ls.find(l => l.language === 'en') || ls.find(l => !l.language) || ls[0] || { value: '' }).value;
  };
  const extraPairs = Object.entries(prefixes).filter(([k, v]) => !(k in STD && STD[k] === v) && !(k === prefix && v === base) && v !== base);
  const meta = {
    title: ontoSub ? (pickLit(ontoSub, RS + 'label') || pickLit(ontoSub, 'http://purl.org/dc/terms/title')) : '',
    ontologyIri: ontoSub ? ontoSub.value : base.replace(/[#/]$/, ''),
    baseIri: base, prefix, lang,
    extraPrefixes: extraPairs.map(([k, v]) => `${k}: ${v}`).join('\n')
  };
  const compact = iri => {
    if (iri.startsWith(base)){ let l = iri.slice(base.length); try { l = decodeURIComponent(l); } catch (e) {} if (SAFE_LOCAL.test(l)) return l; }
    for (const [k, v] of extraPairs.concat(Object.entries(STD))) if (iri.startsWith(v) && SAFE_LOCAL.test(iri.slice(v.length))) return `${k}:${iri.slice(v.length)}`;
    return iri;
  };

  const st = blankState(); st.meta = meta;
  const idOf = new Map();
  const mkNode = (iri, kind) => {
    const s = term(iri);
    const n = { id: 'n' + (st.seq++), kind, x: 0, y: 0, label: pickLit(s, RS + 'label'), name: compact(iri), nameAuto: false, comment: pickLit(s, RS + 'comment'), color: null, attrs: [] };
    st.nodes.push(n); idOf.set(iri, n.id); return n;
  };
  classIris.forEach(iri => mkNode(iri, 'class'));
  indivIris.forEach(iri => mkNode(iri, 'individual'));
  const mkEdge = (from, to, kind, extra = {}) => st.edges.push(Object.assign({ id: 'e' + (st.seq++), from, to, kind, label: '', name: 'relatedTo', nameAuto: false, comment: '', functional: false }, extra));

  let layout = null;
  const lm = text.match(new RegExp('^#\\s*' + LAYOUT_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\{.*\\})\\s*$', 'm'));
  if (lm){ try { layout = JSON.parse(lm[1]); } catch (e) {} }
  if (layout && Array.isArray(layout.imports)) meta.imports = layout.imports.filter(x => Array.isArray(x) && x[0]).map(([iri, label, kind]) => ({ iri, label: label || '', kind: kind || 'class' }));

  // 상속
  classIris.forEach(iri => objs(term(iri), RS + 'subClassOf').forEach(o => {
    if (o.termType === 'NamedNode' && classIris.has(o.value)) mkEdge(idOf.get(iri), idOf.get(o.value), 'subclass');
  }));
  // 클래스 사이 객체 속성
  const layoutPairs = new Map();
  if (layout && Array.isArray(layout.edges)) layout.edges.forEach(([f, p, t]) => { if (p !== 'sub' && p !== 'type'){ if (!layoutPairs.has(p)) layoutPairs.set(p, []); layoutPairs.get(p).push([f, t]); } });
  objProps.forEach(p => {
    const dom = objs(p, RS + 'domain').flatMap(namedClasses).filter(c => classIris.has(c));
    const rng = objs(p, RS + 'range').flatMap(namedClasses).filter(c => classIris.has(c));
    let pairs = (layoutPairs.get(p.value) || []).filter(([f, t]) => classIris.has(f) && classIris.has(t));
    if (!pairs.length) dom.forEach(d => rng.forEach(r => pairs.push([d, r])));
    const label = pickLit(p, RS + 'label'), comment = pickLit(p, RS + 'comment'), functional = hasType(p, O + 'FunctionalProperty');
    pairs.forEach(([f, t]) => mkEdge(idOf.get(f), idOf.get(t), 'object', { label, name: compact(p.value), comment, functional }));
  });
  // 클래스의 데이터 속성
  dataProps.forEach(p => {
    const rng = objs(p, RS + 'range')[0];
    const type = rng ? compact(rng.value) : 'rdfs:Literal';
    objs(p, RS + 'domain').flatMap(namedClasses).forEach(c => {
      const n = st.nodes.find(x => x.id === idOf.get(c));
      if (n) n.attrs.push({ name: compact(p.value), type });
    });
  });
  // 개체: 타입, 개체 관계, 데이터 값
  indivIris.forEach(iri => {
    const id = idOf.get(iri), n = st.nodes.find(x => x.id === id);
    objs(term(iri), R + 'type').forEach(o => { if (o.termType === 'NamedNode' && classIris.has(o.value)) mkEdge(id, idOf.get(o.value), 'type'); });
    qsOf(term(iri)).forEach(q => {
      const p = q.predicate.value;
      if (!isAssertionPred(p)) return;
      if (q.object.termType === 'NamedNode' && indivIris.has(q.object.value)){
        mkEdge(id, idOf.get(q.object.value), 'object', { label: pickLit(term(p), RS + 'label'), name: compact(p) });
      } else if (q.object.termType === 'Literal'){
        const type = q.object.language ? 'rdf:langString' : compact(q.object.datatype ? q.object.datatype.value : STD.xsd + 'string');
        n.attrs.push({ name: compact(p), value: q.object.value, type });
      }
    });
  });
  // 위치
  let placed = 0;
  const iriOf = new Map([...idOf.entries()].map(([iri, id]) => [id, iri]));
  if (layout && layout.nodes){
    st.nodes.forEach(n => { const v = layout.nodes[iriOf.get(n.id)];
      if (v){ n.x = v[0]; n.y = v[1]; if (v[2] && !OLD_DEFAULTS.has(v[2])) n.color = v[2]; n.placed = true; placed++; } });
  }
  if (placed < st.nodes.length) autoLayout(st, placed > 0);
  st.nodes.forEach(n => delete n.placed);
  return st;
}
