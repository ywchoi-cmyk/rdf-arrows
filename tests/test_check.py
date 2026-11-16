import subprocess, sys, time, os, re, json
from playwright.sync_api import sync_playwright
import rdflib, owlrl
from rdflib.compare import isomorphic

ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

MOCK = """<?xml version="1.0" encoding="UTF-8"?>
<oops:OOPSResponse xmlns:oops="http://www.oeg-upm.net/oops">
<oops:Pitfall><oops:Code>P08</oops:Code><oops:Name>Missing annotations</oops:Name>
<oops:Description>Ontology elements lack human readable annotations.</oops:Description><oops:Importance>Minor</oops:Importance>
<oops:NumberAffectedElements>1</oops:NumberAffectedElements><oops:Affects><oops:AffectedElement>http://example.org/org#name</oops:AffectedElement></oops:Affects></oops:Pitfall>
<oops:Pitfall><oops:Code>P13</oops:Code><oops:Name>Inverse relationships not explicitly declared</oops:Name>
<oops:Description>Missing inverse.</oops:Description><oops:Importance>Important</oops:Importance>
<oops:NumberAffectedElements>2</oops:NumberAffectedElements><oops:Affects><oops:AffectedElement>http://example.org/org#commands</oops:AffectedElement><oops:AffectedElement>http://example.org/org#Person</oops:AffectedElement></oops:Affects></oops:Pitfall>
<oops:Pitfall><oops:Code>P10</oops:Code><oops:Name>Missing disjointness</oops:Name><oops:Description>No disjoint axioms.</oops:Description><oops:Importance>Important</oops:Importance></oops:Pitfall>
</oops:OOPSResponse>"""

# 데이터 문제를 일부러 넣은 모델: 임무 개체가 '지휘'(domain 사람)를 씀, 정수 오류, 함수형 관계에 값 2개
BAD = """@prefix ex: <http://example.org/org#> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<http://example.org/org> a owl:Ontology .
ex:Person a owl:Class ; rdfs:label "사람"@ko . ex:Officer a owl:Class ; rdfs:label "장교"@ko ; rdfs:subClassOf ex:Person .
ex:Unit a owl:Class ; rdfs:label "부대"@ko . ex:Mission a owl:Class ; rdfs:label "임무"@ko .
ex:commands a owl:ObjectProperty , owl:FunctionalProperty ; rdfs:label "지휘"@ko ; rdfs:domain ex:Person ; rdfs:range ex:Unit .
ex:age a owl:DatatypeProperty ; rdfs:domain ex:Person ; rdfs:range xsd:integer .
ex:kim a owl:NamedIndividual , ex:Officer ; rdfs:label "김대위"@ko ; ex:commands ex:u1 , ex:u2 ; ex:age "서른"^^xsd:integer .
ex:u1 a owl:NamedIndividual , ex:Unit ; rdfs:label "1대대"@ko .
ex:u2 a owl:NamedIndividual , ex:Unit ; rdfs:label "2대대"@ko .
ex:m1 a owl:NamedIndividual , ex:Mission ; rdfs:label "경계 임무"@ko ; ex:commands ex:u1 .
"""

calls = {"n": 0, "bodies": []}
mode = {"v": "ok"}
def handler(route, request):
    calls["n"] += 1
    calls["bodies"].append(request.post_data)
    h = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/xml"}
    m = mode["v"]
    if m == "ok":
        route.fulfill(status=200, headers=h, body=MOCK)
    elif m == "429-then-ok":
        if calls["n"] % 2 == 1: route.fulfill(status=429, headers=h, body="busy")
        else: route.fulfill(status=200, headers=h, body=MOCK)
    elif m == "fail":
        route.abort("connectionrefused")
    elif m == "slow":
        time.sleep(4); route.fulfill(status=200, headers=h, body=MOCK)
    elif m == "oops-error":
        route.fulfill(status=200, headers=h, body='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:oops="http://www.oeg-upm.net/oops#"><rdf:Description rdf:about="http://www.oeg-upm.net/oops/unexpected_error"><oops:hasTitle>OOPS! something went wrong.</oops:hasTitle><oops:hasMessage>bad input</oops:hasMessage></rdf:Description></rdf:RDF>')

errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("https://oops.linkeddata.es/rest", handler)
        page.goto("http://127.0.0.1:8766/index.html"); page.wait_for_timeout(400)
        page.set_input_files("#fileIn", files=[{"name": "bad.ttl", "mimeType": "text/turtle", "buffer": BAD.encode()}])
        page.wait_for_timeout(300)
        # 테스트용으로 간격을 짧게
        page.evaluate("""() => { const o = window.__rdfArrows.OOPS; o.minIntervalMs = 2500; o.retryMinGapMs = 800; o.backoffMs = [800, 800]; o.tooManyWaitMs = 1200; o.timeoutMs = 2500; }""")

        def wait_done(timeout=30000):
            page.wait_for_function("() => document.querySelector('#cCancel').hidden", timeout=timeout)
        def step(i):
            return page.locator("#cSteps li").nth(i)

        # --- A. OOPS 끈 상태: 로컬만 ---
        page.click("#bCheck"); wait_done()
        assert calls["n"] == 0
        txt = page.inner_text("#cResults")
        print("---- local results ----\n" + txt[:1800])
        assert "domain 불일치" in txt, "domain mismatch expected"
        assert "서른" in txt and "xsd:integer 형식이 아닙니다" in txt
        assert "값이 2개" in txt
        assert "합쳐짐" in txt, "functional sameAs expected"
        assert "관계의 domain/range 때문에" in txt  # 경계 임무 → 사람
        assert "끼져" not in txt
        print("step4:", step(3).inner_text())
        assert "꺼져 있음" in step(3).inner_text()
        page.screenshot(path=os.path.join(OUT, "check_local.png"))

        # 추론 결과를 owlrl과 대조 (개체별 이름 있는 타입)
        ours = page.evaluate("""() => {
          const A = window.__rdfArrows; const quads = new N3.Parser().parse(A.toTurtle());
          const res = A.runReasoner(quads); const out = {};
          res.store.getQuads(null, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', null, null).forEach(q => {
            if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') return;
            (out[q.subject.value] = out[q.subject.value] || []).push(q.object.value); });
          return { types: out, ttl: A.toTurtle() }; }""")
        g = rdflib.Graph().parse(data=ours["ttl"], format="turtle")
        indivs = set(g.subjects(rdflib.RDF.type, rdflib.OWL.NamedIndividual))
        owlrl.DeductiveClosure(owlrl.OWLRL_Semantics).expand(g)
        model_classes = set(str(c) for c in rdflib.Graph().parse(data=ours["ttl"], format="turtle").subjects(rdflib.RDF.type, rdflib.OWL.Class))
        for i in indivs:
            theirs = {str(t) for t in g.objects(i, rdflib.RDF.type) if str(t) in model_classes}
            mine = {t for t in ours["types"].get(str(i), []) if t in model_classes}
            assert theirs == mine, (str(i), theirs, mine)
        same_owlrl = {(str(a), str(b)) for a, b in g.subject_objects(rdflib.OWL.sameAs) if a != b and str(a) in {str(x) for x in indivs}}
        print("owlrl agrees on individual types; owlrl sameAs:", sorted(same_owlrl))
        assert ("http://example.org/org#u1", "http://example.org/org#u2") in same_owlrl

        # RDF/XML 변환이 같은 그래프인지
        rx = page.evaluate("() => window.__rdfArrows.toRdfXml(new N3.Parser().parse(window.__rdfArrows.toTurtle())).xml")
        assert isomorphic(rdflib.Graph().parse(data=ours["ttl"], format="turtle"), rdflib.Graph().parse(data=rx, format="xml")), "rdfxml mismatch"
        print("RDF/XML isomorphic")

        # 캔버스 추론 표시
        page.check("#cOverlay")
        page.click("#cClose")
        assert page.locator(".edge.inferred").count() >= 1
        page.screenshot(path=os.path.join(OUT, "check_overlay.png"))

        # --- B. OOPS 켜고 성공 ---
        page.click("#bCheck"); page.check("#cOops"); wait_done()
        page.click("#cRun"); wait_done()
        assert calls["n"] == 1, calls["n"]
        body = calls["bodies"][-1]
        assert body.startswith("<?xml") and "<OntologyContent><![CDATA[" in body
        inner = re.search(r"<!\[CDATA\[(.*)\]\]></OntologyContent>", body, re.S).group(1)
        assert isomorphic(rdflib.Graph().parse(data=inner, format="xml"), rdflib.Graph().parse(data=ours["ttl"], format="turtle")), "sent ontology differs"
        s4 = step(3).inner_text(); print("B step4:", s4)
        assert "응답 수신" in s4 and "함정 3종" in s4
        res = page.inner_text("#cResults")
        assert "P13" in res and "P08" in res
        page.locator("details").first.click()
        page.screenshot(path=os.path.join(OUT, "check_oops.png"))

        # --- C. 같은 내용 → 캐시 (요청 안 보냄) ---
        page.click("#cRun"); wait_done()
        assert calls["n"] == 1, "cache should prevent request"
        assert "저장된 결과" in step(3).inner_text()
        print("C cache OK")

        # --- D. 내용 바꾸고 즉시 → 간격 제한 대기 표시 후 전송 ---
        page.evaluate("() => { window.__rdfArrows.state.meta.title = 'changed-1'; }")
        page.evaluate("() => { const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = Date.now(); localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }")
        page.click("#cRun")
        page.wait_for_function("() => document.querySelector('#cSteps li:nth-child(4)').innerText.includes('요청 간격 제한')", timeout=5000)
        print("D during wait:", step(3).inner_text().split("\n")[-1])
        wait_done()
        assert calls["n"] == 2 and "응답 수신" in step(3).inner_text()
        print("D interval OK")

        # --- E. 429 → 재시도 → 성공 ---
        mode["v"] = "429-then-ok"; calls["n"] = 2  # 다음 호출이 홀수(3) → 429
        page.evaluate("() => { window.__rdfArrows.state.meta.title = 'changed-2'; const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = 0; localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }")
        page.click("#cRun")
        page.wait_for_function("() => document.querySelector('#cSteps li:nth-child(4)').innerText.includes('재시도')", timeout=8000)
        print("E during:", step(3).inner_text().split("\n")[-1])
        wait_done()
        assert calls["n"] == 4 and "응답 수신" in step(3).inner_text(), (calls["n"], step(3).inner_text())
        print("E 429 retry OK")

        # --- F. 네트워크 실패 → 재시도 2회 후 실패 ---
        mode["v"] = "fail"; before = calls["n"]
        page.evaluate("() => { window.__rdfArrows.state.meta.title = 'changed-3'; const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = 0; localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }")
        page.click("#cRun"); wait_done(30000)
        s4 = step(3).inner_text(); print("F:", s4.replace("\n", " | "))
        assert calls["n"] - before == 3 and "실패" in s4, (calls["n"] - before, s4)
        assert "data 검사" not in s4
        # 로컬 결과는 그대로 보여야 함
        assert "domain 불일치" in page.inner_text("#cResults")

        # --- G. OOPS 오류 응답 → 재시도 없이 바로 실패 ---
        mode["v"] = "oops-error"; before = calls["n"]
        page.evaluate("() => { window.__rdfArrows.state.meta.title = 'changed-4'; const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = 0; localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }")
        page.click("#cRun"); wait_done()
        assert calls["n"] - before == 1 and "something went wrong" in step(3).inner_text()
        print("G fatal OK")

        # --- H. 시간당 한도 ---
        used = page.evaluate("() => JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')).sends.length")
        print("sends used:", used, "quota:", page.inner_text("#cQuota"))
        page.evaluate(f"() => {{ window.__rdfArrows.OOPS.maxPerHour = {used}; window.__rdfArrows.state.meta.title = 'changed-5'; const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = 0; localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }}")
        mode["v"] = "ok"; before = calls["n"]
        page.click("#cRun"); wait_done()
        assert calls["n"] == before and "시간당 요청 한도" in step(3).inner_text(), step(3).inner_text()
        print("H cap OK:", step(3).inner_text().split("\n")[-1])

        # --- I. 중단 ---
        page.evaluate("() => { window.__rdfArrows.OOPS.maxPerHour = 100; window.__rdfArrows.OOPS.timeoutMs = 20000; window.__rdfArrows.state.meta.title = 'changed-6'; const s = JSON.parse(localStorage.getItem('rdf-arrows:v1:oops')); s.lastCheck = Date.now(); localStorage.setItem('rdf-arrows:v1:oops', JSON.stringify(s)); }")
        page.click("#cRun")
        page.wait_for_function("() => document.querySelector('#cSteps li:nth-child(4)').innerText.includes('요청 간격 제한')", timeout=5000)
        page.click("#cCancel"); wait_done()
        assert "중단됨" in step(3).inner_text(), step(3).inner_text()
        print("I cancel OK")
        page.screenshot(path=os.path.join(OUT, "check_end.png"))
        browser.close()
finally:
    srv.terminate()
errors = [e for e in errors if "ERR_CONNECTION_REFUSED" not in e and "Failed to load resource" not in e]
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
