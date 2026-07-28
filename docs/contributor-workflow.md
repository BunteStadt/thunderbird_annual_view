# Contributor workflow

## 1. Development environment

This repository is intentionally lightweight. There is no build pipeline required for the current add-on experience; development is mostly done through direct file editing, local browser testing, and manual Thunderbird testing.

Recommended setup:

- use a dedicated Thunderbird profile for extension testing
- use a local simple web server for standalone HTML testing when the Thunderbird runtime is not needed
- keep the current add-on behavior intact while extracting shared logic

## 2. Local development options

### Thunderbird-based testing

Use a dedicated profile and install the add-on from a generated XPI package or from a local unpacked extension when supported by your setup.

### Standalone HTML development

The standalone page can be used for faster iteration and debugging. It supports dummy data via the URL parameter `?dummy=1` and is useful for validating rendering behavior without the Thunderbird environment.

## 3. GitHub workflows and CI

The repository uses GitHub Actions for build, test, lint, and release automation:

- [build.yml](../.github/workflows/build.yml) builds the XPI package and uploads it as a workflow artifact.
- [ci-tests.yml](../.github/workflows/ci-tests.yml) runs the repository test suite with Node.js via `node --test`.
- [linter.yml](../.github/workflows/linter.yml) builds the XPI, runs the Thunderbird web extension linter, and publishes the report.
- [release.yml](../.github/workflows/release.yml) builds the XPI, generates sample images, and publishes a draft release when a version tag is pushed.

When changing manifest behavior, release packaging, or any shared calendar logic, verify the relevant workflow expectations and, where possible, test locally before pushing.

## 4. Workflow expectations

### Before changing behavior

- read the relevant module and confirm the current interaction flow
- understand the user-visible behavior that should be preserved
- note whether the change affects the addon shell, shared calendar logic, or the UI renderer

### When implementing a feature

- update the smallest relevant module first
- keep platform-specific code isolated from shared logic
- add or update tests where the behavior is meaningful and stable
- document public contracts if a module becomes shared across hosts

### When changing UI behavior

- verify the new experience in both light and dark themes where relevant
- ensure the view remains readable and accessible
- confirm that filters and navigation still behave consistently

## 5. Testing expectations

The repository currently uses manual and test-file-based validation rather than a large automated suite. When possible:

- prefer regression tests for shared domain logic
- verify UI behavior manually in the browser or Thunderbird
- validate filter and rendering changes with dummy data first

## 6. Coding standards

- use modern JavaScript syntax where compatible with the current environment
- keep functions and modules focused and readable
- avoid introducing bundlers or heavy dependencies unless the monorepo migration explicitly requires them
- preserve naming conventions already used in the repository
- add comments for non-obvious logic, especially around Thunderbird-specific behavior

## 7. Documentation expectations

Any meaningful change should include documentation updates when it affects:

- user-visible behavior
- the architecture boundary between shared and platform-specific logic
- development workflow or release steps
- the planned monorepo transition

## 8. Release and packaging

Release work should follow the existing conventions in the repository:

- update the version when a user-visible change is ready for release
- ensure the packaged build remains consistent with the current manifest and source layout
- test the resulting package manually before publishing

## 9. Recommended PR checklist

Before submission, confirm:

- the change is scoped and easy to review
- the relevant docs are updated
- behavior remains correct in the current add-on flow
- no unnecessary platform-specific logic was introduced into a shared module
- the change does not block the future monorepo extraction plan
