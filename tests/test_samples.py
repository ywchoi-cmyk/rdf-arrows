import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8780", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); errors = []
# 실제 ORG의 일부 구조를 흉내 낸 작은 파일 (여러 언어 라벨, 외부 클래스, 하위 클래스)
ORG = """@prefix org: <http://www.w3.org/ns/org#> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix foaf: <http://xmlns.com/foaf/0.1/> .
<http://www.w3.org/ns/org> a owl:Ontology ; rdfs:label "Core organization ontology"@en .
org:Organization a owl:Class ; rdfs:label "Organization"@en , "organización"@es ; rdfs:subClassOf foaf:Agent .
org:OrganizationalUnit a owl:Class ; rdfs:label "Organizational Unit"@en , "unidad organizativa"@es ; rdfs:subClassOf org:Organization .
org:Post a owl:Class ; rdfs:label "Post"@en , "puesto"@es .
org:memberOf a owl:ObjectProperty ; rdfs:label "member of"@en ; rdfs:domain foaf:Agent ; rdfs:range org:Organization .
org:hasUnit a owl:ObjectProperty ; rdfs:label "has Unit"@en ; rdfs:domain org:Organization ; rdfs:range org:OrganizationalUnit .
"""
mode = {"v": "ok"}
def handler(route, request):
    if mode["v"] == "ok": route.fulfill(status=200, headers={"Access-Control-Allow-Origin": "*", "Content-Type": "text/turtle"}, body=ORG)
    else: route.abort()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = b.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.route("https://www.w3.org/ns/org.ttl", handler)
        page.goto("http://127.0.0.1:8780/index.html"); page.wait_for_timeout(300)
        page.click("#bSample"); assert page.is_visible("#sampleMenu")
        page.keyboard.press("Escape"); assert not page.is_visible("#sampleMenu")
        page.click("#bSample"); page.mouse.click(700, 500); assert not page.is_visible("#sampleMenu")
        page.click("#bSample"); page.click("[data-sample=small]"); page.wait_for_timeout(200)
        assert len(page.evaluate("window.__rdfArrows.state.nodes")) == 7
        page.click("#bSample"); page.click("[data-sample=org]")
        page.wait_for_function("() => window.__rdfArrows.state.meta.prefix === 'org'", timeout=5000)
        st = page.evaluate("window.__rdfArrows.state")
        labels = sorted(n["label"] or n["name"] for n in st["nodes"])
        print("ORG nodes:", labels, "edges:", len(st["edges"]))
        assert "Organization" in labels and "Organizational Unit" in labels and "foaf:Agent" in labels, labels
        assert st["meta"]["baseIri"] == "http://www.w3.org/ns/org#" and st["meta"]["lang"] == "en"
        page.screenshot(path=os.path.join(OUT, "sample_org.png"))
        mode["v"] = "fail"
        page.click("#bSample"); page.click("[data-sample=org]")
        page.wait_for_function("() => document.querySelector('#toast').innerText.includes('받지 못했습니다')", timeout=5000)
        b.close()
finally:
    srv.terminate()
errors = [e for e in errors if "Failed to load resource" not in e]
print("console errors:", errors); print("ALL OK" if not errors else "HAS ERRORS")
