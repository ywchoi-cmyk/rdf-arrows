/* RDF Arrows · 파일 열기·내려받기, 끌어다 놓기, TTL 미리보기 창 */
'use strict';

/* ---------- 파일 ---------- */
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
function fileName(){ return (deriveName(state.meta.title || 'ontology', 'prop') || 'ontology') + '.ttl'; }
function download(){
  const blob = new Blob([toTurtle()], { type: 'text/turtle;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName();
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function loadText(text, name){
  try {
    const st = importTurtle(text);
    ensureMeta(st.meta);
    checkpoint(); state = st; selection = null; renderAll(); fit(); persist();
    toast(`${name || 'TTL'} 불러옴: 클래스 ${st.nodes.filter(n => n.kind !== 'individual').length}개, 개체 ${st.nodes.filter(n => n.kind === 'individual').length}개, 연결 ${st.edges.length}개`);
  } catch (e){ toast('불러오기 실패: ' + (e.message || e)); console.error(e); }
}
$('#fileIn').addEventListener('change', ev => {
  const f = ev.target.files[0]; if (!f) return;
  f.text().then(t => loadText(t, f.name)); ev.target.value = '';
});
const wrap = $('#canvasWrap');
wrap.addEventListener('dragover', ev => { ev.preventDefault(); $('#dropOverlay').classList.add('on'); });
wrap.addEventListener('dragleave', ev => { if (ev.target === wrap || !wrap.contains(ev.relatedTarget)) $('#dropOverlay').classList.remove('on'); });
wrap.addEventListener('drop', ev => {
  ev.preventDefault(); $('#dropOverlay').classList.remove('on');
  const f = ev.dataTransfer.files[0]; if (f) f.text().then(t => loadText(t, f.name));
});

/* ---------- 모달 ---------- */
function openModal(){
  const ttl = toTurtle();
  $('#ttlOut').value = ttl;
  const st = $('#ttlStatus');
  let parsed = null, err = null;
  try { parsed = new N3.Parser().parse(ttl); } catch (e){ err = e; }
  const probs = problems();
  st.innerHTML = (err ? `<span class="bad">문법 오류: ${esc(err.message)}</span>` : `<span class="ok">✓ Turtle 문법 검사 통과 (트리플 ${parsed.length}개)</span>`) +
    (probs.length ? '<br>' + probs.map(p => `<span class="bad">⚠ ${esc(p)}</span>`).join('<br>') : '');
  $('#modal').hidden = false;
}
function closeModal(){ $('#modal').hidden = true; }
$('#bView').onclick = openModal;
$('#mClose').onclick = closeModal;
$('#modal').addEventListener('click', ev => { if (ev.target.id === 'modal') closeModal(); });
$('#mCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#ttlOut').value); toast('복사했습니다'); }
  catch (e){ $('#ttlOut').select(); toast('전체 선택했습니다. Ctrl/⌘+C로 복사하세요'); }
};
$('#mDownload').onclick = download;
$('#bDownload').onclick = download;
