# AZDo-codereview

Azure DevOps Code Review automation repository.

This repository contains tools, skills, and agents to automate and enhance code review workflows using AI.

## Testing

### Prerequisites

- Node.js 18+
- Docker (required for integration tests)

### Setup

```bash
npm install
```

### Running Tests

| Command | Description |
|---|---|
| `npm test` | Runs all tests (requires Docker for integration tests) |
| `npm run test:unit` | Unit tests only — no Docker needed |
| `npm run test:integration` | Integration tests with Microcks Testcontainers (Docker required) |

### How integration tests work

Integration tests use [Microcks](https://microcks.io/) via the [`@microcks/microcks-testcontainers`](https://github.com/microcks/microcks-testcontainers-node) package to mock the Azure DevOps REST API.

The Microcks container (`quay.io/microcks/microcks-uber`) is **started and stopped automatically** by the test framework using [Testcontainers](https://testcontainers.com/) — no `docker-compose` file needed.

Mock definitions are located in `tests/mocks/`:
- `azure-devops-pr-api.openapi.yaml` — OpenAPI 3.0 contract (primary artifact)
- `azure-devops-pr-api.apiexamples.yaml` — Microcks APIExamples with concrete test data (secondary artifact)
- `azure-devops-pr-api.apimetadata.yaml` — Microcks APIMetadata with dispatcher rules (secondary artifact)

> **Note:** The first run may take longer as Docker pulls the Microcks image. The `beforeAll` timeout is set to 120 seconds.