/* RDF Arrows · 검사: 브라우저 안 추론, 데이터 검사, OOPS! (요청 제한 포함) */
'use strict';

/* ---------- 검사: 추론 · 데이터 검사 · OOPS! ---------- */
const OOPS = {
  url: 'https://oops.linkeddata.es/rest',
  minIntervalMs: 30000,      // 서로 다른 검사 사이 최소 간격
  retryMinGapMs: 10000,      // 재시도 사이 최소 간격
  maxPerHour: 10,            // 시간당 실제 전송 횟수 (재시도 포함)
  timeoutMs: 90000,          // 한 번 요청의 응답 대기 한도
  retries: 2,                // 실패 시 재시도 횟수
  backoffMs: [10000, 30000], // 재시도 대기 (여기에 무작위 0~3초 더함)
  tooManyWaitMs: 60000,      // 429/503이면 최소 대기
  cacheTtlMs: 24 * 3600e3,   // 같은 내용이면 이 시간 동안 저장된 결과 사용
  cacheMax: 5,
  maxBytes: 2 * 1024 * 1024
};
const OOPS_KEY = STORAGE_KEY + ':oops';
const RA = 'urn:rdf-arrows:';
const RL_RULES = `
@prefix rdf: <${STD.rdf}> . @prefix rdfs: <${STD.rdfs}> . @prefix owl: <${STD.owl}> . @prefix ra: <${RA}> .
{ ?a rdfs:subClassOf ?b . ?b rdfs:subClassOf ?c } => { ?a rdfs:subClassOf ?c } .
{ ?x rdf:type ?c . ?c rdfs:subClassOf ?d } => { ?x rdf:type ?d } .
{ ?c owl:equivalentClass ?d } => { ?c rdfs:subClassOf ?d . ?d rdfs:subClassOf ?c } .
{ ?p rdfs:subPropertyOf ?q . ?q rdfs:subPropertyOf ?r } => { ?p rdfs:subPropertyOf ?r } .
{ ?x ?p ?y . ?p rdfs:subPropertyOf ?q } => { ?x ?q ?y } .
{ ?p rdfs:domain ?c . ?x ?p ?y } => { ?x rdf:type ?c } .
{ ?p rdf:type owl:ObjectProperty . ?p rdfs:range ?c . ?x ?p ?y } => { ?y rdf:type ?c } .
{ ?p owl:inverseOf ?q . ?x ?p ?y } => { ?y ?q ?x } .
{ ?p owl:inverseOf ?q . ?x ?q ?y } => { ?y ?p ?x } .
{ ?p rdf:type owl:SymmetricProperty . ?x ?p ?y } => { ?y ?p ?x } .
{ ?p rdf:type owl:TransitiveProperty . ?x ?p ?y . ?y ?p ?z } => { ?x ?p ?z } .
{ ?p rdf:type owl:FunctionalProperty . ?p rdf:type owl:ObjectProperty . ?x ?p ?y1 . ?x ?p ?y2 } => { ?y1 owl:sameAs ?y2 } .
{ ?p rdf:type owl:InverseFunctionalProperty . ?x1 ?p ?y . ?x2 ?p ?y } => { ?x1 owl:sameAs ?x2 } .
{ ?c owl:disjointWith ?d . ?x rdf:type ?c . ?x rdf:type ?d } => { ?x ra:clash ?c } .
`;
const RL_RULE_COUNT = (RL_RULES.match(/=>/g) || []).length;

const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(new DOMException('중단됨', 'AbortError'));
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('중단됨', 'AbortError')); }, { once: true });
});
const tick = () => new Promise(r => setTimeout(r, 0));
const fmtMs = ms => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`;
const fmtBytes = b => b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
const fmtWait = ms => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; };

/* --- OOPS! 요청 기록 / 캐시 (이 브라우저에만 저장) --- */
function oopsStore(){
  let s = null; try { s = JSON.parse(localStorage.getItem(OOPS_KEY) || 'null'); } catch (e) {}
  s = s || {}; s.sends = (s.sends || []).filter(t => Date.now() - t < 3600e3); s.cache = s.cache || {}; s.lastCheck = s.lastCheck || 0;
  return s;
}
function oopsSave(s){ try { localStorage.setItem(OOPS_KEY, JSON.stringify(s)); } catch (e) {} }
function oopsQuotaText(){
  const s = oopsStore(); const now = Date.now();
  const left = OOPS.maxPerHour - s.sends.length;
  const nextIn = Math.max(0, s.lastCheck + OOPS.minIntervalMs - now);
  const hourIn = left <= 0 ? Math.min(...s.sends) + 3600e3 - now : 0;
  return `OOPS! 요청 제한: 검사 사이 최소 ${OOPS.minIntervalMs / 1000}초 · 시간당 ${OOPS.maxPerHour}회 (최근 1시간 ${s.sends.length}회 사용) · 같은 내용은 24시간 동안 저장된 결과 사용` +
    (hourIn > 0 ? ` · 시간당 한도 도달, ${fmtWait(hourIn)} 후 가능` : nextIn > 0 ? ` · 다음 요청까지 ${fmtWait(nextIn)}` : ' · 지금 요청 가능');
}
async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* --- 트리플 → RDF/XML (OOPS!는 RDF/XML만 받음) --- */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NCNAME = /^[\p{L}_][\p{L}\p{N}_.\-]*$/u;
function toRdfXml(quads){
  const ns = { [STD.rdf]: 'rdf' }; let k = 0; const skipped = [];
  const qname = iri => {
    const m = iri.match(/^(.*[#/])([^#/]+)$/);
    if (!m || !NCNAME.test(m[2])) return null;
    if (!ns[m[1]]) ns[m[1]] = m[1] === STD.rdfs ? 'rdfs' : m[1] === STD.owl ? 'owl' : m[1] === STD.xsd ? 'xsd' : 'ns' + (k++);
    return `${ns[m[1]]}:${m[2]}`;
  };
  const bn = new Map(); const bid = b => { if (!bn.has(b.value)) bn.set(b.value, 'b' + bn.size); return bn.get(b.value); };
  const bySubj = new Map();
  quads.forEach(q => { const key = q.subject.termType + '|' + q.subject.value; if (!bySubj.has(key)) bySubj.set(key, []); bySubj.get(key).push(q); });
  const body = [];
  bySubj.forEach(list => {
    const s = list[0].subject;
    const lines = [];
    list.forEach(q => {
      const p = qname(q.predicate.value);
      if (!p){ skipped.push(q.predicate.value); return; }
      const o = q.object;
      if (o.termType === 'NamedNode') lines.push(`    <${p} rdf:resource="${xmlEsc(o.value)}"/>`);
      else if (o.termType === 'BlankNode') lines.push(`    <${p} rdf:nodeID="${bid(o)}"/>`);
      else {
        const attr = o.language ? ` xml:lang="${xmlEsc(o.language)}"` : (o.datatype && o.datatype.value !== STD.xsd + 'string' ? ` rdf:datatype="${xmlEsc(o.datatype.value)}"` : '');
        lines.push(`    <${p}${attr}>${xmlEsc(o.value)}</${p}>`);
      }
    });
    const subjAttr = s.termType === 'BlankNode' ? `rdf:nodeID="${bid(s)}"` : `rdf:about="${xmlEsc(s.value)}"`;
    body.push(`  <rdf:Description ${subjAttr}>\n${lines.join('\n')}\n  </rdf:Description>`);
  });
  const nsDecl = Object.entries(ns).map(([iri, p]) => `xmlns:${p}="${xmlEsc(iri)}"`).join('\n    ');
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF ${nsDecl}>\n${body.join('\n')}\n</rdf:RDF>\n`, skipped: [...new Set(skipped)] };
}

/* --- 모델 IRI ↔ 노드/관계 --- */
function iriIndex(){
  const pm = prefixMap();
  const node = new Map(), prop = new Map();
  state.nodes.forEach(n => node.set(fullIri(n.name, pm), n));
  state.edges.forEach(e => { if (e.kind === 'object') prop.set(fullIri(e.name, pm), e); });
  state.nodes.forEach(n => n.attrs.forEach(a => { if (a.name) prop.set(fullIri(a.name, pm), { attr: a, node: n }); }));
  return { node, prop };
}
const nm = n => n ? nodeTitle(n) : '?';
function goLink(kind, id, text){ return `<a class="go" data-go-${kind}="${esc(id)}">${esc(text)}</a>`; }

/* --- 1. 추론 (브라우저 안 OWL RL 규칙 일부) --- */
function runReasoner(quads){
  const store = new N3.Store(quads);
  const before = store.size;
  const rules = new N3.Store(new N3.Parser({ format: 'text/n3' }).parse(RL_RULES));
  let stopped = null;
  try { new N3.Reasoner(store, { maxDerivations: 200000 }).reason(rules); }
  catch (e){ stopped = e.message || String(e); }
  const orig = new Set(quads.map(q => q.subject.value + ' ' + q.predicate.value + ' ' + q.object.value));
  const added = store.getQuads(null, null, null, null).filter(q => !orig.has(q.subject.value + ' ' + q.predicate.value + ' ' + q.object.value));
  return { store, before, after: store.size, added, stopped };
}
/** 클래스의 상위 클래스 (모델의 subClassOf 만 따라감) */
function ancestors(c){
  const out = new Set([c.id]); const st = [c.id];
  while (st.length){ const id = st.pop(); state.edges.forEach(e => { if (e.kind === 'subclass' && e.from === id && !out.has(e.to)){ out.add(e.to); st.push(e.to); } }); }
  return out;
}
const typeClosure = n => { const s = new Set(); typesOf(n).forEach(c => ancestors(c).forEach(id => s.add(id))); return s; };
function summarizeInference(res){
  const { node } = iriIndex();
  const R = STD.rdf, O = STD.owl;
  const unionLabel = b => {
    const lst = res.store.getObjects(b, O + 'unionOf', null)[0]; if (!lst) return null;
    const names = []; let cur = lst, g = 0;
    while (cur && cur.value !== R + 'nil' && g++ < 200){ const f = res.store.getObjects(cur, R + 'first', null)[0]; if (f) names.push(nm(node.get(f.value)) || f.value); cur = res.store.getObjects(cur, R + 'rest', null)[0]; }
    return names.join(' 또는 ');
  };
  const types = new Map(), sameAs = [], clashes = [], props = [];
  let subclassCount = 0;
  res.added.forEach(q => {
    const s = node.get(q.subject.value);
    if (q.predicate.value === R + 'type'){
      if (!s || !isIndiv(s)) return;
      if (q.object.value === O + 'NamedIndividual' || q.object.value === O + 'Thing') return;
      const c = q.object.termType === 'BlankNode' ? { union: unionLabel(q.object) } : node.get(q.object.value) || { iri: q.object.value };
      if (!types.has(s.id)) types.set(s.id, []);
      types.get(s.id).push(c);
    } else if (q.predicate.value === O + 'sameAs'){
      if (q.subject.value !== q.object.value && q.subject.value < q.object.value) sameAs.push([node.get(q.subject.value), node.get(q.object.value), q]);
    } else if (q.predicate.value === RA + 'clash'){
      clashes.push([s, node.get(q.object.value)]);
    } else if (q.predicate.value === STD.rdfs + 'subClassOf'){
      subclassCount++;
    } else if (s && isIndiv(s) && q.object.termType === 'NamedNode'){
      props.push([s, q.predicate.value, node.get(q.object.value)]);
    }
  });
  return { types, sameAs, clashes, props, subclassCount };
}

/* --- 2. 데이터 검사 (닫힌 세계: 넣은 것만 있다고 보고 확인) --- */
function dataChecks(){
  const out = []; // {sev:'err'|'warn'|'info', html}
  const classes = state.nodes.filter(n => !isIndiv(n));
  const tbox = state.edges.filter(e => e.kind === 'object' && edgeShape(e) === 'CC');
  const dpDefs = new Map(); classes.forEach(c => c.attrs.forEach(a => { if (!a.name) return; if (!dpDefs.has(a.name)) dpDefs.set(a.name, []); dpDefs.get(a.name).push({ cls: c, type: a.type }); }));
  state.edges.filter(e => edgeShape(e) === 'II').forEach(e => {
    const a = nodeById(e.from), b = nodeById(e.to);
    const defs = tbox.filter(t => t.name === e.name);
    const rel = `${goLink('node', a.id, nm(a))} —${goLink('edge', e.id, e.label || e.name)}→ ${goLink('node', b.id, nm(b))}`;
    if (!defs.length){ out.push({ sev: 'info', html: `${rel}<div class="why">"${esc(e.name)}" 관계가 클래스 사이에 정의돼 있지 않습니다. domain/range가 없어 검사도 추론도 되지 않습니다.</div>` }); return; }
    const dom = new Set(defs.map(t => t.from)), rng = new Set(defs.map(t => t.to));
    const ta = typeClosure(a), tb = typeClosure(b);
    const domNames = [...dom].map(id => nm(nodeById(id))).join(' 또는 '), rngNames = [...rng].map(id => nm(nodeById(id))).join(' 또는 ');
    if (![...dom].some(id => ta.has(id))) out.push({ sev: 'err', html: `${rel}<div class="why">출발 개체가 ${esc(domNames)} 타입이 아닙니다 (domain 불일치). 추론기는 이걸 오류로 보지 않고 이 개체를 ${esc(domNames)}(으)로 간주해 버립니다.</div>` });
    if (![...rng].some(id => tb.has(id))) out.push({ sev: 'err', html: `${rel}<div class="why">도착 개체가 ${esc(rngNames)} 타입이 아닙니다 (range 불일치). 추론기는 도착 개체를 ${esc(rngNames)}(으)로 간주해 버립니다.</div>` });
  });
  // 값이 하나만 허용되는 관계
  const funcNames = new Set(tbox.filter(t => t.functional).map(t => t.name));
  state.nodes.filter(isIndiv).forEach(n => {
    funcNames.forEach(p => {
      const targets = [...new Set(state.edges.filter(e => e.from === n.id && edgeShape(e) === 'II' && e.name === p).map(e => e.to))];
      if (targets.length > 1) out.push({ sev: 'warn', html: `${goLink('node', n.id, nm(n))}의 "${esc(p)}" 값이 ${targets.length}개입니다: ${targets.map(id => goLink('node', id, nm(nodeById(id)))).join(', ')}<div class="why">이 관계는 값이 하나만 허용되도록 정의돼 있어서, 추론기는 이 개체들을 같은 것(owl:sameAs)으로 합쳐 버립니다.</div>` });
    });
    if (!typesOf(n).length) out.push({ sev: 'warn', html: `${goLink('node', n.id, nm(n))}에 타입(rdf:type)이 없습니다.` });
    n.attrs.forEach(a => {
      if (!a.name) return;
      const v = String(a.value ?? '').trim();
      const defs = dpDefs.get(a.name);
      if (!defs) out.push({ sev: 'info', html: `${goLink('node', n.id, nm(n))}의 데이터 값 "${esc(a.name)}"은 어떤 클래스에도 정의돼 있지 않습니다.` });
      else {
        const tc = typeClosure(n);
        if (!defs.some(d => tc.has(d.cls.id))) out.push({ sev: 'err', html: `${goLink('node', n.id, nm(n))}의 "${esc(a.name)}": 이 속성은 ${esc(defs.map(d => nm(d.cls)).join(' 또는 '))}에 정의돼 있는데, 개체가 그 타입이 아닙니다.` });
        const want = [...new Set(defs.map(d => d.type))];
        if (want.length === 1 && want[0] !== a.type && want[0] !== 'rdfs:Literal') out.push({ sev: 'warn', html: `${goLink('node', n.id, nm(n))}의 "${esc(a.name)}" 값 타입이 ${esc(a.type)}인데, 클래스 정의는 ${esc(want[0])}입니다.` });
      }
      if (v === '') out.push({ sev: 'warn', html: `${goLink('node', n.id, nm(n))}의 "${esc(a.name)}" 값이 비어 있어 내보내지 않았습니다.` });
      else { const chk = VALUE_CHECK[a.type]; if (chk && !chk(v)) out.push({ sev: 'err', html: `${goLink('node', n.id, nm(n))}의 "${esc(a.name)}" 값 "${esc(v)}"이 ${esc(a.type)} 형식이 아닙니다.` }); }
    });
  });
  state.edges.filter(e => edgeShape(e) === 'CI').forEach(e => out.push({ sev: 'warn', html: `${goLink('edge', e.id, '클래스 → 개체 연결')}(${esc(nm(nodeById(e.from)))} → ${esc(nm(nodeById(e.to)))})은 TTL로 내보내지 않습니다.` }));
  // 상속 순환
  classes.forEach(c => { const anc = new Set(); const st = state.edges.filter(e => e.kind === 'subclass' && e.from === c.id).map(e => e.to);
    while (st.length){ const id = st.pop(); if (id === c.id){ out.push({ sev: 'err', html: `${goLink('node', c.id, nm(c))}이(가) 상속 순환에 들어 있습니다 (자기 자신의 하위 클래스가 됨).` }); break; } if (anc.has(id)) continue; anc.add(id); state.edges.forEach(e => { if (e.kind === 'subclass' && e.from === id) st.push(e.to); }); } });
  problems().filter(p => /번 쓰여서|이름 없는|겹칩니다/.test(p)).forEach(p => out.push({ sev: 'warn', html: esc(p) }));
  const rank = { err: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/* --- 3. OOPS! 요청 (요청 제한 포함) --- */
function parseOops(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('OOPS! 응답을 해석할 수 없습니다');
  const NSO = 'http://www.oeg-upm.net/oops';
  const errTitle = doc.getElementsByTagNameNS('http://www.oeg-upm.net/oops#', 'hasTitle')[0];
  if (errTitle){
    const msgs = [...doc.getElementsByTagNameNS('http://www.oeg-upm.net/oops#', 'hasMessage')].map(m => m.textContent.trim());
    const e = new Error('OOPS! 오류 응답: ' + errTitle.textContent.trim() + (msgs.length ? ' — ' + msgs.join(' ') : '')); e.fatal = true; throw e;
  }
  const txt = (el, tag) => { const x = el.getElementsByTagNameNS(NSO, tag)[0]; return x ? x.textContent.trim() : ''; };
  const pick = tag => [...doc.getElementsByTagNameNS(NSO, tag)].map(el => ({
    code: txt(el, 'Code'), name: txt(el, 'Name'), description: txt(el, 'Description'), importance: txt(el, 'Importance'),
    count: +txt(el, 'NumberAffectedElements') || 0,
    affected: [...el.getElementsByTagNameNS(NSO, 'AffectedElement')].map(a => a.textContent.trim())
  }));
  if (!doc.getElementsByTagNameNS(NSO, 'OOPSResponse').length) throw new Error('OOPS! 응답 형식이 예상과 다릅니다');
  return { pitfalls: pick('Pitfall'), warnings: pick('Warning'), suggestions: pick('Suggestion') };
}
async function oopsFetchOnce(body, signal){
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(); signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), OOPS.timeoutMs);
  try {
    // text/plain 이어야 사전 확인 요청 없이 다른 도메인으로 보낼 수 있음
    const r = await fetch(OOPS.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, signal: ctl.signal });
    const text = await r.text();
    return { status: r.status, text, retryAfter: r.headers.get('Retry-After') };
  } catch (e){
    if (signal.aborted) throw new DOMException('중단됨', 'AbortError');
    const err = new Error(ctl.signal.aborted ? `응답 없음 (${OOPS.timeoutMs / 1000}초 초과)` : '네트워크 오류 또는 서버가 요청을 거부함');
    throw err;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}
async function runOops(rdfxml, signal, report){
  const bytes = new TextEncoder().encode(rdfxml).length;
  if (bytes > OOPS.maxBytes) throw Object.assign(new Error(`온톨로지가 너무 큽니다 (${fmtBytes(bytes)}, 한도 ${fmtBytes(OOPS.maxBytes)})`), { fatal: true });
  const hash = await sha256(rdfxml);
  let s = oopsStore();
  const hit = s.cache[hash];
  if (hit && Date.now() - hit.at < OOPS.cacheTtlMs){
    report(`같은 내용으로 ${fmtWait(Date.now() - hit.at)} 전에 받은 결과를 씁니다 (요청 안 보냄)`);
    return { result: parseOops(hit.text), cached: true, ms: 0, bytes: hit.text.length };
  }
  // 검사 사이 최소 간격
  let wait = s.lastCheck + OOPS.minIntervalMs - Date.now();
  while (wait > 0){
    report(`요청 간격 제한: ${fmtWait(wait)} 후 전송합니다 (검사 사이 최소 ${OOPS.minIntervalMs / 1000}초)`);
    await sleep(Math.min(1000, wait), signal);
    wait = s.lastCheck + OOPS.minIntervalMs - Date.now();
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<OOPSRequest>\n<OntologyUrl></OntologyUrl>\n<OntologyContent><![CDATA[${rdfxml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></OntologyContent>\n<Pitfalls></Pitfalls>\n<OutputFormat>XML</OutputFormat>\n</OOPSRequest>`;
  let lastErr = null;
  for (let attempt = 0; attempt <= OOPS.retries; attempt++){
    s = oopsStore();
    if (s.sends.length >= OOPS.maxPerHour){
      const until = Math.min(...s.sends) + 3600e3 - Date.now();
      throw Object.assign(new Error(`시간당 요청 한도(${OOPS.maxPerHour}회)에 도달했습니다. ${fmtWait(until)} 후 다시 할 수 있습니다.`), { fatal: true });
    }
    s.sends.push(Date.now()); s.lastCheck = Date.now(); oopsSave(s); updateQuota();
    const t0 = performance.now();
    const ticker = setInterval(() => report(`요청 전송 (시도 ${attempt + 1}/${OOPS.retries + 1}, ${fmtBytes(bytes)}) · 응답 기다리는 중 ${fmtMs(performance.now() - t0)}`), 250);
    report(`요청 전송 (시도 ${attempt + 1}/${OOPS.retries + 1}, ${fmtBytes(bytes)})`);
    let r = null;
    try { r = await oopsFetchOnce(body, signal); }
    catch (e){ if (e.name === 'AbortError') { clearInterval(ticker); throw e; } lastErr = e; }
    finally { clearInterval(ticker); }
    const ms = performance.now() - t0;
    let waitMs = OOPS.backoffMs[Math.min(attempt, OOPS.backoffMs.length - 1)] + Math.random() * 3000;
    if (r){
      if (r.status === 200){
        const result = parseOops(r.text);   // 오류 응답이면 여기서 fatal 오류
        s = oopsStore(); s.cache[hash] = { at: Date.now(), text: r.text };
        const keys = Object.keys(s.cache).sort((a, b) => s.cache[b].at - s.cache[a].at); keys.slice(OOPS.cacheMax).forEach(k => delete s.cache[k]);
        oopsSave(s);
        return { result, cached: false, ms, bytes: r.text.length };
      }
      lastErr = new Error(`서버 응답 ${r.status}`);
      if (r.status === 429 || r.status === 503){
        const ra = parseInt(r.retryAfter, 10);
        waitMs = Math.max(OOPS.tooManyWaitMs, isFinite(ra) ? ra * 1000 : 0);
        lastErr = new Error(`서버가 요청이 많다고 응답함 (${r.status})`);
      } else if (r.status >= 400 && r.status < 500){
        throw Object.assign(new Error(`서버가 요청을 거절함 (${r.status})`), { fatal: true });
      }
    }
    if (attempt === OOPS.retries) break;
    waitMs = Math.max(waitMs, OOPS.retryMinGapMs);
    const until = Date.now() + waitMs;
    while (Date.now() < until){
      report(`${lastErr.message} (${fmtMs(ms)}) → ${fmtWait(until - Date.now())} 후 재시도 (${attempt + 2}/${OOPS.retries + 1})`);
      await sleep(Math.min(1000, until - Date.now()), signal);
    }
  }
  throw lastErr || new Error('알 수 없는 오류');
}

/* --- 진행 표시 --- */
let checkRun = null;           // { ctl } 실행 중이면 존재
let inferOverlay = null;       // { key, edges:[{from,to,label}], show }
const STEP_IC = { wait: '○', run: '◌', ok: '✓', warn: '⚠', err: '✕', skip: '–' };
let steps = [];
function semanticKey(){ return JSON.stringify({ m: state.meta, n: state.nodes.map(({ x, y, color, ...r }) => r), e: state.edges }); }
function renderSteps(){
  $('#cSteps').innerHTML = steps.map(s => `<li class="${s.status}"><span class="ic" style="color:${s.status === 'ok' ? '#188038' : s.status === 'err' ? 'var(--danger)' : s.status === 'warn' ? '#b06000' : 'var(--muted)'}">${STEP_IC[s.status]}</span>
    <div><div class="tt">${esc(s.title)}</div>${s.detail ? `<div class="dt">${esc(s.detail)}</div>` : ''}</div><span class="ms">${s.ms !== undefined ? fmtMs(s.ms) : ''}</span></li>`).join('');
  const done = steps.filter(s => ['ok', 'warn', 'err', 'skip'].includes(s.status)).length;
  const running = steps.some(s => s.status === 'run') ? 0.5 : 0;
  $('#cBar').style.width = (steps.length ? (done + running) / steps.length * 100 : 0) + '%';
}
function setStep(id, patch){ const s = steps.find(x => x.id === id); Object.assign(s, patch); renderSteps(); }
function updateQuota(){ $('#cQuota').textContent = oopsQuotaText(); }

async function runCheck(){
  if (checkRun) return;
  const ctl = new AbortController(); checkRun = { ctl };
  const useOops = $('#cOops').checked;
  $('#cRun').disabled = true; $('#bCheck').disabled = true; $('#cCancel').hidden = false;
  $('#cResults').innerHTML = '';
  steps = [
    { id: 'tr', title: '1. 모델을 트리플로 변환', status: 'wait' },
    { id: 'rl', title: `2. 추론 (OWL RL 규칙 ${RL_RULE_COUNT}개, 이 브라우저 안에서)`, status: 'wait' },
    { id: 'dc', title: '3. 데이터 검사 (넣은 것만 있다고 보고 확인)', status: 'wait' },
    { id: 'op', title: '4. OOPS! 함정 점검 (외부 서버)', status: useOops ? 'wait' : 'skip', detail: useOops ? '' : '꺼져 있음. 위에서 켜면 함께 점검합니다.' }
  ];
  renderSteps();
  const R = { inference: null, data: null, oops: null, oopsErr: null };
  try {
    // 1
    setStep('tr', { status: 'run' }); await tick();
    let t0 = performance.now();
    const ttl = toTurtle();
    const quads = new N3.Parser().parse(ttl);
    setStep('tr', { status: 'ok', detail: `트리플 ${quads.length}개 (클래스 ${state.nodes.filter(n => !isIndiv(n)).length}, 개체 ${state.nodes.filter(isIndiv).length}, 연결 ${state.edges.length})`, ms: performance.now() - t0 });
    if (ctl.signal.aborted) throw new DOMException('중단됨', 'AbortError');
    // 2
    setStep('rl', { status: 'run', detail: '규칙 적용 중…' }); await tick();
    t0 = performance.now();
    const inf = runReasoner(quads);
    R.inference = summarizeInference(inf);
    const nTypes = [...R.inference.types.values()].reduce((s, l) => s + l.length, 0);
    setStep('rl', { status: inf.stopped || R.inference.clashes.length ? 'warn' : 'ok', ms: performance.now() - t0,
      detail: (inf.stopped ? `추론을 중간에 멈춤: ${inf.stopped}\n` : '') + `새 트리플 ${inf.added.length}개 (${inf.before} → ${inf.after}) · 개체에 새로 붙은 타입 ${nTypes}개 · 같은 개체로 합쳐짐 ${R.inference.sameAs.length}건 · 모순 ${R.inference.clashes.length}건` });
    if (ctl.signal.aborted) throw new DOMException('중단됨', 'AbortError');
    // 3
    setStep('dc', { status: 'run' }); await tick();
    t0 = performance.now();
    R.data = dataChecks();
    const ne = R.data.filter(d => d.sev === 'err').length, nw = R.data.filter(d => d.sev === 'warn').length;
    setStep('dc', { status: ne ? 'err' : nw ? 'warn' : 'ok', detail: `오류 ${ne}건 · 주의 ${nw}건 · 참고 ${R.data.length - ne - nw}건`, ms: performance.now() - t0 });
    renderResults(R);
    // 4
    if (useOops){
      setStep('op', { status: 'run', detail: 'RDF/XML로 변환 중…' }); await tick();
      t0 = performance.now();
      const { xml, skipped } = toRdfXml(quads);
      const pre = `RDF/XML ${fmtBytes(new TextEncoder().encode(xml).length)}` + (skipped.length ? ` · RDF/XML로 표현할 수 없는 속성 ${skipped.length}개 제외: ${skipped.join(', ')}` : '');
      try {
        const out = await runOops(xml, ctl.signal, msg => setStep('op', { detail: pre + '\n' + msg, ms: performance.now() - t0 }));
        R.oops = out.result;
        const cnt = imp => out.result.pitfalls.filter(p => p.importance === imp).length;
        setStep('op', { status: cnt('Critical') ? 'err' : out.result.pitfalls.length ? 'warn' : 'ok', ms: performance.now() - t0,
          detail: pre + '\n' + (out.cached ? '저장된 결과 사용 (요청 안 보냄)' : `응답 수신 ${fmtBytes(out.bytes)} · ${fmtMs(out.ms)}`) +
            `\n함정 ${out.result.pitfalls.length}종 (심각 ${cnt('Critical')} · 중요 ${cnt('Important')} · 경미 ${cnt('Minor')})` });
      } catch (e){
        if (e.name === 'AbortError') throw e;
        R.oopsErr = e.message;
        setStep('op', { status: 'err', detail: pre + '\n' + e.message + (e.fatal ? '' : `\n재시도 ${OOPS.retries}회 후에도 실패했습니다. 잠시 뒤 다시 검사하세요.`), ms: performance.now() - t0 });
      }
      renderResults(R);
    }
  } catch (e){
    if (e.name === 'AbortError'){ steps.forEach(s => { if (s.status === 'run' || s.status === 'wait') s.status = 'skip'; if (s.status === 'skip' && !s.detail) s.detail = '중단됨'; }); const r = steps.find(s => s.id === 'op'); if (r && r.status === 'skip' && useOops) r.detail = (r.detail ? r.detail + '\n' : '') + '중단됨'; renderSteps(); }
    else { console.error(e); toast('검사 오류: ' + e.message); }
  } finally {
    checkRun = null; $('#cRun').disabled = false; $('#bCheck').disabled = false; $('#cCancel').hidden = true; updateQuota();
  }
}

function renderResults(R){
  const box = $('#cResults'); const parts = [];
  const sevChip = { err: '<span class="chip err">오류</span>', warn: '<span class="chip warn">주의</span>', info: '<span class="chip info">참고</span>' };
  if (R.inference){
    const I = R.inference;
    const rows = [];
    I.types.forEach((list, id) => {
      const n = nodeById(id); const viaSub = typeClosure(n);
      list.forEach(c => {
        const label = c.union ? `(${c.union}) 중 하나` : c.id ? nm(c) : c.iri;
        const why = c.id && viaSub.has(c.id) ? '상속(subClassOf)으로 따라옴' : '관계의 domain/range 때문에 붙음 — 의도한 게 아니면 데이터 검사의 불일치 항목을 보세요';
        rows.push(`<div class="ritem">${goLink('node', n.id, nm(n))} → <b>${esc(label)}</b><div class="why">${why}</div></div>`);
      });
    });
    I.sameAs.forEach(([a, b]) => rows.push(`<div class="ritem"><span class="chip warn">합쳐짐</span> ${a ? goLink('node', a.id, nm(a)) : '?'} = ${b ? goLink('node', b.id, nm(b)) : '?'}<div class="why">값이 하나만 허용되는 관계에 두 값이 들어가 같은 개체로 추론됐습니다.</div></div>`));
    I.clashes.forEach(([a, c]) => rows.push(`<div class="ritem"><span class="chip err">모순</span> ${a ? goLink('node', a.id, nm(a)) : '?'}가 서로 겹칠 수 없는 클래스(${esc(nm(c))} 등)에 동시에 속합니다.</div>`));
    I.props.forEach(([s, p, o]) => rows.push(`<div class="ritem">${goLink('node', s.id, nm(s))} —${esc(p.replace(/^.*[#/]/, ''))}→ ${o ? goLink('node', o.id, nm(o)) : '?'}<div class="why">역관계·대칭·전이·하위 속성 규칙으로 새로 생긴 관계</div></div>`));
    const canShow = [...I.types.values()].some(l => l.some(c => c.id));
    parts.push(`<div class="rsec"><b>추론 결과</b><span class="chip">${rows.length}건</span>${I.subclassCount ? `<span class="chip">간접 상속 ${I.subclassCount}건</span>` : ''}
      ${canShow ? `<label class="check" style="margin-left:auto;font-size:12.5px"><input type="checkbox" id="cOverlay"${inferOverlay && inferOverlay.show ? ' checked' : ''}> 캔버스에 추론된 타입 표시</label>` : ''}</div>
      ${rows.join('') || '<div class="hint">새로 추론된 사실이 없습니다.</div>'}`);
    // 오버레이 준비
    const edges = [];
    I.types.forEach((list, id) => list.forEach(c => { if (c.id && !state.edges.some(e => e.from === id && e.to === c.id && e.kind === 'type')) edges.push({ from: id, to: c.id }); }));
    inferOverlay = { key: semanticKey(), edges, show: inferOverlay ? inferOverlay.show : false };
  }
  if (R.data){
    parts.push(`<div class="rsec"><b>데이터 검사</b><span class="chip">${R.data.length}건</span></div>` +
      (R.data.map(d => `<div class="ritem">${sevChip[d.sev]} ${d.html}</div>`).join('') || '<div class="hint">문제가 없습니다.</div>'));
  }
  if (R.oops || R.oopsErr){
    const { node, prop } = iriIndex();
    const affected = iri => { const n = node.get(iri); if (n) return goLink('node', n.id, nm(n)); const p = prop.get(iri); if (p && p.id) return goLink('edge', p.id, p.label || p.name); if (p && p.node) return goLink('node', p.node.id, `${nm(p.node)}.${p.attr.name}`); return `<span class="mono">${esc(iri)}</span>`; };
    const impChip = { Critical: '<span class="chip err">심각</span>', Important: '<span class="chip warn">중요</span>', Minor: '<span class="chip">경미</span>' };
    const order = { Critical: 0, Important: 1, Minor: 2 };
    const item = p => `<div class="ritem">${impChip[p.importance] || ''} <b>${esc(p.code)}</b> ${esc(p.name)}${p.affected.length ? ` <span class="chip">${p.count || p.affected.length}개 요소</span>` : ''}
      <details><summary class="why">설명과 해당 요소</summary><div class="desc">${esc(p.description)}</div>${p.affected.length ? `<div class="desc">${p.affected.map(affected).join(', ')}</div>` : '<div class="desc">온톨로지 전체에 해당</div>'}</details></div>`;
    parts.push(`<div class="rsec"><b>OOPS! 함정 점검</b>${R.oops ? `<span class="chip">${R.oops.pitfalls.length}종</span>` : '<span class="chip err">실패</span>'}
      <a class="hint" style="margin-left:auto" href="https://oops.linkeddata.es/catalogue.jsp" target="_blank" rel="noopener">함정 목록 보기</a></div>` +
      (R.oops ? (R.oops.pitfalls.slice().sort((a, b) => (order[a.importance] ?? 3) - (order[b.importance] ?? 3)).map(item).join('') || '<div class="hint">발견된 함정이 없습니다.</div>') +
        R.oops.warnings.concat(R.oops.suggestions).map(item).join('') : `<div class="ritem">${esc(R.oopsErr)}</div>`));
  }
  box.innerHTML = parts.join('');
  const ov = $('#cOverlay');
  if (ov) ov.addEventListener('change', () => { if (inferOverlay){ inferOverlay.show = ov.checked; renderCanvas(); } });
  box.querySelectorAll('[data-go-node]').forEach(a => a.addEventListener('click', () => { closeCheck(); select({ type: 'node', id: a.dataset.goNode }); }));
  box.querySelectorAll('[data-go-edge]').forEach(a => a.addEventListener('click', () => { closeCheck(); select({ type: 'edge', id: a.dataset.goEdge }); }));
}
function openCheck(){
  try { $('#cOops').checked = localStorage.getItem(OOPS_KEY + ':on') === '1'; } catch (e) {}
  updateQuota();
  $('#checkModal').hidden = false;
  runCheck();
}
function closeCheck(){ $('#checkModal').hidden = true; }
$('#bCheck').onclick = openCheck;
$('#cRun').onclick = runCheck;
$('#cCancel').onclick = () => { if (checkRun) checkRun.ctl.abort(); };
$('#cClose').onclick = closeCheck;
$('#checkModal').addEventListener('click', ev => { if (ev.target.id === 'checkModal') closeCheck(); });
$('#cOops').addEventListener('change', () => { try { localStorage.setItem(OOPS_KEY + ':on', $('#cOops').checked ? '1' : '0'); } catch (e) {} });
setInterval(() => { if (!$('#checkModal').hidden) updateQuota(); }, 1000);
