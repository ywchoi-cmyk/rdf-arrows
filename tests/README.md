# 테스트

헤드리스 크롬으로 실제 화면을 조작하고, 나온 TTL을 rdflib·owlrl로 확인합니다. 외부 서버(OOPS!, 외부 온톨로지)는 가짜 응답으로 바꿔 끼워서 시험합니다.

```bash
pip install playwright rdflib owlrl
tests/run_all.sh            # 결과·스크린샷은 /tmp/rdf-arrows-test
CHROME=/path/to/chrome tests/run_all.sh   # 크롬 경로 지정
```

| 파일 | 확인하는 것 |
|---|---|
| test_editor.py | 그리기·연결·삭제·되돌리기, 개체(ABox), TTL 왕복, 외부 TTL 불러오기 |
| test_check.py | 검사: 추론 결과(owlrl과 대조), 데이터 검사, RDF/XML 변환, OOPS! 요청 제한·재시도·캐시·중단 |
| test_card.py | 온톨로지 카드: 이름 따라가는 주소·접두어, 고급 설정, 외부 온톨로지, 접기 |
| test_colors.py | 자동 색(IRI 해시), 개체 색, 직접 지정, 예전 파일 호환 |
| test_combo.py | 이름 드롭다운, 추천, 키보드, 라벨 따라감 |
| test_naming.py | 이름 정하는 방식 (IRI 먼저 / 라벨에서 IRI) |
| test_vocab.py | 외부 용어 불러오기, RDF/XML 모듈, 파일 업로드, 취소·오류, 이어서 만들기 |
