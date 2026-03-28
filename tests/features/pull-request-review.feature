# language: en
Feature: Azure DevOps Pull Request Review
  As a member of a development team using automated code review
  I want the system to interact correctly with the Azure DevOps REST API
  So that code review comments are retrieved and posted accurately on pull requests

  Background:
    Given the Azure DevOps mock API is available for pull request "42"

  Scenario: Fetching information about an open pull request
    When I request the pull request information
    Then the pull request title should be "feat: add review automation"
    And the source commit id should be "abc123def456"

  Scenario: Listing files changed in a pull request
    When I request the list of changed files
    Then I should receive at least one changed file
    And the list of changed files should include "/src/app.js"
    And the list of changed files should include "/src/Service.cs"

  Scenario: Discovering the latest review iteration
    When I request the last iteration id
    Then the iteration id should be 1

  Scenario: Retrieving the content of a changed JavaScript file
    When I request the content of file "/src/app.js" at commit "abc123def456"
    Then the file content should not be empty

  Scenario: Retrieving the content of a changed C# file
    When I request the content of file "/src/Service.cs" at commit "abc123def456"
    Then the file content should not be empty

  Scenario: Posting a review comment on a specific file and line
    When I post a review comment on file "/src/app.js" at line 10 with message "Potential null-dereference"
    Then the review thread should be created successfully
    And the thread id should be 1001
    And the thread status should be "active"

  Scenario: Posting a general summary comment on the pull request
    When I post a general comment with message "Review complete — no critical issues found"
    Then the review thread should be created successfully
    And the thread id should be 1001
