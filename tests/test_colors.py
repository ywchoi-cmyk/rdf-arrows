import subprocess, sys, time, os, json, re
from playwright.sync_api import sync_playwright

ROOT, OUT = sys.argv[1], sys.argv[2]
PAL = []  # 페이지에서 읽음
def fnv(s):
    h = 0x811c9dc5
    for b in s.encode("utf-8"):
        h ^= b; h = (h * 0x01000193) & 0xffffffff
    return h
def expected(iri): return PAL[fnv(iri) % 24]

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8772", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8772/index.html"); page.wait_for_timeout(400)
        PAL[:] = page.evaluate("window.__rdfArrows.PALETTE.map(c => [c.name, c.fill, c.stroke])")
        svg = page.locator("#canvas").bounding_box()
        fill = lambda i: page.locator("#nodes .node").nth(i).locator(".body").get_attribute("fill")
        stroke = lambda i: page.locator("#nodes .node").nth(i).locator(".body").get_attribute("stroke")
        # 클래스 2개
        page.mouse.dblclick(svg["x"] + 600, svg["y"] + 300); page.keyboard.type("장교")
        page.fill("[data-f=name]", "Officer")
        page.mouse.dblclick(svg["x"] + 850, svg["y"] + 300); page.keyboard.type("부대")
        page.fill("[data-f=name]", "Unit")
        base = page.evaluate("window.__rdfArrows.state.meta.baseIri")
        e0, e1 = expected(base + "Officer"), expected(base + "Unit")
        print("Officer ->", e0[0], fill(0), "| Unit ->", e1[0], fill(1))
        assert fill(0) == e0[1] and stroke(0) == e0[2] and fill(1) == e1[1]
        # 개체: 타입 없으면 회색 → 타입 연결하면 클래스 색 그대로
        page.keyboard.down("Shift"); page.mouse.dblclick(svg["x"] + 600, svg["y"] + 560); page.keyboard.up("Shift"); page.keyboard.type("김대위")
        assert fill(2) == "#f6f7f9", fill(2)
        b2, b0 = page.locator("#nodes .node").nth(2).locator(".body").bounding_box(), page.locator("#nodes .node").nth(0).locator(".body").bounding_box()
        sx, sy = b2["x"] + b2["width"] / 2, b2["y"] - 5
        page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx, sy - 60, steps=5)
        page.mouse.move(b0["x"] + b0["width"] / 2, b0["y"] + b0["height"] / 2, steps=8); page.mouse.up()
        assert fill(2) == e0[1] and stroke(2) == e0[2], (fill(2), e0)
        print("individual follows type:", fill(2))
        # 직접 지정 → 개체도 따라감 → 자동으로 되돌림
        page.mouse.click(svg["x"] + 900, svg["y"] + 700)
        page.mouse.click(b0["x"] + 15, b0["y"] + 10)
        assert "자동 (" in page.inner_text("#panel")
        pick = PAL[3]
        page.click(f".swatch[data-color='{pick[1]}']")
        assert fill(0) == pick[1] and fill(2) == pick[1], (fill(0), fill(2))
        t = page.evaluate("window.__rdfArrows.toTurtle()")
        lay = json.loads(re.search(r"rdf-arrows-layout: (\{.*\})", t).group(1))
        cols = {k.split('#')[-1]: v for k, v in lay["nodes"].items()}
        print("layout:", cols)
        assert len(cols["Officer"]) == 3 and cols["Officer"][2] == pick[1] and len(cols["Unit"]) == 2 and len(cols["김대위"]) == 2
        page.screenshot(path=os.path.join(OUT, "colors_manual.png"))
        page.click(".swauto")
        assert fill(0) == e0[1] and fill(2) == e0[1]
        # 다시 불러와도 같은 색
        page.set_input_files("#fileIn", files=[{"name": "c.ttl", "mimeType": "text/turtle", "buffer": page.evaluate("window.__rdfArrows.toTurtle()").encode()}])
        page.wait_for_timeout(300)
        assert fill(0) == e0[1] and fill(1) == e1[1]
        # 예전 기본색이 저장된 파일 → 자동, 예전에 고른 색 → 유지
        old = '@prefix ex: <http://e.org/o#> . @prefix owl: <http://www.w3.org/2002/07/owl#> .\nex:A a owl:Class . ex:B a owl:Class .\n# rdf-arrows-layout: {"v":1,"nodes":{"http://e.org/o#A":[0,0,"#ffffff"],"http://e.org/o#B":[300,0,"#fce8e6"]}}\n'
        page.set_input_files("#fileIn", files=[{"name": "old.ttl", "mimeType": "text/turtle", "buffer": old.encode()}])
        page.wait_for_timeout(300)
        st = page.evaluate("window.__rdfArrows.state.nodes.map(n => [n.name, n.color])")
        print("old file:", st)
        assert dict(st)["A"] is None and dict(st)["B"] == "#fce8e6"
        assert fill(0) == expected("http://e.org/o#A")[1]
        # 예시: 색 지정 없이 모두 자동, 개체는 타입 색
        page.click("#bSample"); page.wait_for_timeout(300)
        nodes = page.evaluate("window.__rdfArrows.state.nodes.map(n => ({ name: n.name, kind: n.kind, color: n.color }))")
        assert all(n["color"] is None for n in nodes)
        page.mouse.click(svg["x"] + 900, svg["y"] + 760)
        page.screenshot(path=os.path.join(OUT, "colors_sample.png"))
        # 예전 저장본(localStorage) 기본색 정리
        page.evaluate("""() => localStorage.setItem('rdf-arrows:v1', JSON.stringify({ state: { meta: { title: 't', ontologyIri: 'http://e.org/o', baseIri: 'http://e.org/o#', prefix: 'e', lang: 'ko' }, nodes: [{ id: 'n1', kind: 'class', x: 0, y: 0, label: 'A', name: 'A', comment: '', color: '#ffffff', attrs: [] }], edges: [], seq: 2 } }))""")
        page.reload(); page.wait_for_timeout(400)
        assert page.evaluate("window.__rdfArrows.state.nodes[0].color") is None
        browser.close()
finally:
    srv.terminate()
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
