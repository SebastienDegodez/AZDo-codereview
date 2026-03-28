# AZDo-codereview

<p align="center">
  <img src="https://github.com/user-attachments/assets/48aefc3b-a62d-4503-bd56-c3f8ad6492a1" alt="AzureDevOps OpenAI Review logo" width="400" />
</p>

Azure DevOps Code Review automation using OpenAI.

Automatically reviews pull requests in Azure DevOps by sending code changes to OpenAI and posting the findings as review comments.

## Prerequisites

- **Node.js 20+**
- **OpenAI API key** — [create one at platform.openai.com](https://platform.openai.com/api-keys)
- **Azure DevOps Personal Access Token (PAT)** — with `Code (Read)` and `Code (Read & write)` scopes

## Installation

Install globally to use the `azdo-codereview` CLI command:

```bash
npm install -g azdo-codereview
```

Or install locally as a development dependency in your project:

```bash
npm install --save-dev azdo-codereview
```

## Usage

### Environment Variables

The following environment variables must be set before running:

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key (or a GitHub token when using GitHub Models) |
| `OPENAI_BASE_URL` | *(optional)* Override the OpenAI base URL — set to `https://models.inference.ai.azure.com` for GitHub Models |
| `OPENAI_MODEL` | *(optional)* Model name to use — defaults to `gpt-4o` |
| `AZURE_DEVOPS_ORG` | Azure DevOps organisation name |
| `AZURE_DEVOPS_PROJECT` | Azure DevOps project name |
| `AZURE_DEVOPS_REPO` | Repository name |
| `AZURE_DEVOPS_PR_ID` | Pull request ID to review |
| `AZURE_DEVOPS_PAT` | Azure DevOps Personal Access Token |

### Running the Review

**Global installation:**

```bash
azdo-codereview
```

**Local installation (via npx):**

```bash
npx azdo-codereview
```

**Local installation (via npm script):**

Add to your `package.json`:

```json
{
  "scripts": {
    "review": "azdo-codereview"
  }
}
```

Then run:

```bash
npm run review
```

### Customising the Review with Skills and Instructions

Place optional configuration files in your repository:

- `.github/skills/` — Markdown skill files loaded by the AI reviewer (e.g. `clean-code.md`, `security.md`)
- `.github/instructions/` — Instruction files with `applyTo` front matter to target specific file patterns
- `.github/copilot-instructions.md` — Global system instructions for the AI reviewer

### Azure DevOps Pipeline Integration

Add a pipeline step to your `azure-pipelines.yml`:

```yaml
- script: |
    npm install -g azdo-codereview
    azdo-codereview
  displayName: "AI Code Review"
  env:
    OPENAI_API_KEY: $(OPENAI_API_KEY)
    AZURE_DEVOPS_ORG: $(AzureDevOpsOrg)    # pipeline variable — organisation name only (e.g. myorg)
    AZURE_DEVOPS_PROJECT: $(System.TeamProject)
    AZURE_DEVOPS_REPO: $(Build.Repository.Name)
    AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)
    AZURE_DEVOPS_PAT: $(System.AccessToken)
```

> **Note:** `AZURE_DEVOPS_ORG` must be the **organisation name only** (e.g. `myorg`), not the full collection URI. Define it as a pipeline variable. The pipeline must be triggered by a pull request for `AZURE_DEVOPS_PR_ID` to be set.

### Using GitHub Copilot (GitHub Models) as the LLM

Instead of a paid OpenAI API key you can use **[GitHub Models](https://github.com/marketplace/models)** — the OpenAI-compatible inference endpoint built into GitHub — with your existing GitHub token. This is particularly useful in GitHub-hosted pipelines where `GITHUB_TOKEN` is always available.

#### How it works

GitHub Models exposes an OpenAI-compatible REST API at:

```
https://models.inference.ai.azure.com
```

Because `azdo-codereview` wraps the official `openai` Node.js SDK, you only need to set two extra environment variables to point it at GitHub Models instead of `api.openai.com`:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Your GitHub Personal Access Token (classic or fine-grained) — or `$(GITHUB_TOKEN)` in pipelines |
| `OPENAI_BASE_URL` | `https://models.inference.ai.azure.com` |
| `OPENAI_MODEL` | Model name, e.g. `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` (see [available models](https://github.com/marketplace/models)) |

> **Note:** `OPENAI_MODEL` is optional and defaults to `gpt-4o` when not set.

#### Azure DevOps pipeline example (GitHub Models)

```yaml
- script: |
    npm install -g azdo-codereview
    azdo-codereview
  displayName: "AI Code Review (GitHub Models)"
  env:
    OPENAI_API_KEY: $(GITHUB_TOKEN)          # GitHub token — no separate OpenAI account needed
    OPENAI_BASE_URL: https://models.inference.ai.azure.com
    OPENAI_MODEL: gpt-4o
    AZURE_DEVOPS_ORG: $(AzureDevOpsOrg)
    AZURE_DEVOPS_PROJECT: $(System.TeamProject)
    AZURE_DEVOPS_REPO: $(Build.Repository.Name)
    AZURE_DEVOPS_PR_ID: $(System.PullRequest.PullRequestId)
    AZURE_DEVOPS_PAT: $(System.AccessToken)
```

> **Tip:** GitHub Models has generous free-tier rate limits for `gpt-4o-mini` — a good choice for high-volume PR reviews.

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
