# Project Structure & Routing Rules

## 1. Directory Roles & Responsibilities

- **`./go/model/`**: Response 객체 및 Data Transfer Object(DTO) 구조체 정의
  - API 응답으로 전달할 객체 및 데이터 모델 구조체를 작성합니다.
- **`./go/controller/`**: 실질적인 비즈니스 로직 및 요청 처리 함수 구현
  - `./go/main.go`에서 전달받은 요청을 실제로 처리하고 결과를 반환하는 컨트롤러 함수를 작성합니다.
- **`./web/`**: HTML, JS, CSS 루트
- **`./web/js/`**: JavaScript 모음
- **`./web/css/`**: CSS 모음
- **`./web/<폴더명>/`**: 추가되는 하위메뉴. 하위메뉴가 하나 늘어날 때 폴더가 추가됩니다.
- **`./go/files/profile/`**: 회원가입한 사용자들의 프로필 파일 저장
- **`./go/files/image/`**: 서버로 업로드된 이미지 파일 저장

## 2. Routing Rules (`./go/main.go`)

- **Routing Declaration**: `./go/main.go` 파일에서는 HTTP 요청을 수신 시 라우팅 설정만 수행합니다.
  - 예시: `r.Post("/rest/기타url", controller.실제함수)`
- **Logic Separation**: `./go/main.go`에 직접 구현 로직을 작성하지 않으며, 실질적인 비즈니스 로직 구현은 반드시 `./go/controller/`의 컨트롤러 함수 내부에서 처리하도록 위임합니다.
- **URL Prefix**: 모든 REST API 경로는 `/rest/` 접두사를 포함해야 합니다.
