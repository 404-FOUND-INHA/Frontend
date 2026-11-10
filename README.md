# Capstone Frontend

React + TypeScript + Vite 기반 프론트엔드 프로젝트입니다.

## 🧰 기술 스택

React 19 · TypeScript · Vite · React Router · TanStack Query · Axios · Oxlint

## 🚀 시작하기

```bash
npm install
cp .env.local.example .env.local   # 환경변수 설정
npm run dev
```

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 타입 체크 + 프로덕션 빌드 |
| `npm run lint` | Oxlint 실행 |
| `npm run preview` | 빌드 결과 미리보기 |

## 🔐 환경변수

`.env.local.example`을 복사해 `.env.local`을 만드세요. (`.env.local`은 git에 올라가지 않습니다)
클라이언트에 노출되므로 `VITE_` 변수에는 비밀키를 넣지 마세요.

## 📁 폴더 구조

```
src/
├── api/          # axios 인스턴스 및 API 호출 함수
├── assets/       # 이미지, 폰트 등 정적 리소스
├── components/   # 재사용 컴포넌트 (common/ 공통 UI)
├── config/       # 환경변수 등 설정
├── hooks/        # 커스텀 훅
├── layouts/      # 페이지 레이아웃
├── lib/          # 라이브러리 설정 (queryClient 등)
├── pages/        # 라우트 단위 페이지
├── routes/       # 라우터 설정
├── styles/       # 전역 스타일
├── types/        # 공용 타입
└── utils/        # 유틸 함수
```

`@/`는 `src/`의 alias입니다. (예: `import { env } from '@/config/env'`)

## 🌿 브랜치 전략 (GitHub Flow 기반)

- `main`: 배포 가능한 안정 브랜치. 직접 push 금지, PR로만 병합
- `feature/<이슈번호>-<설명>`: 기능 개발 (예: `feature/12-login-page`)
- `fix/<이슈번호>-<설명>`: 버그 수정
- `refactor/`, `chore/`, `docs/`: 목적에 맞는 접두사 사용

흐름: `main`에서 브랜치 생성 → 작업/커밋 → PR 생성 → 리뷰 승인 후 `main`에 병합 → 브랜치 삭제

## ✍️ 커밋 메시지 컨벤션

```
<type>: <제목>

(선택) 본문
```

| type | 설명 |
| --- | --- |
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변화 없는 코드 개선 |
| `style` | 포맷팅 등 코드 의미 없는 변경 |
| `docs` | 문서 수정 |
| `chore` | 빌드/설정/패키지 등 기타 작업 |
| `test` | 테스트 추가/수정 |

예시: `feat: 로그인 페이지 UI 구현`

## 🔀 Pull Request

PR을 생성하면 `.github/pull_request_template.md`가 자동 적용됩니다. 최소 1명의 리뷰 승인 후 병합합니다.
