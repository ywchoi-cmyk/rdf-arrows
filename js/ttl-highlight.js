/* ---------- Turtle 색 입히기 (TTL 보기 창 전용) ---------- */
const PN_PREFIX = String.raw`(?:\p{L}(?:[\p{L}\p{N}_\-]|\.(?=[\p{L}\p{N}_\-]))*)?`;
const PN_LOCAL = String.raw`(?:[\p{L}\p{N}_:%\-]|\\.|\.(?=[\p{L}\p{N}_:%\-]))*`;
const TTL_TOKEN = new RegExp([
  String.raw`(?<ws>\s+)`,
  String.raw`(?<com>#[^\n]*)`,
  String.raw`(?<lstr>"""[\s\S]*?"""|'''[\s\S]*?''')`,
  String.raw`(?<str>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`,
  String.raw`(?<iri><[^>\s]*>)`,
  String.raw`(?<dir>@prefix\b|@base\b|PREFIX\b|BASE\b)`,
  String.raw`(?<lang>@[A-Za-z]+(?:-[A-Za-z0-9]+)*)`,
  String.raw`(?<dt>\^\^)`,
  String.raw`(?<bnode>_:[\p{L}\p{N}_\-]+)`,
  String.raw`(?<pn>${PN_PREFIX}:${PN_LOCAL})`,
  String.raw`(?<num>[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)`,
  String.raw`(?<kw>\ba\b|\btrue\b|\bfalse\b)`,
  String.raw`(?<punc>[.;,\[\]()])`,
  String.raw`(?<other>.)`,
].join('|'), 'guy');

/** Turtle 문자열 → 줄 단위 HTML. 주어 자리에서 캔버스 노드와 같은 이름이면 그 노드 색 칩으로 감싼다 */
function highlightTurtle(ttl, chipFor = () => null){
  const toks = [];
  let role = 's', inDir = false, afterDt = false;
  const stack = [];
  TTL_TOKEN.lastIndex = 0;
  for (let m; (m = TTL_TOKEN.exec(ttl)); ){
    const g = m.groups, text = m[0];
    const kind = Object.keys(g).find(k => g[k] !== undefined);
    let cls = 't-' + kind, style = '';
    if (kind === 'com'){
      if (/^#{8,}\s*$/.test(text) || /^#\s{2,}\S/.test(text)) cls = 't-sec';
      else if (text.includes('rdf-arrows-layout')) cls = 't-meta';
    } else if (kind === 'dir'){ inDir = true; }
    else if (kind === 'punc'){
      if (text === '.'){ role = 's'; inDir = false; }
      else if (text === ';') role = 'p';
      else if (text === ',') role = 'o';
      else if (text === '['){ stack.push(role); role = 'p'; }
      else if (text === ']'){ stack.pop(); role = 'o'; }
    } else if (kind === 'iri' || kind === 'pn' || kind === 'bnode' || kind === 'kw'){
      if (inDir){ cls = kind === 'pn' ? 't-pfx' : 't-iri'; }
      else if (afterDt){ cls = 't-dtype'; afterDt = false; }
      else if (kind === 'kw' && text === 'a' && role === 'p'){ cls = 't-a'; role = 'o'; }
      else if (kind === 'kw'){ cls = 't-num'; }
      else {
        cls += ' t-' + role;
        if (role === 's'){ const c = chipFor(text); if (c){ cls += ' t-chip'; style = `background:${c.fill};border-color:${c.stroke}`; } role = 'p'; }
        else if (role === 'p') role = 'o';
      }
    }
    if (kind !== 'ws' && cls !== 't-dtype') afterDt = kind === 'dt';
    if ((kind === 'str' || kind === 'lstr' || kind === 'num') && role === 's') role = 'p';
    toks.push([kind === 'ws' ? '' : cls, text, style]);
  }
  const lines = [[]];
  for (const [cls, text, style] of toks){
    text.split('\n').forEach((piece, i) => {
      if (i) lines.push([]);
      if (!piece) return;
      lines[lines.length - 1].push(cls ? `<span class="${cls}"${style ? ` style="${style}"` : ''}>${esc(piece)}</span>` : esc(piece));
    });
  }
  if (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines.map(l => `<span class="ln">${l.join('')}</span>`).join('');
}

/** 현재 캔버스의 노드 이름(Turtle 표기) → 색 */
function canvasChips(){
  const pm = prefixMap(), map = new Map();
  for (const n of state.nodes){ try { map.set(ttlTerm(n.name, pm), colorOf(n)); } catch (e){} }
  return t => map.get(t) || null;
}
