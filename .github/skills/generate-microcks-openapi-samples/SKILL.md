---
name: generate-microcks-openapi-samples
description: Use when creating OpenAPI mock examples for Microcks, setting up request/response routing with dispatchers, or mapping request fields to mock responses
---

# Generate Microcks OpenAPI Examples

Generate realistic, schema-compliant OpenAPI examples (request/response pairs) for Microcks mocks. All examples must be concrete and directly usable—no placeholders or generic values.

## When to Use

**Use when:**
- Building mock APIs with Microcks using realistic request/response examples
- Creating test data that matches real-world API behavior (not generic placeholders)
- Setting up multiple response scenarios for API testing (happy path, errors, edge cases)
- Configuring smart request routing (dispatching) based on request content
- Migrating from live APIs to mock endpoints while maintaining realistic behavior
- Creating reproducible test fixtures with concrete data

**Don't use when:**
- Modifying the OpenAPI contract file itself (examples go in separate metadata files)
- Creating mock data without an OpenAPI schema as source of truth
- Using generic/placeholder values (defeats purpose of realistic mocking)
- Static mock responses without routing logic
