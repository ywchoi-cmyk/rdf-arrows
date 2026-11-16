/* RDF Arrows · 상수, 상태, 실행 취소·자동 저장, 이름과 IRI 규칙, 노드 종류, 노드·관계 만들기, 크기 측정 */
'use strict';

/* ---------- 상수 ---------- */
const NS = 'http://www.w3.org/2000/svg';
const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
const STORAGE_KEY = 'rdf-arrows:v1';
const LAYOUT_TAG = 'rdf-arrows-layout:';
const STD = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#'
};
const XSD_TYPES = ['xsd:string','xsd:integer','xsd:decimal','xsd:double','xsd:boolean','xsd:date','xsd:dateTime','xsd:anyURI','rdf:langString','rdfs:Literal'];
/** 채도 낮은 24색: 12색상 × 연·진 2단 [이름, 바탕, 테두리]. 글자 대비 11.6:1 이상, 테두리 3:1 이상 */
const PALETTE = [["장미 연", "#ffe9e8", "#b77474"], ["살구 연", "#ffebdf", "#b37a5a"], ["모래 연", "#fbeeda", "#a4834b"], ["올리브 연", "#f3f2db", "#918c4d"], ["연두 연", "#ebf4de", "#7d9258"], ["초록 연", "#e3f6e6", "#63986e"], ["청록 연", "#daf7f4", "#409a94"], ["하늘 연", "#dcf5ff", "#4994b0"], ["파랑 연", "#e3f2ff", "#668cbc"], ["남색 연", "#edeeff", "#8482bb"], ["보라 연", "#f8ebfe", "#9d79ad"], ["자주 연", "#ffe8f3", "#b07490"], ["장미 진", "#ffd5ca", "#ab6553"], ["살구 진", "#f8dabe", "#a16e39"], ["모래 진", "#eae0bb", "#8c7930"], ["올리브 진", "#dbe5c0", "#73833e"], ["연두 진", "#cfe8c9", "#5b8851"], ["초록 진", "#c2ebd7", "#398c6c"], ["청록 진", "#baeaef", "#158a95"], ["하늘 진", "#c3e5fe", "#3f81ad"], ["파랑 진", "#d2dfff", "#6477b3"], ["남색 진", "#e4d9fd", "#836daa"], ["보라 진", "#f4d4f0", "#9a6595"], ["자주 진", "#fed3db", "#a96173"]].map(([name, fill, stroke]) => ({ name, fill, stroke }));
const NO_TYPE = { name: '타입 없음', fill: '#f6f7f9', stroke: '#9aa2ad' };
const OLD_DEFAULTS = new Set(['#ffffff', '#fffaf0']);   // 예전 버전의 기본색 = 자동으로 취급
function fnv1a(str){ let h = 0x811c9dc5; for (const b of new TextEncoder().encode(str)){ h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const paletteByFill = fill => PALETTE.find(c => c.fill === fill) || { name: '직접 지정', fill, stroke: '#9aa2ad' };
/** 자동 색: 클래스는 IRI 해시, 개체는 첫 번째 타입 클래스의 색, 타입이 없으면 회색 */
function autoColor(n, seen){
  if (isIndiv(n)){
    const t = typesOf(n)[0];
    if (!t) return NO_TYPE;
    seen = seen || new Set(); if (seen.has(t.id)) return NO_TYPE; seen.add(t.id);
    return colorOf(t, seen);
  }
  return PALETTE[fnv1a(fullIri(n.name)) % PALETTE.length];
}
const colorOf = (n, seen) => n.color ? paletteByFill(n.color) : autoColor(n, seen);

/* ---------- 상태 ---------- */
function blankState(){
  return {
    meta: { title: '새 온톨로지', ontologyIri: 'http://example.org/onto', baseIri: 'http://example.org/onto#', prefix: 'ex', lang: 'ko', extraPrefixes: '', sep: '#', ontoSame: true, iriAuto: true, prefixAuto: true, naming: 'iri' },
    nodes: [], edges: [], seq: 1
  };
}
let state = blankState();
let view = { x: 0, y: 0, k: 1 };
let selection = null;           // {type:'node'|'edge', id}

const $ = s => document.querySelector(s);
const svg = $('#canvas'), gView = $('#viewport'), gEdges = $('#edges'), gNodes = $('#nodes'), gOverlay = $('#overlay');

const uid = p => p + (state.seq++);
const nodeById = id => state.nodes.find(n => n.id === id);
const edgeById = id => state.edges.find(e => e.id === id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 저장 / 실행 취소 ---------- */
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify(state);
function checkpoint(){
  const s = snap();
  if (undoStack[undoStack.length - 1] !== s) { undoStack.push(s); if (undoStack.length > 300) undoStack.shift(); }
  redoStack.length = 0; updateHistoryButtons();
}
function undo(){
  const cur = snap();
  while (undoStack.length){ const s = undoStack.pop(); if (s !== cur){ redoStack.push(cur); state = JSON.parse(s); afterHistory(); return; } }
  updateHistoryButtons();
}
function redo(){
  const cur = snap();
  while (redoStack.length){ const s = redoStack.pop(); if (s !== cur){ undoStack.push(cur); state = JSON.parse(s); afterHistory(); return; } }
  updateHistoryButtons();
}
function afterHistory(){
  ensureMeta(state.meta);
  if (selection && !(selection.type === 'node' ? nodeById(selection.id) : edgeById(selection.id))) selection = null;
  renderAll(); persist(); updateHistoryButtons();
}
function updateHistoryButtons(){ $('#bUndo').disabled = !undoStack.length; $('#bRedo').disabled = !redoStack.length; }
let persistTimer = null;
function persist(){
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, view })); } catch (e) {}
    // 모델 내용이 바뀌면 이전 검사의 추론 표시는 지움
    if (typeof inferOverlay !== 'undefined' && inferOverlay && inferOverlay.key !== semanticKey()){ inferOverlay = null; renderCanvas(); }
  }, 250);
}

/* ---------- 이름 / IRI ---------- */
function deriveName(label, kind){
  const tokens = String(label).trim().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (!tokens.length) return '';
  let out = tokens.map((t, i) => {
    const f = t[0];
    if (kind === 'class' || i > 0) return /[a-z]/.test(f) ? f.toUpperCase() + t.slice(1) : t;
    if (/[A-Z]/.test(f) && (t.length === 1 || /[a-z]/.test(t[1]))) return f.toLowerCase() + t.slice(1);
    return t;
  }).join('');
  return out;
}
function prefixMap(){
  const m = Object.assign({}, STD);
  String(state.meta.extraPrefixes || '').split(/\n/).forEach(line => {
    const mm = line.trim().match(/^@?(?:prefix\s+)?([A-Za-z][\w\-]*)?\s*:\s*<?\s*(\S+?)\s*>?\s*\.?$/i);
    if (mm && mm[2]) m[mm[1] || ''] = mm[2];
  });
  m[state.meta.prefix || ''] = state.meta.baseIri;
  return m;
}
const SAFE_LOCAL = /^[\p{L}\p{N}_][\p{L}\p{N}_\-]*$/u;
const encLocal = s => String(s).replace(/[\s<>"{}|^`\\]/g, c => encodeURIComponent(c));
/** 사용자가 입력한 이름 → 전체 IRI */
function fullIri(name, pm = prefixMap()){
  name = String(name || '').trim();
  if (/^(https?):\/\//i.test(name) || /^urn:/i.test(name)) return name;
  const m = name.match(/^([A-Za-z][\w\-]*)?:(.*)$/);
  if (m && pm[m[1] || ''] !== undefined) return pm[m[1] || ''] + encLocal(m[2]);
  return state.meta.baseIri + encLocal(name);
}
/** 사용자가 입력한 이름 → Turtle 표기 */
function ttlTerm(name, pm = prefixMap()){
  name = String(name || '').trim();
  if (/^(https?):\/\//i.test(name) || /^urn:/i.test(name)) return `<${name}>`;
  const m = name.match(/^([A-Za-z][\w\-]*)?:(.*)$/);
  if (m && pm[m[1] || ''] !== undefined){
    return SAFE_LOCAL.test(m[2]) ? `${m[1] || ''}:${m[2]}` : `<${pm[m[1] || ''] + encLocal(m[2])}>`;
  }
  return SAFE_LOCAL.test(name) ? `${state.meta.prefix || ''}:${name}` : `<${state.meta.baseIri + encLocal(name)}>`;
}
function isExternal(name){
  const m = String(name || '').match(/^([A-Za-z][\w\-]*)?:/);
  if (/^(https?):\/\//i.test(name)) return !String(name).startsWith(state.meta.baseIri);
  return !!(m && (m[1] || '') !== (state.meta.prefix || ''));
}
function uniqueName(base, used){
  if (!used.has(base)) return base;
  let i = 2; while (used.has(base + i)) i++; return base + i;
}
const classNames = (exceptId) => new Set(state.nodes.filter(n => n.id !== exceptId).map(n => n.name));

/* ---------- 노드 종류 ---------- */
const isIndiv = n => !!n && n.kind === 'individual';
const nameKind = n => isIndiv(n) ? 'prop' : 'class';
/** 'CC' 클래스→클래스, 'IC' 개체→클래스, 'II' 개체→개체, 'CI' 클래스→개체 */
function edgeShape(e){
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return '';
  return (isIndiv(a) ? 'I' : 'C') + (isIndiv(b) ? 'I' : 'C');
}
function normalizeEdge(e){
  const s = edgeShape(e);
  if (s === 'CC'){ if (e.kind === 'type') e.kind = 'subclass'; }
  else if (s === 'IC') e.kind = 'type';
  else if (e.kind !== 'object') e.kind = 'object';
}
const typesOf = n => [...new Set(state.edges.filter(e => e.from === n.id && e.kind === 'type').map(e => e.to))].map(nodeById).filter(Boolean);
/** 두 개체의 타입 사이에 정의된 TBox 관계 (개체 관계 이름 추천용) */
function tboxPropFor(a, b){
  const ta = new Set(typesOf(a).map(c => c.id)), tb = new Set(typesOf(b).map(c => c.id));
  return state.edges.find(e => e.kind === 'object' && edgeShape(e) === 'CC' && ta.has(e.from) && tb.has(e.to));
}

/* ---------- 변경 ---------- */
let addKind = 'class';
const iriFirst = () => (state.meta.naming || 'iri') !== 'label';
const primaryField = () => iriFirst() ? 'name' : 'label';
function addNode(x, y, kind = 'class'){
  const indiv = kind === 'individual';
  const used = classNames();
  let k = state.nodes.filter(n => isIndiv(n) === indiv).length + 1, label, name;
  if (iriFirst()) do { label = ''; name = (indiv ? 'individual' : 'Class') + k; k++; } while (used.has(name));
  else do { label = indiv ? `개체 ${k}` : `클래스 ${k}`; name = deriveName(label, indiv ? 'prop' : 'class'); k++; } while (used.has(name));
  const n = { id: uid('n'), kind: indiv ? 'individual' : 'class', x, y, label, name, nameAuto: true, comment: '', color: null, attrs: [] };
  state.nodes.push(n); return n;
}
function addEdge(from, to){
  const used = new Set(state.edges.map(e => e.name));
  const e = { id: uid('e'), from, to, kind: 'object', label: '', name: uniqueName('relatedTo', used), nameAuto: true, comment: '', functional: false };
  state.edges.push(e);
  normalizeEdge(e);
  if (edgeShape(e) === 'II'){
    const t = tboxPropFor(nodeById(from), nodeById(to));
    if (t){ e.name = t.name; e.label = t.label; e.nameAuto = false; }
  }
  return e;
}
function deleteSelection(){
  if (!selection) return;
  checkpoint();
  if (selection.type === 'node'){
    state.nodes = state.nodes.filter(n => n.id !== selection.id);
    state.edges = state.edges.filter(e => e.from !== selection.id && e.to !== selection.id);
  } else state.edges = state.edges.filter(e => e.id !== selection.id);
  selection = null; renderAll(); persist();
}

/* ---------- 측정 ---------- */
const mctx = document.createElement('canvas').getContext('2d');
function textW(s, font){ mctx.font = font; return mctx.measureText(s).width; }
const shortType = t => String(t).replace(/^xsd:/, '');
const attrText = (n, a) => isIndiv(n)
  ? `${a.name || '?'} = ${a.value === '' || a.value === undefined ? '…' : a.value}`
  : `${a.name || '?'} : ${shortType(a.type)}`;
function nodeSize(n){
  const title = nodeTitle(n);
  let w = textW(title, `700 13px ${FONT}`) + 32;
  let sub = '';
  if (isIndiv(n)){ const ts = typesOf(n).map(nodeTitle); if (ts.length) sub = ': ' + ts.join(', '); }
  else if (n.name && nodeTitle(n) !== n.name) sub = n.name;
  if (sub) w = Math.max(w, textW(sub, `10.5px ${FONT}`) + 28);
  n.attrs.forEach(a => { w = Math.max(w, textW(attrText(n, a), `12px ${FONT}`) + 26); });
  w = Math.max(110, Math.ceil(w));
  const head = sub ? 46 : 36;
  const h = head + (n.attrs.length ? n.attrs.length * 18 + 8 : 0);
  return { w, h, head, sub };
}
function rectPoint(n, s, tx, ty){
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const sc = Math.min((s.w / 2) / Math.abs(dx || 1e-9), (s.h / 2) / Math.abs(dy || 1e-9));
  return { x: n.x + dx * sc, y: n.y + dy * sc };
}
