import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8776", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8776/index.html"); page.wait_for_timeout(400)
        svg = page.locator("#canvas").bounding_box()
        S = lambda: page.evaluate("window.__rdfArrows.state")
        assert S()["meta"]["naming"] == "iri"
        # 새 클래스: IRI 이름 Class1, 라벨 비어 있음, IRI 칸에 커서
        page.mouse.dblclick(svg["x"] + 600, svg["y"] + 300)
        n = S()["nodes"][0]; assert n["name"] == "Class1" and n["label"] == "", n
        assert page.evaluate("document.activeElement.dataset.f") == "name"
        labels = page.locator("#panel .field > label").all_inner_texts()
        assert labels.index("이름 (IRI)") < labels.index("라벨 (rdfs:label)"), labels
        assert page.locator("#nmAuto").count() == 0
        page.keyboard.type("Person")
        page.fill("[data-f=label]", "사람")
        n = S()["nodes"][0]; assert n["name"] == "Person" and n["label"] == "사람", n
        assert "사람" in page.locator("#nodes").text_content()
        t = page.evaluate("window.__rdfArrows.toTurtle()")
        assert 'ex:Person a owl:Class ;\n    rdfs:label "사람"@ko' in t, t
        # 두 번째 클래스, 관계 만들기: 관계도 IRI 칸 먼저
        page.mouse.dblclick(svg["x"] + 900, svg["y"] + 300); page.keyboard.type("Unit")
        b0 = page.locator("#nodes .node").nth(0).locator(".body").bounding_box(); b1 = page.locator("#nodes .node").nth(1).locator(".body").bounding_box()
        sx, sy = b0["x"] + b0["width"] + 5, b0["y"] + b0["height"] / 2
        page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx + 80, sy, steps=5)
        page.mouse.move(b1["x"] + 20, b1["y"] + 15, steps=8); page.mouse.up()
        assert page.evaluate("document.activeElement.dataset.f") == "name"
        page.keyboard.type("commands"); page.fill("[data-f=label]", "지휘 하다")
        e = S()["edges"][0]; assert e["name"] == "commands" and e["label"] == "지휘 하다", e
        # 카드에서 라벨 모드로 바꾸면 따라감 버튼이 나타나고 라벨→IRI
        page.mouse.click(svg["x"] + 700, svg["y"] + 700)
        page.click("#oSet"); page.click("#oNaming [data-naming=label]")
        assert "사람" in page.inner_text("#oPrev")
        page.mouse.click(svg["x"] + 700, svg["y"] + 700)
        page.mouse.dblclick(svg["x"] + 600, svg["y"] + 550)
        assert page.evaluate("document.activeElement.dataset.f") == "label"
        page.keyboard.type("임무 정보")
        n = S()["nodes"][-1]; assert n["name"] == "임무정보", n
        assert page.locator("#nmAuto").count() == 1
        # 다시 IRI 모드
        page.mouse.click(svg["x"] + 700, svg["y"] + 760)
        page.click("#oSet"); page.click("#oNaming [data-naming=iri]")
        assert S()["meta"]["naming"] == "iri"
        page.screenshot(path=os.path.join(OUT, "naming.png"))
        browser.close()
finally:
    srv.terminate()
print("console errors:", errors); print("ALL OK" if not errors else "HAS ERRORS")
