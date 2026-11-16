/* RDF Arrows · 외부 온톨로지 용어 불러오기 (필요할 때 받기, 브라우저 저장, 검색) */
'use strict';

/* ---------- 외부 용어: 필요할 때 불러와서 드롭다운에서 고르기 ---------- */
/** 브라우저에서 바로 받을 수 있는 곳만 url을 둠. 막힌 곳은 링크를 안내하고 파일로 올리게 함 */
const SOURCES = {
  'http://purl.obolibrary.org/obo/': { url: 'https://raw.githubusercontent.com/BFO-ontology/BFO-2020/master/21838-2/owl/bfo-core.ttl', size: '107 KB', format: 'Turtle' },
  'https://schema.org/': { url: 'https://schema.org/version/latest/schemaorg-current-https.ttl', size: '1.0 MB', format: 'Turtle' },
  'http://www.w3.org/2004/02/skos/core#': { url: 'https://www.w3.org/2009/08/skos-reference/skos.rdf', size: '28 KB', format: 'RDF/XML' },
  'http://www.w3.org/ns/prov#': { url: 'https://www.w3.org/ns/prov-o.ttl', size: '67 KB', format: 'Turtle' },
  'http://purl.org/dc/terms/': { url: 'https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl', size: '47 KB', format: 'Turtle' },
  'http://www.w3.org/2006/time#': { url: 'https://www.w3.org/2006/time.ttl', size: '98 KB', format: 'Turtle' },
  'http://xmlns.com/foaf/0.1/': { manual: 'http://xmlns.com/foaf/spec/', note: 'FOAF 사이트가 브라우저에서 바로 받는 것을 막습니다. 링크에서 RDF 파일(index.rdf)을 받아 올려 주세요.' },
  'http://www.opengis.net/ont/geosparql#': { manual: 'https://github.com/opengeospatial/ogc-geosparql', note: '브라우저에서 바로 받을 수 있는 공식 파일 주소가 없습니다. 링크에서 geo.ttl을 받아 올려 주세요.' }
};
const KIND_OF = { [STD.owl + 'Class']: 'class', [STD.rdfs + 'Class']: 'class', [STD.owl + 'ObjectProperty']: 'op', [STD.owl + 'DatatypeProperty']: 'dp', [STD.rdf + 'Property']: 'prop', [STD.owl + 'AnnotationProperty']: 'ann' };
const KIND_KO = { class: '클래스', op: '객체 속성', dp: '데이터 속성', prop: '속성', ann: '주석 속성' };
const kindOk = (k, want) => want === 'class' ? k === 'class' : want === 'op' ? (k === 'op' || k === 'prop') : want === 'dp' ? (k === 'dp' || k === 'prop' || k === 'ann') : false;
const vocab = {};              // 네임스페이스 → { status, terms, loaded, total, phase, error, ctl, from }
let activeCombo = null;        // 열려 있는 드롭다운 (진행 상황 갱신용)
const refreshCombo = () => { if (activeCombo && !activeCombo.menu.hidden) activeCombo.reopen(); };

/* 불러온 용어는 이 브라우저(IndexedDB)에 저장 */
function idb(){ return new Promise((res, rej) => { try { const r = indexedDB.open('rdf-arrows-vocab', 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e){ rej(e); } }); }
async function idbPut(key, val){ try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) {} }
async function idbAll(){ try { const db = await idb(); return await new Promise((res, rej) => { const out = {}; const rq = db.transaction('v').objectStore('v').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c){ out[c.key] = c.value; c.continue(); } else res(out); }; rq.onerror = () => rej(rq.error); }); } catch (e){ return {}; } }
idbAll().then(all => Object.entries(all).forEach(([ns, v]) => { if (!vocab[ns] && v && Array.isArray(v.terms)) vocab[ns] = { status: 'ready', terms: v.terms, from: v.from }; }));

let rdfxmlP = null;
function rdfxmlModule(){
  if (!rdfxmlP) rdfxmlP = new Promise((res, rej) => {
    if (window.RdfXml) return res(window.RdfXml);
    const s = document.createElement('script'); s.src = 'lib/rdfxml.min.js';
    s.onload = () => window.RdfXml ? res(window.RdfXml) : rej(new Error('RDF/XML 모듈을 읽지 못했습니다'));
    s.onerror = () => { rdfxmlP = null; rej(new Error('RDF/XML 모듈을 받지 못했습니다')); };
    document.head.append(s);
  });
  return rdfxmlP;
}
const looksXml = t => /^\s*(<\?xml|<!--|<!DOCTYPE|<[A-Za-z_][\w.\-]*:RDF\b|<RDF\b)/.test(t);
async function indexVocab(text, ns, base){
  const quads = looksXml(text) ? await (await rdfxmlModule()).parse(text, base) : new N3.Parser({ baseIRI: base }).parse(text);
  const types = new Map(), labels = new Map(), defs = new Map();
  const LBL = [STD.rdfs + 'label', 'http://www.w3.org/2004/02/skos/core#prefLabel'];
  const DEF = ['http://www.w3.org/2004/02/skos/core#definition', STD.rdfs + 'comment', 'http://purl.org/dc/terms/description'];
  for (const q of quads){
    if (q.subject.termType !== 'NamedNode') continue;
    const s = q.subject.value, p = q.predicate.value, o = q.object;
    if (p === STD.rdf + 'type' && KIND_OF[o.value]){
      const k = KIND_OF[o.value], prev = types.get(s);
      if (!prev || ((prev === 'prop' || prev === 'ann') && (k === 'op' || k === 'dp'))) types.set(s, k);
    } else if (o.termType === 'Literal' && LBL.includes(p)){ if (!labels.has(s)) labels.set(s, []); labels.get(s).push(o); }
    else if (o.termType === 'Literal' && DEF.includes(p) && !defs.has(s)) defs.set(s, o.value);
  }
  const want = [state.meta.lang || '', 'ko', 'en', ''];
  const mk = ([s, k]) => {
    const ls = labels.get(s) || [];
    const l = want.map(w => ls.find(x => (x.language || '') === w)).find(Boolean) || ls[0];
    return { iri: s, kind: k, label: l ? l.value : s.replace(/^.*[#/]/, ''), def: (defs.get(s) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  };
  let terms = [...types.entries()].filter(([s]) => s.startsWith(ns)).map(mk);
  if (!terms.length) terms = [...types.entries()].map(mk);   // 네임스페이스가 다르게 적힌 파일
  return terms;
}
async function loadVocab(ns){
  const src = SOURCES[ns]; if (!src || !src.url) return;
  if (vocab[ns] && vocab[ns].status === 'loading') return;
  const v = vocab[ns] = { status: 'loading', loaded: 0, total: 0, phase: '받는 중', ctl: new AbortController() };
  refreshCombo();
  let last = 0;
  try {
    const r = await fetch(src.url, { signal: v.ctl.signal });
    if (!r.ok) throw new Error(`서버 응답 ${r.status}`);
    v.total = +(r.headers.get('content-length') || 0);
    let text;
    if (r.body && r.body.getReader){
      const rd = r.body.getReader(), parts = [];
      for (;;){ const { done, value } = await rd.read(); if (done) break; parts.push(value); v.loaded += value.length; if (performance.now() - last > 120){ last = performance.now(); refreshCombo(); } }
      const all = new Uint8Array(v.loaded); let o = 0; parts.forEach(pt => { all.set(pt, o); o += pt.length; });
      text = new TextDecoder().decode(all);
    } else { text = await r.text(); v.loaded = text.length; }
    v.phase = '용어 정리 중'; refreshCombo(); await tick();
    const terms = await indexVocab(text, ns, src.url);
    if (!terms.length) throw new Error('파일에서 용어를 찾지 못했습니다');
    vocab[ns] = { status: 'ready', terms, from: src.url };
    idbPut(ns, { terms, from: src.url, at: Date.now() });
  } catch (e){
    vocab[ns] = e.name === 'AbortError' ? { status: 'idle' } : { status: 'error', error: /Failed to fetch|NetworkError/i.test(e.message) ? '받지 못했습니다 (네트워크 문제이거나 사이트가 막음)' : e.message };
  }
  refreshCombo();
}
async function uploadVocab(ns, file){
  vocab[ns] = { status: 'loading', loaded: file.size, total: file.size, phase: '파일 읽는 중' }; refreshCombo();
  try {
    const text = await file.text();
    vocab[ns].phase = '용어 정리 중'; refreshCombo(); await tick();
    const terms = await indexVocab(text, ns, ns);
    if (!terms.length) throw new Error('클래스나 속성을 찾지 못했습니다');
    vocab[ns] = { status: 'ready', terms, from: 'file:' + file.name };
    idbPut(ns, { terms, from: 'file:' + file.name, at: Date.now() });
    toast(`${file.name}: 용어 ${terms.length}개를 불러왔습니다. 이름 칸에 검색어를 입력하세요.`);
  } catch (e){ vocab[ns] = { status: 'error', error: '파일을 읽지 못했습니다: ' + e.message }; }
  refreshCombo();
}
function compactIri(iri){
  const pm = prefixMap();
  for (const [p, ns] of Object.entries(pm)) if (ns && iri.startsWith(ns) && SAFE_LOCAL.test(iri.slice(ns.length))) return `${p}:${iri.slice(ns.length)}`;
  return iri;
}
const importedLabel = iri => { const t = (state.meta.imports || []).find(x => x.iri === iri); return t ? t.label : ''; };
function pinImport(t){
  const m = state.meta; m.imports = m.imports || [];
  if (!m.imports.some(x => x.iri === t.iri)) m.imports.push({ iri: t.iri, label: t.label, kind: t.kind });
}
const nodeTitle = n => n.label || importedLabel(fullIri(n.name)) || n.name || '(이름 없음)';
const edgeTitle = e => e.label || importedLabel(fullIri(e.name)) || e.name || '';

/* ---------- 드롭다운: 이 온톨로지 + 가져온 외부 용어 + 외부 온톨로지 ---------- */
function sourceRowHTML(x){
  const src = SOURCES[x.iri] || {}, v = vocab[x.iri] || { status: 'idle' };
  const name = (PRESETS.find(p => p.iri === x.iri) || {}).name || x.iri;
  const btn = (act, t) => `<button type="button" data-act="${act}" data-ns="${esc(x.iri)}">${t}</button>`;
  let info = '', bar = '', right = '';
  if (v.status === 'loading'){
    const pct = v.total && v.loaded <= v.total ? Math.round(v.loaded / v.total * 100) : null;
    info = `${v.phase} · ${fmtBytes(v.loaded)}${v.total && pct !== null ? ' / ' + fmtBytes(v.total) : ''}`;
    bar = `<span class="bar"><i style="width:${pct === null ? 100 : pct}%"></i></span>`;
    right = v.ctl ? btn('cancel', '취소') : '';
  } else if (v.status === 'ready'){
    info = `불러옴 · 용어 ${v.terms.length}개${v.from && v.from.startsWith('file:') ? ' · ' + esc(v.from.slice(5)) : ''} · 이름 칸에 검색어를 입력하세요`;
    right = src.url ? btn('load', '다시 받기') : btn('file', '다른 파일');
  } else if (v.status === 'error'){
    info = esc(v.error); right = (src.url ? btn('load', '다시 시도') : '') + btn('file', '파일로 추가');
  } else if (src.url){
    info = `${src.size} · ${src.format}`; right = btn('load', '불러오기');
  } else {
    info = esc(src.note || '이 온톨로지 파일을 올리면 용어를 찾을 수 있습니다.') + (src.manual ? ` <a href="${src.manual}" target="_blank" rel="noopener">받는 곳 열기</a>` : '');
    right = btn('file', '파일로 추가');
  }
  return `<div class="combo-src"><div class="cs-main"><b>${esc(name)}</b> <span class="mono">${esc(x.p)}:</span><span class="hint">${info}</span>${bar}</div><div class="cs-act">${right}</div></div>`;
}
function searchVocab(q, want, limit){
  const out = []; let total = 0;
  extraList(state.meta).forEach(x => {
    const v = vocab[x.iri]; if (!v || v.status !== 'ready') return;
    v.terms.forEach(t => {
      if (!kindOk(t.kind, want)) return;
      const lab = t.label.toLowerCase(), loc = t.iri.replace(/^.*[#/]/, '').toLowerCase();
      if (!lab.includes(q) && !loc.includes(q)) return;
      total++; out.push({ t, score: (lab.startsWith(q) || loc.startsWith(q) ? 0 : 1) * 1000 + lab.length });
    });
  });
  out.sort((a, b) => a.score - b.score);
  return { list: out.slice(0, limit).map(o => o.t), total };
}
