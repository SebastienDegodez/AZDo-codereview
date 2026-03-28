# AZDo-codereview

Azure DevOps Code Review automation repository.

This repository contains tools, skills, and agents to automate and enhance code review workflows using AI.

## Overview

The main script (`azuredevops-openai-review.js`) automatically reviews Pull Requests in Azure DevOps using OpenAI:

1. Fetches PR data from the Azure DevOps REST API (PR info, iterations, file changes, file content)
2. Calls OpenAI with **progressive skill/instruction loading** via function calling — the model loads only the skill files it needs
3. Posts review comments back to the Azure DevOps PR

### Project structure

```
.
├── azuredevops-openai-review.js       # Main script
├── src/
│   └── azure-client.js               # Azure DevOps API client (extracted for testability)
├── tests/
│   ├── mocks/
│   │   ├── azure-devops-pr-api.openapi.yaml      # OpenAPI 3.0 contract for Microcks
│   │   ├── azure-devops-pr-api.apiexamples.yaml  # Microcks example responses
│   │   └── azure-devops-pr-api.apimetadata.yaml  # Microcks dispatcher config
│   └── integration/
│       └── azure-devops-client.integration.test.js
├── docker-compose.test.yml            # Microcks for integration tests
└── package.json
```

## Usage

### Prerequisites

- Node.js 18+
- An Azure DevOps Personal Access Token with `Code (Read)` and `Pull Request Threads (Read & Write)` permissions
- An OpenAI API key

### Installation

```bash
npm install
```

### Environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `AZURE_DEVOPS_ORG` | Azure DevOps organization name |
| `AZURE_DEVOPS_PROJECT` | Project name |
| `AZURE_DEVOPS_REPO` | Git repository name |
| `AZURE_DEVOPS_PR_ID` | Pull Request number |
| `AZURE_DEVOPS_PAT` | Personal Access Token |

### Running the review

```bash
OPENAI_API_KEY=sk-... \
AZURE_DEVOPS_ORG=MyOrg \
AZURE_DEVOPS_PROJECT=MyProject \
AZURE_DEVOPS_REPO=MyRepo \
AZURE_DEVOPS_PR_ID=42 \
AZURE_DEVOPS_PAT=xxxx \
npm run review
```

### Context files (progressive loading)

Place custom guidelines in these directories — the model will load them on-demand via function calling:

- **`.github/skills/`** — Skill files (e.g. `coding-standards.md`, `security-rules.md`)
- **`.github/instruction/`** — Additional instructions (e.g. `review-guidelines.md`)

## Testing

### Prerequisites

- [Docker](https://www.docker.com/) (for Microcks)
- Node.js 18+

### Start Microcks (Azure DevOps API mock)

```bash
docker compose -f docker-compose.test.yml up -d
```

Microcks will start on `http://localhost:8585` and automatically import the mock files from `tests/mocks/`.

### Run all tests

```bash
npm test
```

### Run unit tests only (no Docker required)

```bash
npm run test:unit
```

### Run integration tests (requires Microcks)

```bash
npm run test:integration
```

The integration tests use [Microcks](https://microcks.io/) to mock the Azure DevOps REST API, allowing the `src/azure-client.js` module to be tested end-to-end without any real Azure DevOps dependency.