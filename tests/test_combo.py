import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8774", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8774/index.html"); page.wait_for_timeout(300)
        page.click("#bSample"); page.click("[data-sample=small]"); page.wait_for_timeout(300)
        page.evaluate("window.__rdfArrows.state.meta.naming = 'label'")
        st = lambda: page.evaluate("window.__rdfArrows.state")
        def edge_where(js): return page.evaluate(f"(() => {{ const S = window.__rdfArrows.state; const N = id => S.nodes.find(n => n.id === id); return S.edges.find(e => {js}).id; }})()")
        def click_edge(eid): page.locator(f"[data-edge='{eid}'] .hit").click(force=True)
        def node_box(name): return page.locator(f"[data-node='{page.evaluate(f'window.__rdfArrows.state.nodes.find(n => n.name === \"{name}\").id')}'] .body").bounding_box()

        # 1. 개체 관계: ▾ 누르면 전체 목록, 타입에 맞는 관계가 추천으로 맨 위
        eid = edge_where("e.kind === 'object' && N(e.from).name === 'kim'")
        click_edge(eid)
        page.click("#panel .combo-btn")
        assert page.is_visible("#panel .combo-menu")
        items = page.locator("#panel .combo-item").all_inner_texts()
        print("menu:", [i.replace("\n", " / ") for i in items])
        rec = [i for i in items if "추천" in i]
        assert len(items) == 3 and any("commands" in i and "사람 → 부대" in i for i in rec) and any("memberOf" in i for i in rec) and not any("assignedTo" in i for i in rec)
        # 2. 목록에서 다른 관계 고르기 → 이름·라벨이 그 속성으로, 따라가기 꺼짐
        page.locator("#panel .combo-item", has_text="assignedTo").click()
        e = [x for x in st()["edges"] if x["id"] == eid][0]
        assert e["name"] == "assignedTo" and e["label"] == "수행" and e["nameAuto"] is False, e
        assert page.input_value("[data-f=label]") == "수행" and "직접 지정" in page.inner_text("#nmAuto")
        assert not page.is_visible("#panel .combo-menu")
        # 3. 입력하면 걸러짐 + 키보드로 고르기
        page.fill("[data-f=name]", ""); page.locator("[data-f=name]").type("mem")
        items = page.locator("#panel .combo-item").all_inner_texts()
        assert len(items) == 1 and "memberOf" in items[0], items
        page.keyboard.press("ArrowDown"); page.keyboard.press("Enter")
        assert [x for x in st()["edges"] if x["id"] == eid][0]["name"] == "memberOf"
        # 4. Esc는 목록만 닫고 선택은 유지
        page.click("#panel .combo-btn"); page.keyboard.press("Escape")
        assert not page.is_visible("#panel .combo-menu") and "개체 관계" in page.inner_text("#panel")
        page.screenshot(path=os.path.join(OUT, "combo_edge.png"))
        page.keyboard.press("Control+z"); page.keyboard.press("Control+z")

        # 5. 클래스: 불러온 클래스는 직접 지정 → 따라가게 → 라벨 바꾸면 이름도 바뀜
        b = node_box("Person"); page.mouse.click(b["x"] + 10, b["y"] + 8)
        assert "직접 지정" in page.inner_text("#nmAuto")
        page.click("#nmAuto")
        assert page.input_value("[data-f=name]") == "사람" and "라벨 따라감" in page.inner_text("#nmAuto")
        page.fill("[data-f=label]", "인원 정보")
        assert page.input_value("[data-f=name]") == "인원정보"
        page.locator("[data-f=name]").type("X")
        assert "직접 지정" in page.inner_text("#nmAuto")
        fixed = page.input_value("[data-f=name]")
        page.fill("[data-f=label]", "사람2")
        assert page.input_value("[data-f=name]") == fixed, "fixed name must not follow"
        # 6. 클래스 사이 관계도 같은 버튼
        page.keyboard.press("Escape")
        page.mouse.click(1000, 800)
        eid2 = edge_where("e.kind === 'object' && N(e.from).name === 'Unit'")
        click_edge(eid2)
        assert page.is_visible("#nmAuto") and "직접 지정" in page.inner_text("#nmAuto")
        page.click("#nmAuto"); page.fill("[data-f=label]", "수행 하다")
        assert page.input_value("[data-f=name]") == "수행하다"
        # 7. 개체 데이터 값: 타입에 맞는 속성이 추천
        page.mouse.click(1000, 800)
        b = node_box("kim"); page.mouse.click(b["x"] + 10, b["y"] + 8)
        page.click("#addAttr")
        page.locator("#attrs .combo-btn").last.click()
        items = page.locator("#attrs .combo-item").all_inner_texts()
        print("dp menu:", [i.replace("\n", " / ") for i in items])
        assert "추천" in items[0] and "name" in items[0] and any("startDate" in i and "추천" not in i for i in items)
        page.locator("#attrs .combo-item", has_text="startDate").click()
        assert page.locator("#attrs select").last.input_value() == "xsd:date"
        page.screenshot(path=os.path.join(OUT, "combo_dp.png"))
        browser.close()
finally:
    srv.terminate()
print("console errors:", errors)
print("ALL OK" if not errors else "HAS ERRORS")
