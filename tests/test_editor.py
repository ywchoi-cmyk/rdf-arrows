import subprocess, sys, time, json, os
from playwright.sync_api import sync_playwright
import rdflib
from rdflib.compare import isomorphic

ROOT = sys.argv[1]
OUT = sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--directory", ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 860})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:8765/index.html")
        page.wait_for_timeout(500)
        page.evaluate("window.__rdfArrows.state.meta.naming = 'label'")
        assert page.is_visible("#empty .card"), "empty hint should show"
        EMPTY_CHECK = True

        svg = page.locator("#canvas").bounding_box()
        def dbl(x, y): page.mouse.dblclick(svg["x"] + x, svg["y"] + y)

        # 1) 클래스 두 개
        dbl(300, 300)
        page.keyboard.type("사람")
        assert not page.is_visible("#empty .card"), "empty hint should hide"
        dbl(750, 300)
        page.keyboard.type("Military Unit")
        st = page.evaluate("window.__rdfArrows.state")
        assert len(st["nodes"]) == 2, st["nodes"]
        names = [n["name"] for n in st["nodes"]]
        print("names:", names)
        assert names == ["사람", "MilitaryUnit"], names

        # 2) 테두리 드래그로 관계
        def body_box(i):
            return page.locator("#nodes .node").nth(i).locator(".body").bounding_box()
        b0, b1 = body_box(0), body_box(1)
        sx, sy = b0["x"] + b0["width"] + 5, b0["y"] + b0["height"] / 2
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx + 100, sy, steps=5)
        page.mouse.move(b1["x"] + b1["width"] / 2, b1["y"] + b1["height"] / 2, steps=8)
        page.mouse.up()
        page.keyboard.type("belongs to")
        st = page.evaluate("window.__rdfArrows.state")
        assert len(st["edges"]) == 1 and st["edges"][0]["name"] == "belongsTo", st["edges"]

        # 3) 빈 곳으로 드래그 → 새 클래스 + 관계, subClassOf로 변경
        b1 = body_box(1)
        sx, sy = b1["x"] + b1["width"] / 2, b1["y"] - 5
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx, sy - 80, steps=5)
        page.mouse.move(sx, sy - 220, steps=5)
        page.mouse.up()
        page.click("[data-kind=subclass]")
        st = page.evaluate("window.__rdfArrows.state")
        assert len(st["nodes"]) == 3 and st["edges"][1]["kind"] == "subclass", st

        # 새 클래스 이름 바꾸기 + 데이터 속성
        top = page.locator("#nodes .node").nth(2).locator(".body").bounding_box()
        page.mouse.click(top["x"] + 20, top["y"] + 15)
        page.fill("[data-f=label]", "조직")
        page.click("#addAttr")
        page.keyboard.type("설립일")
        page.select_option("[data-ai='0'][data-af=type]", "xsd:date")

        # 4) 같은 이름 관계 두 번째 (domain union 확인): 조직 → 사람에도 belongsTo
        n0, n2 = body_box(0), body_box(2)
        sx, sy = n2["x"] - 5, n2["y"] + n2["height"] / 2
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx - 60, sy + 30, steps=5)
        page.mouse.move(n0["x"] + n0["width"] / 2, n0["y"] + n0["height"] / 2, steps=8)
        page.mouse.up()
        page.fill("[data-f=name]", "belongsTo")
        assert page.is_visible("#mergeInfo"), "merge info should show"


        # ---- ABox ----
        page.click("#mIndiv")
        dbl(300, 620)
        page.keyboard.type("홍길동")
        dbl(750, 620)
        page.keyboard.type("1대대")
        st = page.evaluate("window.__rdfArrows.state")
        kinds = [(n["label"], n.get("kind")) for n in st["nodes"]]
        print("kinds:", kinds)
        assert kinds[-2:] == [("홍길동", "individual"), ("1대대", "individual")], kinds
        def drag_node_to_node(i, j):
            a, b = body_box(i), body_box(j)
            sx, sy = a["x"] + a["width"] / 2, a["y"] - 5
            page.mouse.move(sx, sy); page.mouse.down()
            page.mouse.move(sx, sy - 60, steps=5)
            page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=10)
            page.mouse.up()
        drag_node_to_node(3, 0)   # 홍길동 → 사람 (type)
        drag_node_to_node(4, 1)   # 1대대 → MilitaryUnit (type)
        # 홍길동 → 1대대 : 사람→MilitaryUnit 사이 belongsTo가 자동 제안되어야 함
        a, b = body_box(3), body_box(4)
        sx, sy = a["x"] + a["width"] + 5, a["y"] + a["height"] / 2
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx + 80, sy, steps=5)
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=10)
        page.mouse.up()
        st = page.evaluate("window.__rdfArrows.state")
        last = st["edges"][-1]
        print("abox edges:", [(e["kind"], e["name"]) for e in st["edges"][-3:]])
        assert [e["kind"] for e in st["edges"][-3:]] == ["type", "type", "object"], st["edges"][-3:]
        assert last["name"] == "belongsTo", last
        # 데이터 값
        h = body_box(3)
        page.mouse.click(h["x"] + 15, h["y"] + 12)
        assert page.is_visible("text=개체 (individual)")
        page.click("#addAttr")
        page.fill("[data-ai='0'][data-af=name]", "나이")
        page.fill("[data-ai='0'][data-af=value]", "33")
        page.select_option("[data-ai='0'][data-af=type]", "xsd:integer")
        page.screenshot(path=os.path.join(OUT, "abox.png"))
        page.mouse.click(svg["x"] + 40, svg["y"] + 820)
        # 5) 삭제/실행취소
        page.mouse.click(svg["x"] + 40, svg["y"] + 820)  # 빈 곳 클릭 → 선택 해제
        n0 = body_box(0)
        page.mouse.click(n0["x"] + 20, n0["y"] + 10)
        before = len(page.evaluate("window.__rdfArrows.state")["nodes"])
        page.keyboard.press("Delete")
        assert len(page.evaluate("window.__rdfArrows.state")["nodes"]) == before - 1
        page.keyboard.press("Control+z")
        assert len(page.evaluate("window.__rdfArrows.state")["nodes"]) == before

        ttl = page.evaluate("window.__rdfArrows.toTurtle()")
        open(os.path.join(OUT, "built.ttl"), "w").write(ttl)
        g = rdflib.Graph().parse(data=ttl, format="turtle")
        EX = rdflib.Namespace("http://example.org/onto#")
        OWL, RDFS, RDF = rdflib.OWL, rdflib.RDFS, rdflib.RDF
        assert (EX["사람"], RDF.type, OWL.Class) in g
        assert (EX["MilitaryUnit"], RDFS.subClassOf, EX["조직"]) in g
        assert (EX["MilitaryUnit"], RDFS.label, rdflib.Literal("Military Unit", lang="ko")) in g
        assert (EX["belongsTo"], RDF.type, OWL.ObjectProperty) in g
        dom = g.value(EX["belongsTo"], RDFS.domain)
        assert isinstance(dom, rdflib.BNode), "domain should be union"
        union = list(rdflib.collection.Collection(g, g.value(dom, OWL.unionOf)))
        assert set(union) == {EX["사람"], EX["조직"]}, union
        assert (EX["설립일"], RDFS.range, rdflib.XSD.date) in g
        print("built graph OK, triples:", len(g))
        HONG, U1 = EX["홍길동"], EX["1대대"]
        assert (HONG, RDF.type, OWL.NamedIndividual) in g
        assert (HONG, RDF.type, EX["사람"]) in g
        assert (U1, RDF.type, EX["MilitaryUnit"]) in g
        assert (HONG, EX["belongsTo"], U1) in g
        assert (HONG, EX["나이"], rdflib.Literal(33)) in g, list(g.triples((HONG, None, None)))
        assert (EX["나이"], RDF.type, OWL.DatatypeProperty) in g
        print("ABox OK")

        # 6) 모달
        page.click("#bView")
        status = page.inner_text("#ttlStatus")
        print("modal status:", status)
        assert "통과" in status
        page.keyboard.press("Escape")

        # 7) 왕복: 내보낸 TTL을 다시 불러와 같은 그래프인지
        rt = page.evaluate("""(t) => { const st = window.__rdfArrows.importTurtle(t); return st; }""", ttl)
        assert len(rt["nodes"]) == 5 and len(rt["edges"]) == 6, (len(rt["nodes"]), len(rt["edges"]))
        page.set_input_files("#fileIn", files=[{"name": "b.ttl", "mimeType": "text/turtle", "buffer": ttl.encode()}])
        page.wait_for_timeout(300)
        rt_ttl = page.evaluate("window.__rdfArrows.toTurtle()")
        assert isomorphic(g, rdflib.Graph().parse(data=rt_ttl, format="turtle")), "built round trip changed"
        print("built round trip isomorphic")
        page.screenshot(path=os.path.join(OUT, "built.png"))

        # 8) 예시 → 왕복 동형성
        page.click("#bSample")
        page.wait_for_timeout(300)
        ttl2 = page.evaluate("window.__rdfArrows.toTurtle()")
        page.evaluate("""(t) => { const s = window.__rdfArrows.importTurtle(t); }""", ttl2)
        # 불러온 상태를 실제로 적용해서 다시 내보내기
        page.set_input_files("#fileIn", files=[{"name": "x.ttl", "mimeType": "text/turtle", "buffer": ttl2.encode()}])
        page.wait_for_timeout(300)
        ttl3 = page.evaluate("window.__rdfArrows.toTurtle()")
        g2 = rdflib.Graph().parse(data=ttl2, format="turtle")
        g3 = rdflib.Graph().parse(data=ttl3, format="turtle")
        assert isomorphic(g2, g3), "round trip changed graph"
        print("round trip isomorphic, triples:", len(g2))
        page.screenshot(path=os.path.join(OUT, "sample.png"))

        # 9) 새로고침 후 자동 저장 복원
        page.reload(); page.wait_for_timeout(500)
        assert len(page.evaluate("window.__rdfArrows.state")["nodes"]) == 7
        print("localStorage restore OK")

        # 10) 외부 TTL (Protégé 스타일, 배치 정보 없음)
        ext = """@prefix : <http://ex.com/x#> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix cco: <https://www.commoncoreontologies.org/> .
<http://ex.com/x> a owl:Ontology .
:A a owl:Class ; rdfs:subClassOf cco:Agent . :B a owl:Class . :C a owl:Class ; rdfs:subClassOf :B .
cco:Agent a owl:Class ; rdfs:label "agent"@en .
:p a owl:ObjectProperty ; rdfs:domain [ owl:unionOf ( :A :C ) ] ; rdfs:range :B .
:q a owl:DatatypeProperty ; rdfs:domain :B ; rdfs:range xsd:integer .
:i1 a :B ; :q 5 ; rdfs:label "first"@en . :i2 a :A ; :p :i1 . :i3 :p :i1 .
"""
        page.set_input_files("#fileIn", files=[{"name": "ext.ttl", "mimeType": "text/turtle", "buffer": ext.encode()}])
        page.wait_for_timeout(300)
        st = page.evaluate("window.__rdfArrows.state")
        print("ext nodes:", sorted(n["name"] for n in st["nodes"]), "edges:", len(st["edges"]), "prefix:", st["meta"]["prefix"], repr(st["meta"]["extraPrefixes"]))
        ttl4 = page.evaluate("window.__rdfArrows.toTurtle()")
        g4 = rdflib.Graph().parse(data=ttl4, format="turtle")
        X = rdflib.Namespace("http://ex.com/x#"); CCO = rdflib.Namespace("https://www.commoncoreontologies.org/")
        assert (X.A, RDFS.subClassOf, CCO.Agent) in g4
        assert (X.q, RDFS.range, rdflib.XSD.integer) in g4
        assert (X.i1, RDF.type, X.B) in g4 and (X.i2, X.p, X.i1) in g4 and (X.i1, X.q, rdflib.Literal(5)) in g4
        assert (X.i3, X.p, X.i1) in g4, "untyped subject with assertion"
        print("ext ABox OK:", sorted(n["name"] for n in st["nodes"] if n.get("kind") == "individual"))
        page.screenshot(path=os.path.join(OUT, "ext.png"))
        open(os.path.join(OUT, "ext.ttl"), "w").write(ttl4)
        browser.close()
finally:
    srv.terminate()
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
