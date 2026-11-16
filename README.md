# RDF Arrows

브라우저에서 바로 쓰는 노코드 온톨로지 모델러입니다. neo4j의 arrows.app처럼 캔버스에 클래스(TBox)와 개체(ABox)를 그리고 선으로 이어서 OWL 온톨로지를 만들고, Turtle(.ttl)로 내려받습니다.

설치나 서버가 필요 없습니다. `index.html` 하나와 Turtle 파서(`lib/n3.min.js`)로만 돌아가고, 작업 내용은 쓰는 사람의 브라우저에만 저장됩니다.

## 사용법

| 하고 싶은 것 | 방법 |
|---|---|
| 클래스 추가 | 빈 곳 더블클릭 |
| 개체 추가 | 상단 "추가"를 개체로 바꾸고 더블클릭, 또는 Shift+더블클릭 |
| 관계 연결 | 노드 테두리(마우스를 올리면 나오는 파란 띠)를 끌어 다른 노드에 놓기. 빈 곳에 놓으면 같은 종류의 노드가 함께 생김 |
| 타입 지정 | 개체를 클래스로 연결 (`rdf:type`), 또는 개체 패널에서 "+ 타입 추가" |
| 개체 관계 | 개체를 개체로 연결. 두 개체의 클래스 사이에 정의한 관계가 있으면 그 이름이 자동으로 들어감 |
| 상속 (subClassOf) | 관계를 선택하고 오른쪽 패널에서 유형을 subClassOf로 변경 |
| 데이터 속성 | 클래스를 선택하고 "+ 데이터 속성 추가" (xsd 타입 선택) |
| 데이터 값 | 개체를 선택하고 "+ 데이터 값 추가". 타입 클래스에 정의한 속성이 먼저 제안됨 |
| 이동 / 화면 이동 | 클래스 끌기 / 빈 곳 끌기 또는 스크롤 |
| 확대·축소 | Ctrl/⌘ + 스크롤, 트랙패드 핀치, 왼쪽 아래 버튼 |
| 삭제 / 되돌리기 | Delete·Backspace / Ctrl/⌘ + Z |
| 불러오기 | "TTL 불러오기" 또는 .ttl 파일을 캔버스에 끌어다 놓기 |

## TTL로 나가는 내용

- 클래스 → `owl:Class`, 라벨 → `rdfs:label`, 설명 → `rdfs:comment` (설정한 언어 태그 사용)
- 클래스 사이 관계 → `owl:ObjectProperty` + `rdfs:domain` / `rdfs:range`
- 같은 이름의 관계를 여러 곳에 쓰면 하나의 속성으로 합쳐지고, 출발·도착 클래스가 여러 개면 domain·range가 `owl:unionOf`로 나갑니다
- "값이 하나만 허용됨" 체크 → `owl:FunctionalProperty`
- 클래스의 데이터 속성 → `owl:DatatypeProperty` + `rdfs:range xsd:...`
- 개체 → `owl:NamedIndividual` + `rdf:type`, 개체 사이 관계 → 속성 값 트리플, 데이터 값 → 타입이 붙은 리터럴 (`"33"^^xsd:integer`)
- 다른 온톨로지 클래스는 설정 패널에 접두어를 등록한 뒤 이름에 `cco:Agent`처럼 쓰면 됩니다 (점선 테두리로 표시)

파일 맨 끝에 `# rdf-arrows-layout:`로 시작하는 주석 한 줄이 붙습니다. 노드 위치와 색을 담은 것으로, 다시 불러올 때 배치를 복원하는 데 씁니다. 주석이라 Protégé, rdflib 같은 다른 도구는 무시합니다.

다른 도구에서 만든 TTL을 불러오면 클래스, 상속, 객체·데이터 속성의 domain/range, 개체와 그 타입·속성 값을 읽어서 그림으로 펼칩니다. 배치 정보가 없으면 자동으로 배치합니다.

## 한계

캔버스로 표현하기 쉬운 범위(클래스, 상속, domain/range, 데이터 속성)만 다룹니다. 다음은 지원하지 않습니다. 필요하면 내려받은 TTL을 Protégé 등에서 이어서 편집하세요.

- 제약 조건 (`owl:Restriction`, 카디널리티 등)
- 속성 계층 (`subPropertyOf`)
- 추론기

## 로컬 실행

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```

## 라이선스

Turtle 파서로 [N3.js](https://github.com/rdfjs/N3.js)를 사용합니다 (`lib/N3-LICENSE.md`).
