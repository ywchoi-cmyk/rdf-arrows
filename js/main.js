/* RDF Arrows · 툴바, 예시, 시작 */
'use strict';

/* ---------- 툴바 ---------- */
$('#bNew').onclick = () => { checkpoint(); state = blankState(); selection = null; renderAll(); fit(); persist(); openOntoSettings(true); toast('새 캔버스: 먼저 이름을 정하세요 (되돌리려면 ⌘/Ctrl+Z)'); };
$('#bHelp').onclick = () => { $('#helpBody').innerHTML = HELP_HTML; $('#helpModal').hidden = false; };
$('#hClose').onclick = () => { $('#helpModal').hidden = true; };
$('#helpModal').addEventListener('click', ev => { if (ev.target.id === 'helpModal') $('#helpModal').hidden = true; });
$('#bOpen').onclick = () => $('#fileIn').click();
function setAddKind(k){
  addKind = k;
  $('#mClass').classList.toggle('on', k === 'class'); $('#mIndiv').classList.toggle('on', k === 'individual');
  try { localStorage.setItem(STORAGE_KEY + ':addKind', k); } catch (e) {}
}
$('#mClass').onclick = () => setAddKind('class');
$('#mIndiv').onclick = () => setAddKind('individual');
try { const k = localStorage.getItem(STORAGE_KEY + ':addKind'); if (k === 'individual') setAddKind(k); } catch (e) {}
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#bLayout').onclick = () => { if (!state.nodes.length) return; checkpoint(); autoLayout(state, false); renderCanvas(); fit(); persist(); };

const SAMPLE = `@prefix ex: <http://example.org/org#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<http://example.org/org> a owl:Ontology ; rdfs:label "조직 예시"@ko .
ex:Person a owl:Class ; rdfs:label "사람"@ko .
ex:Organization a owl:Class ; rdfs:label "조직"@ko .
ex:Unit a owl:Class ; rdfs:label "부대"@ko ; rdfs:subClassOf ex:Organization .
ex:Mission a owl:Class ; rdfs:label "임무"@ko .
ex:memberOf a owl:ObjectProperty ; rdfs:label "소속"@ko ; rdfs:domain ex:Person ; rdfs:range ex:Organization .
ex:commands a owl:ObjectProperty ; rdfs:label "지휘"@ko ; rdfs:domain ex:Person ; rdfs:range ex:Unit .
ex:assignedTo a owl:ObjectProperty ; rdfs:label "수행"@ko ; rdfs:domain ex:Unit ; rdfs:range ex:Mission .
ex:name a owl:DatatypeProperty ; rdfs:domain ex:Person ; rdfs:range xsd:string .
ex:startDate a owl:DatatypeProperty ; rdfs:domain ex:Mission ; rdfs:range xsd:date .
ex:kim a owl:NamedIndividual , ex:Person ; rdfs:label "김대위"@ko ; ex:name "김철수" ; ex:commands ex:unit1 .
ex:unit1 a owl:NamedIndividual , ex:Unit ; rdfs:label "제1대대"@ko ; ex:assignedTo ex:mission1 .
ex:mission1 a owl:NamedIndividual , ex:Mission ; rdfs:label "경계 임무"@ko ; ex:startDate "2026-11-20"^^xsd:date .
# ${LAYOUT_TAG} {"v":2,"nodes":{"http://example.org/org#Person":[-260,-60],"http://example.org/org#Organization":[120,-200],"http://example.org/org#Unit":[120,20],"http://example.org/org#Mission":[460,20],"http://example.org/org#kim":[-260,230],"http://example.org/org#unit1":[120,230],"http://example.org/org#mission1":[460,230]}}
`;
const loadSample = () => loadText(SAMPLE, '예시');
const ORG_URL = 'https://www.w3.org/ns/org.ttl';
async function loadOrgSample(){
  toast('W3C ORG 받는 중…');
  try {
    const r = await fetch(ORG_URL);
    if (!r.ok) throw new Error('서버 응답 ' + r.status);
    loadText(await r.text(), 'W3C ORG');
  } catch (e){ toast(`받지 못했습니다. ${ORG_URL} 을 내려받아 캔버스에 끌어다 놓으세요.`); }
}
const sampleMenu = $('#sampleMenu');
const setSampleMenu = open => { sampleMenu.hidden = !open; $('#bSample').setAttribute('aria-expanded', String(open)); };
$('#bSample').onclick = ev => { ev.stopPropagation(); setSampleMenu(sampleMenu.hidden); };
sampleMenu.querySelectorAll('[data-sample]').forEach(b => b.onclick = () => { setSampleMenu(false); b.dataset.sample === 'org' ? loadOrgSample() : loadSample(); });
document.addEventListener('click', ev => { if (!sampleMenu.hidden && !ev.target.closest('.samplewrap')) setSampleMenu(false); });
$('#bSample2').onclick = loadSample;

/* ---------- 시작 ---------- */
let restored = false;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && saved.state && Array.isArray(saved.state.nodes)){ state = saved.state; ensureMeta(state.meta); state.nodes.forEach(n => { if (OLD_DEFAULTS.has(n.color)) n.color = null; }); if (saved.view) view = saved.view; restored = true; }
} catch (e) {}
renderAll(); updateHistoryButtons();
if (!restored) requestAnimationFrame(fit);
window.__rdfArrows = { get state(){ return state; }, get ui(){ return ui; }, PALETTE, vocab, loadVocab, colorOf: id => colorOf(nodeById(id)), toTurtle, importTurtle, toRdfXml, OOPS, runOops, runReasoner, summarizeInference, dataChecks, get inferOverlay(){ return inferOverlay; } };
window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !sampleMenu.hidden) setSampleMenu(false); });
