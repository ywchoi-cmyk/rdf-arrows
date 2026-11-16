import subprocess, sys, time, os, json, re
from playwright.sync_api import sync_playwright

ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8778", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SCHEMA = """@prefix schema: <https://schema.org/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
schema:Person a rdfs:Class ; rdfs:label "Person" ; rdfs:comment "A person (alive, dead, undead, or fictional)." .
schema:Organization a rdfs:Class ; rdfs:label "Organization" .
schema:knows a rdf:Property ; rdfs:label "knows" .
schema:name a rdf:Property ; rdfs:label "name" .
"""
SKOS = """<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#" xml:base="http://www.w3.org/2004/02/skos/core">
  <owl:Class rdf:about="#Concept"><rdfs:label xml:lang="en">Concept</rdfs:label></owl:Class>
  <rdf:Description rdf:about="#broader"><rdf:type rdf:resource="http://www.w3.org/2002/07/owl#ObjectProperty"/><rdfs:label xml:lang="en">has broader</rdfs:label></rdf:Description>
</rdf:RDF>"""
FOAF = """<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#">
  <rdfs:Class rdf:about="http://xmlns.com/foaf/0.1/Agent"><rdfs:label>Agent</rdfs:label></rdfs:Class>
  <rdfs:Class rdf:about="http://xmlns.com/foaf/0.1/Person"><rdfs:label>Person</rdfs:label></rdfs:Class>
</rdf:RDF>"""
calls = {}
pending = []
def handler(route, request):
    u = request.url; calls[u] = calls.get(u, 0) + 1
    h = {"Access-Control-Allow-Origin": "*"}
    if "schema.org" in u: route.fulfill(status=200, headers={**h, "Content-Type": "text/turtle"}, body=SCHEMA)
    elif "skos" in u: route.fulfill(status=200, headers={**h, "Content-Type": "application/rdf+xml"}, body=SKOS)
    elif "dublincore" in u: route.fulfill(status=500, headers=h, body="oops")
    elif "w3.org/2006/time" in u: pending.append(route)   # 응답하지 않음 → 취소 시험
    else: route.abort()
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        for pat in ["https://schema.org/**", "https://www.w3.org/**", "https://www.dublincore.org/**"]:
            page.route(pat, handler)
        page.goto("http://127.0.0.1:8778/index.html"); page.wait_for_timeout(400)
        svg = page.locator("#canvas").bounding_box()
        S = lambda: page.evaluate("window.__rdfArrows.state")
        # 외부 온톨로지 등록 (CCO는 목록에 없어야 함)
        page.click("#oSet"); page.click("#oImpBtn")
        assert page.locator("[data-preset=cco]").count() == 0
        for pr in ["schema", "skos", "foaf", "time", "dcterms"]: page.check(f"[data-preset={pr}]")
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        # 클래스 만들고 이름 칸 ▾
        page.mouse.dblclick(svg["x"] + 600, svg["y"] + 300)
        page.click("#panel .combo-btn")
        menu = lambda: page.inner_text("#panel .combo-menu")
        m = menu(); print("menu:\n" + m)
        assert "외부 온톨로지" in m and "schema.org" in m and "불러오기" in m and "파일로 추가" in m and "받는 곳 열기" in m
        # schema.org 불러오기
        page.locator(".combo-src", has_text="schema.org").locator("button[data-act=load]").click()
        page.wait_for_function("() => document.querySelector('#panel .combo-menu').innerText.includes('용어 4개')", timeout=5000)
        # 검색해서 끌어오기
        page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("pers")
        assert "외부에서 찾음" in menu() and "Person" in menu()
        page.locator("#panel .combo-item", has_text="schema:Person").click()
        n = S()["nodes"][0]
        assert n["name"] == "schema:Person" and n["label"] == "", n
        assert any(t["iri"] == "https://schema.org/Person" for t in S()["meta"]["imports"])
        assert page.locator("#nodes .node").nth(0).locator(".title").text_content() == "Person"
        assert page.locator(".node.external").count() == 1
        # SKOS (RDF/XML 모듈을 필요할 때 불러옴)
        assert not page.evaluate("!!window.RdfXml")
        page.mouse.dblclick(svg["x"] + 900, svg["y"] + 300)
        page.click("#panel .combo-btn")
        assert "가져온 외부 용어" in menu() and "schema:Person" in menu(), menu()
        page.locator(".combo-src", has_text="SKOS").locator("button[data-act=load]").click()
        page.wait_for_function("() => document.querySelector('#panel .combo-menu').innerText.includes('용어 2개')", timeout=8000)
        assert page.evaluate("!!window.RdfXml")
        page.keyboard.press("Escape")
        # 관계 이름에서 skos:broader 찾기
        b0 = page.locator("#nodes .node").nth(0).locator(".body").bounding_box(); b1 = page.locator("#nodes .node").nth(1).locator(".body").bounding_box()
        sx, sy = b0["x"] + b0["width"] + 5, b0["y"] + b0["height"] / 2
        page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx + 80, sy, steps=5); page.mouse.move(b1["x"] + 20, b1["y"] + 15, steps=8); page.mouse.up()
        page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("broad")
        page.locator("#panel .combo-item", has_text="skos:broader").click()
        e = S()["edges"][0]; assert e["name"] == "skos:broader", e
        assert "has broader" in page.locator("#edges").text_content()
        # 관계 칸에서는 클래스가 안 나와야 함
        page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("concept")
        assert "skos:Concept" not in menu()
        page.keyboard.press("Escape"); page.keyboard.press("Control+z")
        # FOAF: 파일로 추가
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        page.mouse.dblclick(svg["x"] + 600, svg["y"] + 520)
        page.click("#panel .combo-btn")
        with page.expect_file_chooser() as fc:
            page.locator(".combo-src", has_text="FOAF").locator("button[data-act=file]").click()
        fc.value.set_files(files=[{"name": "index.rdf", "mimeType": "application/rdf+xml", "buffer": FOAF.encode()}])
        page.wait_for_function("() => window.__rdfArrows && document.querySelector('#toast').innerText.includes('용어 2개')", timeout=5000)
        page.locator("[data-f=name]").click(); page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("agen")
        page.locator("#panel .combo-item", has_text="foaf:Agent").click()
        assert S()["nodes"][2]["name"] == "foaf:Agent"
        # 취소: 응답 없는 OWL-Time
        page.click("#panel .combo-btn")
        page.locator(".combo-src", has_text="OWL-Time").locator("button[data-act=load]").click()
        page.wait_for_function("() => document.querySelector('#panel .combo-menu').innerText.includes('받는 중')", timeout=5000)
        page.locator(".combo-src", has_text="OWL-Time").locator("button[data-act=cancel]").click()
        page.wait_for_function("() => document.querySelector('.combo-src:nth-last-child(1), .combo-src') && [...document.querySelectorAll('.combo-src')].some(r => r.innerText.includes('OWL-Time') && r.innerText.includes('불러오기'))", timeout=5000)
        # 서버 오류
        page.locator(".combo-src", has_text="Dublin Core").locator("button[data-act=load]").click()
        page.wait_for_function("() => [...document.querySelectorAll('.combo-src')].some(r => r.innerText.includes('Dublin Core') && r.innerText.includes('서버 응답 500') && r.innerText.includes('다시 시도'))", timeout=5000)
        page.screenshot(path=os.path.join(OUT, "vocab_menu.png"))
        page.keyboard.press("Escape")
        # TTL 왕복: 가져온 외부 용어 유지
        ttl = page.evaluate("window.__rdfArrows.toTurtle()")
        lay = json.loads(re.search(r"rdf-arrows-layout: (\{.*\})", ttl).group(1))
        assert any(x[0] == "https://schema.org/Person" for x in lay["imports"]), lay.get("imports")
        assert "schema:Person a owl:Class" in ttl and '"Person"' not in ttl.split("# 아래 줄")[0], "external label must not be re-declared"
        page.set_input_files("#fileIn", files=[{"name": "r.ttl", "mimeType": "text/turtle", "buffer": ttl.encode()}])
        page.wait_for_timeout(300)
        assert any(t["iri"] == "https://schema.org/Person" for t in S()["meta"]["imports"])
        assert "Person" in page.locator("#nodes").text_content()
        # 새로고침해도 불러온 용어는 이 브라우저에 저장 → 다시 받지 않음
        before = calls.get("https://schema.org/version/latest/schemaorg-current-https.ttl", 0)
        page.reload(); page.wait_for_timeout(600)
        nid = S()["nodes"][1]["id"]
        bx = page.locator(f"[data-node='{nid}'] .body").bounding_box(); page.mouse.click(bx["x"] + 10, bx["y"] + 8)
        page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("organ")
        assert "schema:Organization" in menu(), menu()
        assert calls.get("https://schema.org/version/latest/schemaorg-current-https.ttl", 0) == before
        page.keyboard.press("Escape")
        # 이어서 만들기
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        n0 = S()["nodes"][0]["id"]
        bx = page.locator(f"[data-node='{n0}'] .body").bounding_box(); page.mouse.click(bx["x"] + 10, bx["y"] + 8)
        cnt = len(S()["nodes"])
        page.click("#mkSub")
        st = S(); c = st["nodes"][-1]
        assert len(st["nodes"]) == cnt + 1 and any(e["from"] == c["id"] and e["to"] == n0 and e["kind"] == "subclass" for e in st["edges"])
        assert page.evaluate("document.activeElement.dataset.f") == "name"
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        bx = page.locator(f"[data-node='{n0}'] .body").bounding_box(); page.mouse.click(bx["x"] + 10, bx["y"] + 8)
        page.click("#mkInd")
        st = S(); i = st["nodes"][-1]
        assert i["kind"] == "individual" and any(e["from"] == i["id"] and e["to"] == n0 and e["kind"] == "type" for e in st["edges"])
        xs = [(n["x"], n["y"]) for n in st["nodes"]]; assert len(set(xs)) == len(xs), "new nodes must not overlap"
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        page.screenshot(path=os.path.join(OUT, "vocab_canvas.png"))
        for r in pending:
            try: r.abort()
            except Exception: pass
        browser.close()
finally:
    srv.terminate()
errors = [e for e in errors if "Failed to load resource" not in e]
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
