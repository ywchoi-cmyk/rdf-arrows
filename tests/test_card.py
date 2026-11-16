import subprocess, sys, time, os, json
from playwright.sync_api import sync_playwright
import rdflib

ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
OWL = rdflib.OWL; RDF = rdflib.RDF; RDFS = rdflib.RDFS
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8771/index.html"); page.wait_for_timeout(400)
        page.evaluate("window.__rdfArrows.state.meta.naming = 'label'")
        ttl = lambda: page.evaluate("window.__rdfArrows.toTurtle()")
        meta = lambda: page.evaluate("window.__rdfArrows.state.meta")
        svg = page.locator("#canvas").bounding_box()

        # 1. 처음: 요약 카드
        assert page.is_visible("#ontoCard .ohead") and not page.is_visible("#oTitle")
        assert "새 온톨로지" in page.inner_text("#oHT")
        # 2. 설정 열고 이름 바꾸면 주소·접두어가 따라감
        page.click("#oSet"); assert page.is_visible("#oTitle")
        page.fill("#oTitle", "ontoops")
        m = meta(); print("after title:", m["baseIri"], m["prefix"], m["ontologyIri"])
        assert m["baseIri"] == "http://example.org/ontoops#" and m["prefix"] == "ontoops" and m["ontologyIri"] == "http://example.org/ontoops"
        assert page.input_value("#oAddr") == "http://example.org/ontoops"
        assert "ontoops: · http://example.org/ontoops#" in page.inner_text("#oHS")
        assert "ontoops:사람" in page.inner_text("#oPrev")
        page.screenshot(path=os.path.join(OUT, "card_open.png"))
        # 빈 곳 클릭 → 설정 닫힘
        page.mouse.click(svg["x"] + 700, svg["y"] + 650)
        assert not page.is_visible("#oTitle") and page.is_visible("#oSet")
        # 3. 클래스 만들고 TTL 확인
        page.mouse.dblclick(svg["x"] + 650, svg["y"] + 420)
        page.keyboard.type("사람")
        t = ttl()
        assert "@prefix ontoops: <http://example.org/ontoops#> ." in t and "ontoops:사람 a owl:Class" in t and "<http://example.org/ontoops> a owl:Ontology" in t
        # 4. 라벨 언어
        page.click("#oSet"); page.click("#oLangSeg [data-lang=en]")
        assert '"사람"@en' in ttl()
        page.click("#oLangSeg [data-lang='']")
        assert 'rdfs:label "사람" .' in ttl(), ttl()
        page.click("#oLangSeg [data-lang=ko]")
        # 5. 주소 직접 지정 → 고정
        page.fill("#oAddr", "https://w3id.org/ontoops")
        assert meta()["iriAuto"] is False and "직접 지정" in page.inner_text("#oAuto")
        page.fill("#oTitle", "OntoOps 교리")
        m = meta(); assert m["baseIri"] == "https://w3id.org/ontoops#", m["baseIri"]
        # 따라가게 다시 켜기
        page.click("#oAuto")
        m = meta(); print("auto again:", m["baseIri"], m["prefix"])
        assert m["iriAuto"] is True and m["baseIri"].startswith("http://example.org/ontoops-") and m["prefix"] == "ontoops"
        # 6. 고급: 구분 기호, 온톨로지 IRI 따로
        page.click("#oAdvBtn")
        page.fill("#oAddr", "https://w3id.org/ontoops")
        page.click("label.oradio:has(input[value='/'])")
        m = meta(); assert m["baseIri"] == "https://w3id.org/ontoops/" and m["ontologyIri"] == "https://w3id.org/ontoops", m
        assert "@prefix ontoops: <https://w3id.org/ontoops/> ." in ttl()
        page.uncheck("#oSame"); page.fill("#oOnto", "https://w3id.org/ontoops/ontology")
        assert "<https://w3id.org/ontoops/ontology> a owl:Ontology" in ttl()
        page.check("#oSame"); assert meta()["ontologyIri"] == "https://w3id.org/ontoops"
        # 7. 접두어 검증
        page.fill("#oPfx", "1abc")
        assert page.is_visible("#oPfxWarn") and meta()["prefix"] == "ontoops"
        page.fill("#oPfx", "owl"); assert page.is_visible("#oPfxWarn")
        page.fill("#oPfx", "oo"); assert not page.is_visible("#oPfxWarn") and "oo:사람 a owl:Class" in ttl()
        # 8. 외부 온톨로지
        page.click("#oImpBtn"); page.check("[data-preset=schema]")
        assert "@prefix schema: <https://schema.org/> ." in ttl()
        page.check("[data-preset=skos]")
        page.fill("#oNewP", "mil"); page.fill("#oNewI", "example.mil/ont"); page.click("#oNewAdd")
        assert page.is_visible("#oNewWarn"), "bad iri should warn"
        page.fill("#oNewI", "https://example.mil/ont#"); page.click("#oNewAdd")
        assert "@prefix mil: <https://example.mil/ont#> ." in ttl()
        page.uncheck("[data-preset=skos]")
        assert "skos:" not in ttl().split("@prefix rdf")[0]
        assert "https://w3id.org/ontoops/사람" in page.inner_text("#panel"), "node panel IRI should follow base"
        tags = page.inner_text(".otags"); print("tags:", tags.replace("\n", " "))
        page.screenshot(path=os.path.join(OUT, "card_adv.png"))
        page.click("[data-rmx='1']")  # mil 제거 (cco, mil 순)
        assert "mil:" not in ttl()
        # 외부 클래스 이름 쓰기 → 점선
        page.keyboard.press("Escape")
        page.mouse.dblclick(svg["x"] + 850, svg["y"] + 420)
        page.fill("[data-f=name]", "schema:Person")
        assert page.locator(".node.external").count() == 1
        g = rdflib.Graph().parse(data=ttl(), format="turtle")
        assert (rdflib.URIRef("https://schema.org/Person"), RDF.type, OWL.Class) in g
        # 9. 실행 취소: 이름 변경 되돌리기
        page.mouse.click(svg["x"] + 700, svg["y"] + 700)
        page.click("#oSet"); before = meta()["title"]
        page.fill("#oTitle", "바뀐 이름"); page.locator("#oTitle").blur()
        page.mouse.click(svg["x"] + 700, svg["y"] + 700)
        page.keyboard.press("Control+z")
        assert meta()["title"] == before and before in page.inner_text("#oHT"), (meta()["title"], before)
        # 10. 접기 → 새로고침해도 유지 → 펼치기
        page.click("#oCollapse")
        assert page.is_visible("#oExpand") and not page.is_visible("#oSet")
        page.screenshot(path=os.path.join(OUT, "card_mini.png"))
        page.reload(); page.wait_for_timeout(400)
        assert page.is_visible("#oExpand"), "mini state should persist"
        page.click("#oExpand"); assert page.is_visible("#oSet")
        # 11. 예전 저장 형식 호환
        page.evaluate("""() => { localStorage.setItem('rdf-arrows:v1', JSON.stringify({ state: { meta: { title: 'old', ontologyIri: 'http://x.org/o', baseIri: 'http://x.org/o#', prefix: 'x', lang: 'ko', extraPrefixes: 'cco: https://www.commoncoreontologies.org/' }, nodes: [], edges: [], seq: 1 } })); }""")
        page.reload(); page.wait_for_timeout(400)
        m = meta(); assert m["iriAuto"] is False and m["sep"] == "#" and m["ontoSame"] is True, m
        page.click("#oSet"); assert page.input_value("#oAddr") == "http://x.org/o" and "cco:" in page.inner_text(".otags")
        page.fill("#oTitle", "renamed"); assert meta()["baseIri"] == "http://x.org/o#", "old file must not auto-change address"
        # 12. 새로 만들기 → 설정 열리고 이름 칸 선택됨
        page.mouse.click(svg["x"] + 700, svg["y"] + 700)
        page.click("#bNew")
        assert page.is_visible("#oTitle") and page.evaluate("document.activeElement.id") == "oTitle"
        # 13. 도움말
        page.click("#bHelp"); assert page.is_visible("#helpModal") and "온톨로지 설정" in page.inner_text("#helpBody")
        page.keyboard.press("Escape"); assert not page.is_visible("#helpModal")
        # 14. 선택 없음 패널
        assert "선택한 항목 없음" in page.inner_text("#panel")
        # 15. TTL 불러오면 카드에 반영
        page.set_input_files("#fileIn", files=[{"name": "x.ttl", "mimeType": "text/turtle", "buffer": b"@prefix ab: <http://ab.org/k/> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . <http://ab.org/k> a owl:Ontology ; rdfs:label \"\xec\x97\x90\xec\x9d\xb4\xeb\xb9\x84\"@ko . ab:A a owl:Class ."}])
        page.wait_for_timeout(300)
        m = meta(); print("imported meta:", {k: m[k] for k in ['title', 'baseIri', 'prefix', 'sep', 'iriAuto', 'ontoSame']})
        assert m["sep"] == "/" and m["prefix"] == "ab" and m["iriAuto"] is False and m["ontoSame"] is True
        assert "에이비" in page.inner_text("#oHT")
        browser.close()
finally:
    srv.terminate()
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
