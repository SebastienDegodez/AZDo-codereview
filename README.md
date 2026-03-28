# AZDo-codereview

Azure DevOps Code Review automation repository.

This repository contains tools, skills, and agents to automate and enhance code review workflows using AI.

## Architecture

The project follows a **clean architecture** with four layers:

```
src/
  api/                          # API layer — thin entry point (wiring only)
    review-runner.js            # Wires infrastructure → application → execute
  application/                  # Application layer — use cases
    get-reviewable-files.js     # Use case: get PR info + filter reviewable files
    review-pull-request.js      # Use case: orchestrate full PR review
  domain/                       # Domain layer — pure entities (no dependencies)
    PullRequest.js              # PR entity (title, commit IDs, …)
    FileChange.js               # Changed-file entity with isDeleted() helper
    ReviewThread.js             # Posted-comment entity with isActive() helper
    ReviewComment.js            # Review comment value object with severity + formatting
  infrastructure/               # Infrastructure layer — external adapters
    azure-devops-client.js      # Azure DevOps REST API adapter (HTTP ↔ domain)
    openai-review-client.js     # OpenAI Chat Completions adapter (agentic loop)
    skill-reader.js             # Filesystem skill reader (lazy loading)
    instruction-reader.js       # Filesystem instruction reader (applyTo filtering)
azuredevops-openai-review.js    # Root entry point (delegates to API layer)
tests/
  unit/                         # Outside-in unit tests (Application layer)
  integration/                  # Integration tests (Infrastructure via Microcks)
  mocks/                        # OpenAPI contracts + Microcks artifacts
.github/
  workflows/
    ci.yml                      # GitHub Actions CI pipeline
```

## Testing

### Prerequisites

- Node.js 20+
- Docker (required for integration tests — Testcontainers manages the lifecycle)

### Setup

```bash
npm install
```

### Running Tests

| Command | Description |
|---|---|
| `npm test` | Runs unit → integration tests in sequence |
| `npm run test:unit` | Unit tests (outside-in on Application layer) — no Docker needed |
| `npm run test:integration` | Integration tests with Microcks Testcontainers (Docker required) |

### Unit Tests (Outside-In)

Unit tests follow the **outside-in** approach on the Application layer:
- **Real domain objects** (`PullRequest`, `FileChange`, `ReviewComment`) — never mocked
- **Mocked infrastructure boundaries** (gateway, review client, skill reader, instruction reader)
- Tests verify observable behavior from the use case entry point

### Integration Tests (Microcks + Testcontainers)

Integration tests verify the Infrastructure layer against
**Microcks** containers started automatically by
[Testcontainers](https://testcontainers.com/) — **no `docker-compose` file needed**.

Two infrastructure adapters are tested:
- **Azure DevOps client** — 7 tests against Azure DevOps PR API mock
- **OpenAI review client** — 2 tests against OpenAI Chat Completions API mock

### Mock API artifacts (`tests/mocks/`)

| File | Role |
|---|---|
| `azure-devops-pr-api.openapi.yaml` | Azure DevOps OpenAPI 3.0 contract |
| `azure-devops-pr-api.apiexamples.yaml` | Microcks examples for Azure DevOps |
| `azure-devops-pr-api.apimetadata.yaml` | Dispatcher rules for Azure DevOps |
| `openai-chat-completions.openapi.yaml` | OpenAI Chat Completions OpenAPI 3.0 contract |
| `openai-chat-completions.apiexamples.yaml` | Microcks examples for OpenAI |
| `openai-chat-completions.apimetadata.yaml` | Dispatcher rules for OpenAI |

### CI Pipeline

The `.github/workflows/ci.yml` pipeline runs on every push and pull request:

1. **Install** — `npm ci`
2. **Unit tests** — `npm run test:unit` (outside-in, no Docker)
3. **Integration tests** — `npm run test:integration` (Testcontainers + Microcks)
