/* RDF Arrows · 캔버스 왼쪽 위 온톨로지 카드, 선택 없을 때 패널, 도움말 */
'use strict';

/* ---------- 온톨로지 카드 (캔버스 왼쪽 위) ---------- */
const PRESETS = [
  { p: 'obo', iri: 'http://purl.obolibrary.org/obo/', name: 'Basic Formal Ontology (OBO)' },
  { p: 'schema', iri: 'https://schema.org/', name: 'schema.org' },
  { p: 'skos', iri: 'http://www.w3.org/2004/02/skos/core#', name: 'SKOS' },
  { p: 'prov', iri: 'http://www.w3.org/ns/prov#', name: 'PROV-O' },
  { p: 'dcterms', iri: 'http://purl.org/dc/terms/', name: 'Dublin Core Terms' },
  { p: 'foaf', iri: 'http://xmlns.com/foaf/0.1/', name: 'FOAF' },
  { p: 'time', iri: 'http://www.w3.org/2006/time#', name: 'OWL-Time' },
  { p: 'geo', iri: 'http://www.opengis.net/ont/geosparql#', name: 'GeoSPARQL' }
];
const LANGS = [['ko', '한국어'], ['en', 'English'], ['', '표시 안 함']];
const UI_KEY = STORAGE_KEY + ':ui';
let ui = { card: 'card', adv: false, imports: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) {}
if (ui.card === 'open') ui.card = 'card';
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ card: ui.card === 'open' ? 'card' : ui.card, adv: ui.adv })); } catch (e) {} };

/** 예전에 저장된 모델에도 새 설정값을 채움 */
function ensureMeta(m){
  if (m.sep === undefined) m.sep = /\/$/.test(m.baseIri || '') ? '/' : '#';
  if (m.ontoSame === undefined) m.ontoSame = (m.ontologyIri || '') === String(m.baseIri || '').replace(/[#/]$/, '');
  if (m.iriAuto === undefined) m.iriAuto = false;
  if (m.prefixAuto === undefined) m.prefixAuto = false;
  if (m.naming !== 'label') m.naming = 'iri';
  if (m.extraPrefixes === undefined) m.extraPrefixes = '';
  return m;
}
const addrOf = m => String(m.baseIri || '').replace(/[#/]$/, '');
function setAddress(m, addr){
  addr = String(addr).trim().replace(/[#/]+$/, '');
  m.baseIri = addr + m.sep;
  if (m.ontoSame) m.ontologyIri = addr;
}
const slugOf = t => String(t).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'onto';
const asciiPrefix = t => { const s = String(t).toLowerCase().replace(/[^a-z0-9]/g, ''); const m = s.match(/[a-z][a-z0-9]*/); return m ? m[0].slice(0, 16) : ''; };
const PREFIX_OK = /^[A-Za-z][\w\-]*$/;
function extraList(m){
  return String(m.extraPrefixes || '').split(/\n/).map(l => l.trim().match(/^@?(?:prefix\s+)?([A-Za-z][\w\-]*)?\s*:\s*<?\s*(\S+?)\s*>?\s*\.?$/i)).filter(Boolean).map(x => ({ p: x[1] || '', iri: x[2] }));
}
const setExtraList = (m, list) => { m.extraPrefixes = list.map(x => `${x.p}: ${x.iri}`).join('\n'); };
const langName = l => (LANGS.find(x => x[0] === l) || [l, l ? `@${l}` : '표시 안 함'])[1];
const bookIcon = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2f6fec" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h6"/></svg>';

function cardHead(m){
  return `<div class="ohead">
    ${bookIcon}
    <div class="otitle"><b id="oHT">${esc(m.title || '이름 없는 온톨로지')}</b><span class="mono" id="oHS">${esc((m.prefix || '') + ': · ' + m.baseIri)}</span></div>
    <span class="chip" id="oHL">${esc(langName(m.lang) === '표시 안 함' ? '언어 태그 없음' : langName(m.lang) + ' 라벨')}</span>
    <button class="btn osetbtn${ui.card === 'open' ? ' on' : ''}" id="oSet" aria-expanded="${ui.card === 'open'}">설정 ${ui.card === 'open' ? '▴' : '▾'}</button>
    <button class="x ocollapse" id="oCollapse" aria-label="카드 접기" title="접기">«</button>
  </div>`;
}
function cardBody(m){
  const extras = extraList(m);
  const nLocal = state.nodes.filter(n => !isExternal(n.name)).length + new Set(state.edges.filter(e => e.kind === 'object').map(e => e.name)).size;
  const sepRadio = (v, title, ex) => `<label class="oradio${m.sep === v ? ' on' : ''}"><input type="radio" name="oSep" value="${v}"${m.sep === v ? ' checked' : ''}><span><span class="mono">${v}</span> ${title}<br><span class="mono hint">${esc(addrOf(m) + v)}사람</span></span></label>`;
  return `<div class="obody">
    <div class="field"><label for="oTitle">이름</label><input type="text" id="oTitle" value="${esc(m.title)}"></div>
    <div class="field"><label for="oAddr">주소 (IRI)</label>
      <div class="orow"><input type="text" id="oAddr" class="mono" value="${esc(addrOf(m))}">
        <button class="ochip${m.iriAuto ? ' on' : ''}" id="oAuto" title="${m.iriAuto ? '직접 고치면 고정됩니다' : '누르면 이름을 따라 주소가 바뀝니다'}">${m.iriAuto ? '이름 따라감' : '직접 지정 · 따라가게'}</button></div>
      <div class="hint" id="oAddrHint">${m.iriAuto ? '실제로 공개할 주소가 있으면 바꾸세요. 직접 고치면 그때부터 고정됩니다.' : '이름을 바꿔도 주소는 그대로입니다.'}${nLocal ? ` 주소를 바꾸면 이 온톨로지 안의 IRI ${nLocal}개가 함께 바뀝니다.` : ''}</div></div>
    <div class="field"><label>라벨 언어</label><div class="seg" id="oLangSeg">${LANGS.map(([v, t]) => `<button data-lang="${v}" class="${m.lang === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${LANGS.some(x => x[0] === m.lang) ? '' : `<div class="hint">지금 언어 태그: <span class="mono">@${esc(m.lang)}</span> (고급 설정에서 바꿀 수 있음)</div>`}</div>
    <div class="field"><label>이름 정하는 방식</label><div class="seg" id="oNaming"><button data-naming="iri" class="${m.naming === 'label' ? '' : 'on'}">IRI 먼저, 라벨 따로</button><button data-naming="label" class="${m.naming === 'label' ? 'on' : ''}">라벨에서 IRI 만들기</button></div>
      <div class="hint">${m.naming === 'label' ? '라벨을 적으면 IRI가 따라 만들어집니다. 한국어 라벨이면 IRI도 한국어가 됩니다.' : '새 항목은 Class1 같은 IRI 이름으로 만들어지고, 라벨(예: 한국어 이름)은 따로 적습니다.'}</div></div>
    <div class="oprev" id="oPrev"></div>
    <div class="field"><label>외부 온톨로지</label>
      <div class="otags">${extras.map((x, i) => `<span class="tag"><span class="mono">${esc(x.p)}:</span>&nbsp;${esc((PRESETS.find(p => p.iri === x.iri) || {}).name || x.iri)}<button data-rmx="${i}" aria-label="${esc(x.p)} 제거">×</button></span>`).join('')}
        <button class="btn" id="oImpBtn">${ui.imports ? '목록 닫기' : '+ 추가'}</button></div>
      ${ui.imports ? `<div class="oimp">
        ${PRESETS.map(p => { const on = extras.some(x => x.iri === p.iri); return `<label class="oimprow${on ? ' on' : ''}"><input type="checkbox" data-preset="${p.p}"${on ? ' checked' : ''}><span><b>${esc(p.name)}</b> <span class="mono chip">${p.p}:</span><br><span class="mono hint">${esc(p.iri)}</span></span></label>`; }).join('')}
        <div class="hint" style="margin:8px 0 4px">목록에 없으면 직접 추가</div>
        <div class="orow"><input type="text" id="oNewP" class="mono" placeholder="접두어" style="width:90px;flex:none"><input type="text" id="oNewI" class="mono" placeholder="https://…"><button class="btn" id="oNewAdd">추가</button></div>
        <div class="warn" id="oNewWarn" hidden></div>
      </div>` : `<div class="hint">추가한 온톨로지의 용어는 이름 칸의 ▾ 목록에서 불러와 라벨로 찾을 수 있습니다. 외부 클래스는 점선 테두리로 보입니다.</div>`}
    </div>
    <button class="olink" id="oAdvBtn" aria-expanded="${ui.adv}">${ui.adv ? '▾' : '▸'} 고급 설정 <span class="hint">(접두어, 구분 기호, 온톨로지 IRI, 언어 태그)</span></button>
    ${ui.adv ? `<div class="oadv">
      <div class="field"><label for="oPfx">접두어${m.prefixAuto ? ' <span class="ochip on" style="cursor:default">이름 따라감</span>' : ''}</label><input type="text" id="oPfx" class="mono" value="${esc(m.prefix)}" style="width:170px">
        <div class="hint">TTL에서 긴 주소 대신 쓰는 짧은 이름입니다. 예: <span class="mono" id="oPfxEx">${esc(m.prefix)}:사람</span></div><div class="warn" id="oPfxWarn" hidden></div></div>
      <div class="field"><label>주소와 이름 사이 구분 기호</label>
        ${sepRadio('#', '쓰기 <span class="hint">(작은 온톨로지에 흔함)</span>')}
        ${sepRadio('/', '쓰기 <span class="hint">(용어마다 웹 주소로 열어 볼 때)</span>')}</div>
      <div class="field"><label>온톨로지 IRI (owl:Ontology)</label>
        <label class="check"><input type="checkbox" id="oSame"${m.ontoSame ? ' checked' : ''}> 주소와 같게</label>
        <input type="text" id="oOnto" class="mono" value="${esc(m.ontologyIri)}"${m.ontoSame ? ' disabled' : ''} style="margin-top:6px"></div>
      <div class="field"><label for="oLang">언어 태그 직접 입력</label><input type="text" id="oLang" class="mono" value="${esc(m.lang)}" placeholder="비우면 태그 없음" style="width:120px"></div>
    </div>` : ''}
  </div>`;
}
function updatePreview(){
  const m = state.meta, el = $('#oPrev'); if (!el) return;
  const local = m.naming === 'label' ? '사람' : 'Person';
  el.innerHTML = `<div class="hint">이렇게 만들어집니다</div>
    <div>${m.naming === 'label' ? '클래스 “사람”' : 'IRI “Person”, 라벨 “사람”'} → <span class="mono" style="color:#1f4fb8">${esc(ttlTerm(local))}</span></div>
    <div class="mono hint">${esc(fullIri(local))} · rdfs:label ${esc(lit('사람'))}</div>`;
}
function updateCardHead(){
  const m = state.meta;
  const t = $('#oHT'); if (t) t.textContent = m.title || '이름 없는 온톨로지';
  const s = $('#oHS'); if (s) s.textContent = (m.prefix || '') + ': · ' + m.baseIri;
  const l = $('#oHL'); if (l) l.textContent = langName(m.lang) === '표시 안 함' ? '언어 태그 없음' : langName(m.lang) + ' 라벨';
  const mt = $('#oMiniT'); if (mt) mt.textContent = m.title || '이름 없는 온톨로지';
  const mp = $('#oMiniP'); if (mp) mp.textContent = (m.prefix || '') + ':';
}
function metaChanged(){ updateCardHead(); updatePreview(); renderCanvas(); if (selection) renderPanel(); persist(); }

function renderOntoCard(){
  const box = $('#ontoCard'); const m = ensureMeta(state.meta);
  const keepFocus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
  box.className = 'ocard ' + ui.card;
  $('#canvasWrap').classList.toggle('onto-open', ui.card === 'open');
  if (ui.card === 'mini'){
    box.innerHTML = `<button class="omini" id="oExpand" title="온톨로지 정보 펼치기" aria-label="온톨로지 카드 펼치기">${bookIcon}<b id="oMiniT">${esc(m.title || '이름 없는 온톨로지')}</b><span class="mono" id="oMiniP">${esc((m.prefix || '') + ':')}</span><span aria-hidden="true">»</span></button>`;
    $('#oExpand').onclick = () => { ui.card = 'card'; saveUi(); renderOntoCard(); };
    return;
  }
  box.innerHTML = cardHead(m) + (ui.card === 'open' ? cardBody(m) : '');
  $('#oSet').onclick = () => { ui.card = ui.card === 'open' ? 'card' : 'open'; if (ui.card !== 'open') ui.imports = false; renderOntoCard(); if (ui.card === 'open') { const t = $('#oTitle'); t && t.focus(); } };
  $('#oCollapse').onclick = () => { ui.card = 'mini'; ui.imports = false; saveUi(); renderOntoCard(); };
  if (ui.card !== 'open') return;
  updatePreview();
  const focusCk = el => el && el.addEventListener('focus', checkpoint);
  // 이름
  const t = $('#oTitle'); focusCk(t);
  t.addEventListener('input', () => {
    m.title = t.value;
    if (m.iriAuto){ setAddress(m, 'http://example.org/' + slugOf(m.title)); $('#oAddr').value = addrOf(m); }
    if (m.prefixAuto){ const p = asciiPrefix(m.title); if (p && !(p in STD)){ m.prefix = p; const pf = $('#oPfx'); if (pf) pf.value = p; } }
    metaChanged();
  });
  // 주소
  const a = $('#oAddr'); focusCk(a);
  a.addEventListener('input', () => {
    setAddress(m, a.value);
    if (m.iriAuto){ m.iriAuto = false; const c = $('#oAuto'); c.classList.remove('on'); c.textContent = '직접 지정 · 따라가게'; $('#oAddrHint').textContent = '이름을 바꿔도 주소는 그대로입니다.'; }
    const o = $('#oOnto'); if (o) o.value = m.ontologyIri;
    metaChanged();
  });
  $('#oAuto').onclick = () => {
    checkpoint(); m.iriAuto = !m.iriAuto;
    if (m.iriAuto){ setAddress(m, 'http://example.org/' + slugOf(m.title)); m.prefixAuto = true; const p = asciiPrefix(m.title); if (p && !(p in STD)) m.prefix = p; }
    renderOntoCard(); metaChanged();
  };
  // 언어
  $('#oLangSeg').querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { checkpoint(); m.lang = b.dataset.lang; renderOntoCard(); metaChanged(); });
  $('#oNaming').querySelectorAll('[data-naming]').forEach(b => b.onclick = () => { if (m.naming === b.dataset.naming) return; checkpoint(); m.naming = b.dataset.naming; renderOntoCard(); renderPanel(); persist(); });
  // 외부 온톨로지
  $('#oImpBtn').onclick = () => { ui.imports = !ui.imports; renderOntoCard(); };
  $('#ontoCard').querySelectorAll('[data-rmx]').forEach(b => b.onclick = () => { checkpoint(); const l = extraList(m); l.splice(+b.dataset.rmx, 1); setExtraList(m, l); renderOntoCard(); metaChanged(); });
  $('#ontoCard').querySelectorAll('[data-preset]').forEach(cb => cb.onchange = () => {
    checkpoint(); const pr = PRESETS.find(p => p.p === cb.dataset.preset); let l = extraList(m);
    if (cb.checked){ if (!l.some(x => x.iri === pr.iri)){ let p = pr.p; while (l.some(x => x.p === p) || p === m.prefix) p += '2'; l.push({ p, iri: pr.iri }); } }
    else l = l.filter(x => x.iri !== pr.iri);
    setExtraList(m, l); renderOntoCard(); metaChanged();
  });
  const addBtn = $('#oNewAdd');
  if (addBtn) addBtn.onclick = () => {
    const p = $('#oNewP').value.trim().replace(/:$/, ''), iri = $('#oNewI').value.trim(), w = $('#oNewWarn');
    const l = extraList(m);
    const err = !PREFIX_OK.test(p) ? '접두어는 영문자로 시작하고 영문·숫자·_·-만 쓸 수 있습니다.'
      : (p in STD || p === m.prefix || l.some(x => x.p === p)) ? `"${p}"는 이미 쓰고 있는 접두어입니다.`
      : !/^(https?:\/\/|urn:)\S+[#/:]$/.test(iri) ? '주소는 http(s)://로 시작하고 # 또는 / 로 끝나야 합니다.' : '';
    if (err){ w.textContent = err; w.hidden = false; return; }
    checkpoint(); l.push({ p, iri }); setExtraList(m, l); renderOntoCard(); metaChanged();
  };
  // 고급
  $('#oAdvBtn').onclick = () => { ui.adv = !ui.adv; saveUi(); renderOntoCard(); };
  const pf = $('#oPfx');
  if (pf){
    focusCk(pf);
    pf.addEventListener('input', () => {
      const v = pf.value.trim(), w = $('#oPfxWarn');
      const err = v === '' ? '' : !PREFIX_OK.test(v) ? '영문자로 시작하고 영문·숫자·_·-만 쓸 수 있습니다.' : (v in STD || extraList(m).some(x => x.p === v)) ? `"${v}"는 다른 곳에서 쓰는 접두어입니다.` : '';
      w.textContent = err; w.hidden = !err;
      if (err) return;
      m.prefix = v; m.prefixAuto = false; $('#oPfxEx').textContent = v + ':사람'; metaChanged();
    });
    $('#ontoCard').querySelectorAll('input[name=oSep]').forEach(r => r.onchange = () => { checkpoint(); const addr = addrOf(m); m.sep = r.value; setAddress(m, addr); renderOntoCard(); metaChanged(); });
    const same = $('#oSame');
    same.onchange = () => { checkpoint(); m.ontoSame = same.checked; if (m.ontoSame) m.ontologyIri = addrOf(m); renderOntoCard(); metaChanged(); };
    const oo = $('#oOnto'); focusCk(oo); oo.addEventListener('input', () => { m.ontologyIri = oo.value.trim(); metaChanged(); });
    const ol = $('#oLang'); focusCk(ol); ol.addEventListener('input', () => { const v = ol.value.trim(); if (v === '' || /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(v)){ m.lang = v; $('#oLangSeg').querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === v)); metaChanged(); } });
  }
  if (keepFocus){ const f = document.getElementById(keepFocus); if (f) f.focus(); }
}
function openOntoSettings(focusTitle){
  ui.card = 'open'; renderOntoCard();
  if (focusTitle){ const t = $('#oTitle'); if (t){ t.focus(); t.select(); } }
}

/* ---------- 선택 없을 때 패널 ---------- */
function emptyPanel(p){
  p.innerHTML = `<h3>선택한 항목 없음</h3>
    <div class="hint" style="font-size:13px;line-height:1.6">캔버스에서 클래스·개체·관계를 누르면 여기에서 편집합니다.<br>온톨로지 이름과 주소는 캔버스 왼쪽 위 카드에서 바꿉니다.</div>
    <h4>현황</h4>
    <div class="hint">TBox: 클래스 ${state.nodes.filter(n => !isIndiv(n)).length}개 · 관계 ${state.edges.filter(e => e.kind === 'object' && edgeShape(e) === 'CC').length}개 · 상속 ${state.edges.filter(e => e.kind === 'subclass').length}개<br>
      ABox: 개체 ${state.nodes.filter(isIndiv).length}개 · 타입 지정 ${state.edges.filter(e => e.kind === 'type').length}개 · 개체 관계 ${state.edges.filter(e => edgeShape(e) === 'II').length}개</div>
    <h4>빠른 사용법</h4>
    <div class="help"><b>추가</b> 빈 곳 더블클릭 (<kbd>Shift</kbd>를 누르면 반대 종류)<br><b>연결</b> 노드 테두리를 끌어 다른 노드에 놓기<br><b>삭제</b> <kbd>Delete</kbd> · <b>되돌리기</b> <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd><br>전체 사용법은 위쪽 <b>?</b> 버튼</div>`;
}
const HELP_HTML = `<b>클래스 추가</b> 빈 곳 더블클릭<br>
  <b>개체 추가</b> 위쪽 "추가"를 개체로 바꾸고 더블클릭, 또는 <kbd>Shift</kbd>+더블클릭<br>
  <b>관계 연결</b> 노드 테두리(파란 띠)를 끌어 다른 노드에 놓기. 빈 곳에 놓으면 같은 종류의 노드가 함께 생김<br>
  <b>개체 → 클래스</b> 연결하면 타입 지정(rdf:type)<br>
  <b>개체 → 개체</b> 연결하면 속성 값. 두 개체의 클래스 사이에 관계가 있으면 그 이름이 자동으로 들어감<br>
  <b>상속</b> 클래스 사이 관계를 선택하고 유형을 subClassOf로 변경<br>
  <b>이동</b> 노드 끌기 · <b>화면 이동</b> 빈 곳 끌기 또는 스크롤<br>
  <b>확대/축소</b> <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+스크롤 또는 트랙패드 핀치<br>
  <b>삭제</b> <kbd>Delete</kbd> / <kbd>Backspace</kbd> · <b>되돌리기</b> <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd><br>
  <b>온톨로지 설정</b> 캔버스 왼쪽 위 카드의 "설정". «로 접으면 작은 칩만 남습니다<br>
  <b>검사</b> 추론·데이터 검사·OOPS! 점검<br>
  작업 내용은 이 브라우저에 자동 저장됩니다. 공유하거나 보관하려면 TTL로 내려받으세요.`;
