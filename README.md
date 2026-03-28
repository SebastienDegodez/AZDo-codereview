# AZDo-codereview

Azure DevOps Code Review automation repository.

This repository contains tools, skills, and agents to automate and enhance code review workflows using AI.

---

## Overview

The main script (`azuredevops-openai-review.js`) :
1. Fetches Pull Request data from the Azure DevOps REST API (PR info, iterations, file changes, file content)
2. Calls OpenAI with **progressive skill loading** via function calling — the model requests skills only when needed
3. Posts review comments back to the Azure DevOps PR

---

## Usage

### Prerequisites

- Node.js ≥ 18
- An Azure DevOps Personal Access Token (PAT)
- An OpenAI API key

### Installation

```bash
npm install
```

### Environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `AZURE_DEVOPS_ORG` | Azure DevOps organisation name |
| `AZURE_DEVOPS_PROJECT` | Project name |
| `AZURE_DEVOPS_REPO` | Repository name |
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

### Context folders

- **`.github/skills/`** — Files describing project-specific competencies (e.g. `coding-standards.md`, `security-rules.md`). Skills are loaded **progressively** via OpenAI function calling — the model requests only the skills it needs to analyse the code.
- **`.github/instruction/`** — Additional instructions for the review (e.g. `review-guidelines.md`). These are injected into the system prompt at startup.

---

## Testing

### Prerequisites

- Docker (for Microcks)
- Node.js ≥ 18

### Start Microcks (Azure DevOps mock server)

```bash
docker compose -f docker-compose.test.yml up -d
```

Microcks will be available on **http://localhost:8585** and will automatically load the mock definitions from `tests/mocks/`.

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

The integration tests validate all Azure DevOps client functions against the Microcks mock:
- `getPRInfo()` — returns PR title and commit IDs
- `getLastIterationId()` — returns the latest iteration id
- `getPRChanges(iterationId)` — returns the list of changed files
- `getFileContent(filePath, commitId)` — returns file content (dispatched by `path` query param)
- `postComment(filePath, line, comment)` — posts a file-level thread (201)
- `postGeneralComment(comment)` — posts a general thread (201)

### Stop Microcks

```bash
docker compose -f docker-compose.test.yml down
```