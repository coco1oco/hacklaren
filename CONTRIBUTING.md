# Contributing to hacklaren

Thanks for your interest in contributing. This guide covers how to set up your environment and the conventions we follow.

## Development Setup

1. Fork and clone the repository.
2. Install dependencies with `npm install`.
3. Start the dev server with `npx expo start`.

## Branching

- Create a feature branch off `main`: `git checkout -b feature/short-description`
- Keep branches focused on a single change.

## Commit Messages

Follow a clear, conventional style:

```
<type>: <short summary>

<optional body>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## Pull Requests

- Describe what changed and why.
- Link related issues.
- Make sure the app builds and the linter passes before requesting review.

## Code Style

- Use the project's linter and formatter configuration.
- Prefer small, readable functions and clear naming.
- Keep components reusable and co-locate related files.

## Reporting Issues

Open an issue with:

- Steps to reproduce
- Expected vs. actual behavior
- Platform (iOS / Android / web) and device details
