import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8790", "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); errors = []
TRICKY = '''@prefix ex: <http://example.org/onto#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
# 보통 주석
ex:Kim a ex:Person ;
    ex:age "42"^^xsd:integer ;
    ex:note """여러 줄
문자열 # 주석 아님 ; . """@ko ;
    ex:quote "따옴표 \\" 포함" ,
        "둘째"@en ;
    ex:addr [ ex:city "서울" ; ex:zip 12345 ] ;
    ex:knows _:b1 , <http://example.org/other> .
'''
LINES = "Array.from(document.querySelectorAll('#ttlOut .ln')).map(l => l.textContent).join('\\n')"
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=(os.environ.get("CHROME") or ("/usr/bin/google-chrome" if os.path.exists("/usr/bin/google-chrome") else None)), args=["--no-sandbox"])
        page = b.new_page(viewport={"width": 1400, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8790/index.html"); page.wait_for_timeout(300)

        # 1) 색칠 함수 단독: 글자는 그대로, 자리별로 다른 색
        page.evaluate("t => { document.querySelector('#ttlOut').innerHTML = highlightTurtle(t) }", TRICKY)
        assert page.evaluate(LINES) == TRICKY.rstrip("\n"), page.evaluate(LINES)
        cls = lambda sel: page.eval_on_selector_all(sel, "els => els.map(e => e.textContent)")
        assert cls(".t-dir") == ["@prefix", "@prefix"]
        assert cls(".t-pfx") == ["ex:", "xsd:"]
        assert cls(".t-s") == ["ex:Kim"], cls(".t-s")
        assert cls(".t-a") == ["a"]
        assert set(cls(".t-p")) == {"ex:age", "ex:note", "ex:quote", "ex:addr", "ex:knows", "ex:city", "ex:zip"}, cls(".t-p")
        assert "ex:Person" in cls(".t-o") and "<http://example.org/other>" in cls(".t-o")
        assert cls(".t-dtype") == ["xsd:integer"]
        assert cls(".t-lang") == ["@ko", "@en"]
        assert cls(".t-com") == ["# 보통 주석"], cls(".t-com")   # 여러 줄 문자열 안의 #은 주석이 아님
        assert cls(".t-num") == ["12345"]
        assert cls(".t-bnode") == ["_:b1"]
        assert len(cls(".t-lstr")) == 2   # 두 줄에 걸친 문자열은 줄마다 조각으로

        # 2) 실제 미리보기: 내보낸 TTL과 글자 하나 다르지 않음, 주어는 캔버스 색 칩
        page.click("#bSample"); page.click("[data-sample=small]"); page.wait_for_timeout(200)
        page.click("#bView"); page.wait_for_timeout(200)
        ttl = page.evaluate("window.__rdfArrows.toTurtle()")
        assert page.evaluate(LINES) == ttl.rstrip("\n")
        chips = page.eval_on_selector_all(".t-node", "els => els.map(e => [e.textContent, getComputedStyle(e).color, getComputedStyle(e).borderTopWidth, getComputedStyle(e).backgroundColor])")
        nodes = page.evaluate("window.__rdfArrows.state.nodes.length")
        assert len(chips) == nodes, (chips, nodes)
        assert all(c[2] == '0px' and c[3] == 'rgba(0, 0, 0, 0)' for c in chips), chips   # 테두리·바탕 없이 글자색만
        assert len({c[1] for c in chips}) > 1, chips
        assert page.eval_on_selector_all(".t-sec", "els => els.length") >= 4
        assert page.eval_on_selector_all(".t-meta", "els => els.length") >= 1
        assert "통과" in page.inner_text("#ttlStatus")
        page.screenshot(path=os.path.join(OUT, "ttl_highlight.png"))

        # 3) 복사 버튼은 원문 그대로
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.click("#mCopy"); page.wait_for_timeout(200)
        assert page.evaluate("navigator.clipboard.readText()") == ttl
        b.close()
    assert not errors, errors
    print("ALL OK")
finally:
    srv.terminate()
