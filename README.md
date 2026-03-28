# AZDo-codereview

Azure DevOps Code Review automation repository.

This repository contains tools, skills, and agents to automate and enhance code review workflows using AI.

## Architecture

The project follows a **clean / hexagonal architecture** with clear separation between business and technical concerns:

```
src/
  domain/                  # Business layer — pure domain entities
    PullRequest.js         # PR entity (title, commit ids, …)
    FileChange.js          # Changed-file entity with isDeleted() helper
    ReviewThread.js        # Posted-comment entity with isActive() helper
  azure-client.js          # Infrastructure adapter — HTTP ↔ domain mapping
azuredevops-openai-review.js  # Application entry point (CLI)
tests/
  features/                # BDD feature files (business language / Gherkin)
  step-definitions/        # Cucumber step implementations (technical bridge)
  integration/             # Jest integration tests
  mocks/                   # OpenAPI contract + Microcks artifacts
.github/
  workflows/
    ci.yml                 # GitHub Actions CI pipeline
```

## Testing

### Prerequisites

- Node.js 20+
- Docker (required for integration and BDD tests — Testcontainers manages the lifecycle)

### Setup

```bash
npm install
```

### Running Tests

| Command | Description |
|---|---|
| `npm test` | Runs unit → integration → BDD tests in sequence |
| `npm run test:unit` | Unit tests only — no Docker needed |
| `npm run test:integration` | Integration tests with Microcks Testcontainers (Docker required) |
| `npm run test:bdd` | BDD / Cucumber scenarios against Microcks mocks (Docker required) |

### BDD Tests (ATDD / Cucumber)

Behavior-driven scenarios live in `tests/features/pull-request-review.feature`.  
Each scenario is written in **Gherkin** (Given / When / Then) and describes a business behavior:

```gherkin
Scenario: Fetching information about an open pull request
  When I request the pull request information
  Then the pull request title should be "feat: add review automation"
  And the source commit id should be "abc123def456"
```

Step definitions in `tests/step-definitions/` wire the Gherkin sentences to the real
`createAzureClient` calls against a **Microcks** container started automatically by
[Testcontainers](https://testcontainers.com/) — **no `docker-compose` file needed**.

### Mock API artifacts (`tests/mocks/`)

| File | Role |
|---|---|
| `azure-devops-pr-api.openapi.yaml` | OpenAPI 3.0 contract (primary artifact) |
| `azure-devops-pr-api.apiexamples.yaml` | Microcks APIExamples with concrete test data |
| `azure-devops-pr-api.apimetadata.yaml` | Dispatcher rules (`URI_PARAMS` on `path`) |

### CI Pipeline

The `.github/workflows/ci.yml` pipeline runs on every push and pull request:

1. **Install** — `npm ci`
2. **Unit tests** — `npm run test:unit`
3. **Integration tests** — `npm run test:integration` (Testcontainers + Microcks)
4. **BDD tests** — `npm run test:bdd` (Cucumber scenarios)
5. **Artefact** — Cucumber HTML report uploaded for every run
