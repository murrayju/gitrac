# gitrac Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool and web UI for managing project issues as markdown files in git, shipping as a single Bun-compiled binary.

**Architecture:** Layered library — pure `core` (parse/serialize/validate), `git` (commit/amend/push/pull/conflict), `cli` (Commander.js commands), `web` (Hono API server + React/Tiptap SPA). All layers share the core types and functions.

**Tech Stack:** Bun, TypeScript, Commander.js, gray-matter, Hono, React, Vite, Tailwind CSS, Tiptap, simple-git, Biome.

**Spec:** `docs/specs/2026-03-28-gitrac-design.md`

---

## File Structure

```
gitrac/
├── bun                             # Bun bootstrap script (pinned version)
├── index.ts                        # CLI entry point
├── package.json
├── tsconfig.json
├── bunfig.toml
├── biome.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── scripts/
│   ├── build.ts                    # Build script (Vite + bun compile)
│   └── release.ts                  # Version bump + tag + push
├── .gitignore
├── .github/
│   └── workflows/
│       ├── check.yml               # CI: lint, typecheck, test
│       └── publish.yml             # Build binaries + GitHub release
│
├── src/
│   ├── core/
│   │   ├── types.ts                # Shared types (Issue, Config, Comment, Status, Priority)
│   │   ├── config.ts               # Config parsing/validation/serialization
│   │   ├── config.test.ts
│   │   ├── issue.ts                # Issue parsing/serialization (frontmatter + markdown)
│   │   ├── issue.test.ts
│   │   ├── comments.ts             # Comment parsing/serialization/escaping
│   │   ├── comments.test.ts
│   │   ├── slug.ts                 # Title -> filename slug utilities
│   │   ├── slug.test.ts
│   │   ├── validate.ts             # Validation (issues against config schema)
│   │   └── validate.test.ts
│   │
│   ├── git/
│   │   ├── operations.ts           # Core git ops (commit, amend, push, pull)
│   │   ├── operations.test.ts
│   │   ├── conflict.ts             # Issue-aware merge conflict resolution
│   │   ├── conflict.test.ts
│   │   ├── status.ts               # Branch detection, push state, warnings
│   │   ├── status.test.ts
│   │   ├── amend-tracker.ts        # Tracks amendable commit state
│   │   └── amend-tracker.test.ts
│   │
│   ├── fs/
│   │   ├── issue-store.ts          # Filesystem CRUD for issue files
│   │   └── issue-store.test.ts
│   │
│   ├── cli/
│   │   ├── index.ts                # Commander program setup + command registration
│   │   ├── output.ts               # Output formatting (human, json, yaml)
│   │   ├── output.test.ts
│   │   └── commands/
│   │       ├── init.ts
│   │       ├── create.ts
│   │       ├── list.ts
│   │       ├── show.ts
│   │       ├── edit.ts
│   │       ├── comment.ts
│   │       ├── close.ts
│   │       ├── reopen.ts
│   │       └── claim.ts
│   │
│   └── web/
│       ├── server.ts               # Hono app setup + static serving + SSE
│       ├── routes/
│       │   ├── issues.ts           # /api/issues/* routes
│       │   ├── issues.test.ts      # API integration tests
│       │   ├── config.ts           # /api/config route
│       │   ├── config.test.ts      # Config route tests
│       │   └── git.ts              # /api/git/status route
│       ├── watcher.ts              # File watcher + SSE event emitter
│       └── ui/
│           ├── index.html          # Vite entry HTML
│           ├── main.tsx            # React root
│           ├── App.tsx             # Router + layout
│           ├── api.ts              # API client (fetch wrapper)
│           ├── hooks.ts            # Custom React hooks (useIssues, useConfig, useSSE)
│           ├── components/
│           │   ├── Layout.tsx      # App shell (sidebar + content area)
│           │   ├── BranchWarning.tsx
│           │   ├── IssueList.tsx
│           │   ├── IssueRow.tsx
│           │   ├── IssueDetail.tsx
│           │   ├── IssueEditor.tsx # Tiptap editor for description
│           │   ├── CommentList.tsx
│           │   ├── CommentEditor.tsx
│           │   ├── MetadataPanel.tsx
│           │   ├── StatusBadge.tsx
│           │   ├── PriorityBadge.tsx
│           │   └── CreateIssueModal.tsx
│           └── styles/
│               └── globals.css     # Tailwind base + custom dark theme
│
└── docs/
    ├── specs/
    │   └── 2026-03-28-gitrac-design.md
    └── plans/
        └── 2026-03-28-gitrac-implementation.md
```

---

## Chunk 1: Project Scaffold + Core Data Layer

This chunk sets up the project from scratch and implements the pure data layer (types, parsing, serialization, validation). Everything is testable without git or filesystem.

### Task 1.1: Project Scaffold

**Files:**
- Create: `bun` (bootstrap script)
- Create: `index.ts` (entry point)
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `biome.json`
- Create: `.gitignore`

- [ ] **Step 1: Create the `./bun` bootstrap script**

Copy from ox project, updating the pinned version to latest stable Bun:

```bash
#!/bin/bash

version="bun-v1.3.11"
scriptDir="$(cd "$(dirname "$0")" && pwd)"
downloadDir="$scriptDir/download/bun/${version}"
bunCmd="$downloadDir/bin/bun"

if [ ! -f "$bunCmd" ]; then
    echo Installing bun to "$bunCmd"
    bashArgs=()
    if [ "$version" != "latest" ]; then
        bashArgs=(-s "$version")
    fi
    curl -fsSL https://bun.sh/install | BUN_INSTALL="$downloadDir" bash "${bashArgs[@]}"
fi

exec "$bunCmd" "$@"
```

Make it executable: `chmod +x bun`

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "gitrac",
  "version": "0.1.0",
  "license": "MIT",
  "module": "index.ts",
  "type": "module",
  "bin": { "gitrac": "./index.ts" },
  "scripts": {
    "build": "./bun run scripts/build.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check",
    "test": "./bun test",
    "check": "./bun i --silent && ./bun run typecheck && ./bun run lint --write && ./bun run test"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "gray-matter": "^4.0.3",
    "hono": "^4.0.0",
    "simple-git": "^3.27.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.0",
    "@types/bun": "^1.3.0",
    "typescript": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

Follow ox conventions (strict, bundler resolution, no emit):

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["index.ts", "src/**/*"]
}
```

- [ ] **Step 4: Create `bunfig.toml`**

```toml
[test]
root = "src"
```

- [ ] **Step 5: Create `biome.json`**

Follow ox conventions:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.8/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
download/
dist/
bin/
*.tgz
.env
.env.*
.DS_Store
.idea
*.tsbuildinfo
coverage
```

- [ ] **Step 7: Create minimal `index.ts` entry point**

```typescript
#!/usr/bin/env bun
import { createProgram } from './src/cli/index.ts';

const program = createProgram();
program.parse();
```

- [ ] **Step 8: Run `./bun install` and verify it works**

Run: `./bun install`
Expected: Bun downloads (if needed), dependencies install successfully.

- [ ] **Step 9: Commit scaffold**

```bash
git add -A && git commit -m "chore: initial project scaffold"
```

---

### Task 1.2: Core Types

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Define all shared types**

```typescript
export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Comment {
  author: string;
  timestamp: string; // ISO 8601
  body: string; // raw markdown (unescaped)
}

export interface Issue {
  id: number;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string; // empty string if unassigned
  labels: string[]; // empty array if none
  created: string; // ISO 8601
  createdBy: string;
  updated: string; // ISO 8601
  description: string; // raw markdown
  comments: Comment[];
}

export interface IssueFrontmatter {
  id: number;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string; // empty string if unassigned
  labels: string[]; // empty array if none
  created: string;
  createdBy: string;
  updated: string;
}

export interface GitConfig {
  autoCommit: boolean;
  autoPush: boolean;
  commitPrefix: string;
  defaultBranch: string;
}

export interface Config {
  version: number;
  nextId: number;
  statuses: Status[];
  labels: string[];
  priorities: Priority[];
  defaultStatus: Status;
  defaultPriority: Priority;
  git: GitConfig;
}

export type OutputFormat = 'human' | 'json' | 'yaml';
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add core types"
```

---

### Task 1.3: Slug Utilities

**Files:**
- Create: `src/core/slug.ts`
- Create: `src/core/slug.test.ts`

- [ ] **Step 1: Write failing tests for slug generation**

Test cases:
- `slugify('Fix Login Timeout')` -> `'fix-login-timeout'`
- `slugify('Add dark mode!!!')` -> `'add-dark-mode'`
- `slugify('  Multiple   Spaces  ')` -> `'multiple-spaces'`
- `slugify('Special chars: @#$%')` -> `'special-chars'`
- `slugify('Already-slugged')` -> `'already-slugged'`
- `issueFilename(1, 'Fix Login Timeout')` -> `'1-fix-login-timeout.md'`
- `issueFilename(42, 'Add dark mode')` -> `'42-add-dark-mode.md'`
- `parseIssueId('1-fix-login-timeout.md')` -> `1`
- `parseIssueId('42-add-dark-mode.md')` -> `42`
- `parseIssueId('not-an-issue.md')` -> `null`

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/core/slug.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement slug utilities**

Functions to implement:
- `slugify(title: string): string` — lowercase, replace non-alphanumeric with hyphens, collapse multiple hyphens, trim
- `issueFilename(id: number, title: string): string` — `{id}-{slugify(title)}.md`
- `parseIssueId(filename: string): number | null` — extract leading integer from filename

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/core/slug.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add slug utilities for issue filenames"
```

---

### Task 1.4: Comment Parsing & Serialization

**Files:**
- Create: `src/core/comments.ts`
- Create: `src/core/comments.test.ts`

- [ ] **Step 1: Write failing tests for comment parsing**

Test cases:
- Parse a single comment with `### author — timestamp` header and body
- Parse multiple comments in sequence
- Parse a comment containing code fences
- Parse a comment with escaped headings (`\## Heading` -> `## Heading` in parsed body)
- Handle empty comments section (no `---` separator) -> empty array
- Handle comments section with no comments after the `---` -> empty array

- [ ] **Step 2: Write failing tests for comment serialization**

Test cases:
- Serialize a comment back to `### author — timestamp\n\nbody`
- Serialize a comment with headings in body -> escaped (`## Heading` -> `\## Heading`)
- Serialize a comment with all heading levels (`#` through `######`) -> all escaped
- Serialize a comment containing code fences -> unchanged (no escaping needed for fences)
- Round-trip: parse then serialize produces original text

- [ ] **Step 3: Run tests to verify they fail**

Run: `./bun test src/core/comments.test.ts`
Expected: All tests fail.

- [ ] **Step 4: Implement comment parsing**

Functions:
- `parseComments(commentsSection: string): Comment[]` — split on `### {author} — {timestamp}` pattern, unescape headings in body
- `unescapeCommentHeadings(body: string): string` — replace `\#` at start of line with `#`

- [ ] **Step 5: Implement comment serialization**

Functions:
- `serializeComments(comments: Comment[]): string` — join comments with `### author — timestamp\n\nbody`
- `escapeCommentHeadings(body: string): string` — replace `#` at start of line with `\#` (only in comment bodies, not in the `###` header)

- [ ] **Step 6: Run tests to verify they pass**

Run: `./bun test src/core/comments.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add comment parsing and serialization with heading escaping"
```

---

### Task 1.5: Issue Parsing & Serialization

**Files:**
- Create: `src/core/issue.ts`
- Create: `src/core/issue.test.ts`

- [ ] **Step 1: Write failing tests for issue parsing**

Test cases:
- Parse a complete issue file (frontmatter + description + comments) into an `Issue` object
- Parse an issue with no comments (no `---` separator after description)
- Parse an issue with empty description
- Parse an issue with headings in description (not escaped — description supports full markdown)
- Parse frontmatter fields correctly (id, title, status, priority, assignee, labels, dates)

- [ ] **Step 2: Write failing tests for issue serialization**

Test cases:
- Serialize an `Issue` object back to markdown with frontmatter
- Round-trip: parse then serialize produces semantically equivalent output
- Serialize an issue with comments (includes `---` separator)
- Serialize an issue with no comments (no trailing `---`)

- [ ] **Step 3: Run tests to verify they fail**

Run: `./bun test src/core/issue.test.ts`
Expected: All tests fail.

- [ ] **Step 4: Implement issue parsing**

Use `gray-matter` for frontmatter extraction. Split remaining content on first `---` to separate description from comments. Call `parseComments()` for the comments section.

Function: `parseIssue(markdown: string): Issue`

- [ ] **Step 5: Implement issue serialization**

Use `gray-matter` `stringify()` or manual YAML serialization for frontmatter. Append description, then `---` separator (if comments exist), then serialized comments.

Function: `serializeIssue(issue: Issue): string`

- [ ] **Step 6: Run tests to verify they pass**

Run: `./bun test src/core/issue.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add issue parsing and serialization"
```

---

### Task 1.6: Config Parsing & Validation

**Files:**
- Create: `src/core/config.ts`
- Create: `src/core/config.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Parse a valid config.yaml string into a `Config` object
- Serialize a `Config` object back to YAML
- Fail-fast on missing required fields (e.g., missing `nextId`)
- Fail-fast on invalid status values
- Fail-fast on invalid priority values
- Default values: if `git` section is missing, use defaults (`autoCommit: true`, `autoPush: false`, `commitPrefix: 'issue:'`, `defaultBranch: 'main'`)
- `createDefaultConfig()` returns a valid starting config

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/core/config.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement config parsing and validation**

Functions:
- `parseConfig(yaml: string): Config` — parse YAML, validate required fields, apply defaults
- `serializeConfig(config: Config): string` — serialize to YAML string
- `createDefaultConfig(): Config` — create a fresh config with sensible defaults
- `validateConfig(config: unknown): config is Config` — type guard with descriptive errors

Use Bun's built-in `YAML.parse()` / `YAML.stringify()` (no extra dependency needed).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/core/config.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add config parsing and validation"
```

---

### Task 1.7: Issue Validation

**Files:**
- Create: `src/core/validate.ts`
- Create: `src/core/validate.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Valid issue with all fields matching config constraints -> passes
- Issue with status not in `config.statuses` -> error
- Issue with priority not in `config.priorities` -> error
- Issue with labels not in `config.labels` -> warning (not error — labels are suggestive)
- Issue with missing required fields (id, title, status) -> error
- Issue with invalid date formats -> error

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/core/validate.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement validation**

Function: `validateIssue(issue: Issue, config: Config): ValidationResult`

Where `ValidationResult` is `{ valid: boolean; errors: string[]; warnings: string[] }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/core/validate.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add issue validation against config"
```

---

### Task 1.8: Run all core tests + lint + typecheck

- [ ] **Step 1: Run full check**

Run: `./bun run check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Commit any fixes**

---

## Chunk 2: Filesystem & Git Operations Layer

This chunk implements the I/O layers: reading/writing issue files from disk, and all git operations.

### Task 2.1: Issue Filesystem Store

**Files:**
- Create: `src/fs/issue-store.ts`
- Create: `src/fs/issue-store.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (use a temporary directory):
- `readConfig(dir)` — reads and parses `.issues/config.yaml`
- `writeConfig(dir, config)` — serializes and writes config
- `listIssueFiles(dir)` — returns filenames from `.issues/` (not `closed/`)
- `listClosedIssueFiles(dir)` — returns filenames from `.issues/closed/`
- `listAllIssueFiles(dir)` — returns both
- `findIssueFile(dir, id)` — finds file by ID prefix in both directories
- `readIssue(dir, id)` — reads and parses an issue file
- `writeIssue(dir, issue)` — serializes and writes issue file with correct name
- `moveToClose(dir, id)` — moves issue file to `closed/` subfolder
- `moveToReopen(dir, id)` — moves issue file from `closed/` back to root
- `initIssuesDir(dir)` — creates `.issues/` and `.issues/closed/` dirs and default config
- `initIssuesDir(dir)` when already exists — throws error
- `initIssuesDir(dir, { force: true })` when already exists — reinitializes
- `allocateNextId(dir)` — reads config, returns current `nextId`, increments and writes back

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/fs/issue-store.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement the issue store**

All functions operate on the filesystem using `Bun.file()`, `Bun.write()`, `fs.readdir()`, `fs.rename()`, etc. This layer calls into `core/` for parsing/serialization but handles all I/O.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/fs/issue-store.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add filesystem issue store"
```

---

### Task 2.2: Git Status & Branch Detection

**Files:**
- Create: `src/git/status.ts`
- Create: `src/git/status.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (use a temporary git repo):
- `getCurrentBranch(dir)` — returns the current branch name
- `getDefaultBranch(config)` — returns `config.git.defaultBranch`
- `isOnDefaultBranch(dir, config)` — returns `true` if on default branch
- `getBranchWarning(dir, config)` — returns warning string if not on default branch, null if on it
- `isPushed(dir)` — returns `true` if current branch has no unpushed commits
- `hasRemote(dir)` — returns `true` if a remote named `origin` exists
- `getGitRoot(dir)` — returns the root of the git repo, or throws if not in a git repo

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/git/status.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement using simple-git**

Use `simple-git` for all git queries. Each function accepts a directory path and returns the result.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/git/status.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add git status and branch detection"
```

---

### Task 2.3: Git Operations (Commit, Push, Pull)

**Files:**
- Create: `src/git/operations.ts`
- Create: `src/git/operations.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (use a temporary git repo):
- `commitIssueChange(dir, files, message)` — stages files and commits with message
- `commitIssueChange` with `autoCommit: false` — does nothing
- `pushIfConfigured(dir, config, flags)` — pushes when `autoPush: true`
- `pushIfConfigured` with `--push` flag — pushes regardless of config
- `pushIfConfigured` with `--no-push` flag — does not push regardless of config
- `pullRebase(dir)` — pulls with rebase

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/git/operations.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement git operations**

Use `simple-git` for all operations. Accept config + flags to determine push behavior (flag > config).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/git/operations.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add git commit and push operations"
```

---

### Task 2.4: Amend Tracker

**Files:**
- Create: `src/git/amend-tracker.ts`
- Create: `src/git/amend-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `AmendTracker.record(issueId, commitHash)` — stores the amendable state
- `AmendTracker.canAmend(issueId)` — returns `true` if same issue, commit hash matches HEAD, not pushed
- `AmendTracker.canAmend(differentIssueId)` — returns `false`
- `AmendTracker.canAmend()` after another commit was made — returns `false` (HEAD changed)
- `AmendTracker.clear()` — clears the tracked state
- `AmendTracker.amend(dir, files, message)` — amends the HEAD commit

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/git/amend-tracker.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement the amend tracker**

Class that holds `{ issueId, commitHash }` in memory. `canAmend()` verifies HEAD matches stored hash and branch is ahead of remote. `amend()` uses `git commit --amend`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/git/amend-tracker.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add amend tracker for web UI commit strategy"
```

---

### Task 2.5: Conflict Resolution

**Files:**
- Create: `src/git/conflict.ts`
- Create: `src/git/conflict.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (using raw text, no git needed):
- `mergeIssueFrontmatter(ours, theirs, base)` — per-field last-writer-wins
- `mergeComments(ours, theirs)` — union of both sides, sorted by timestamp, deduped
- `resolveIssueConflict(oursContent, theirsContent, baseContent)` — applies frontmatter + comment merge, returns resolved content or null if description conflicts

- [ ] **Step 2: Run tests to verify they fail**

Run: `./bun test src/git/conflict.test.ts`
Expected: All tests fail.

- [ ] **Step 3: Implement conflict resolution**

Uses core parsing to decompose issue files, then applies the merge strategy per section.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./bun test src/git/conflict.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add issue-aware merge conflict resolution"
```

---

### Task 2.6: Run all tests + lint + typecheck

- [ ] **Step 1: Run full check**

Run: `./bun run check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Commit any fixes**

---

## Chunk 3: CLI Layer

Implements all CLI commands as thin wrappers over core + git + fs layers.

### Task 3.1: Output Formatting

**Files:**
- Create: `src/cli/output.ts`
- Create: `src/cli/output.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `formatIssueList(issues, 'human')` — returns a table-formatted string
- `formatIssueList(issues, 'json')` — returns valid JSON array
- `formatIssueList(issues, 'yaml')` — returns valid YAML
- `formatIssueDetail(issue, 'human')` — returns formatted issue detail
- `formatIssueDetail(issue, 'json')` — returns valid JSON
- `formatIssueDetail(issue, 'yaml')` — returns valid YAML

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement output formatting**

Human-readable uses simple aligned columns for list, and full markdown rendering for detail. JSON uses `JSON.stringify`. YAML uses `YAML.stringify` (Bun built-in).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add output formatting (human, json, yaml)"
```

---

### Task 3.2: CLI Program Setup + Init Command

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/init.ts`

- [ ] **Step 1: Implement CLI program setup**

Create the Commander program with:
- Name: `gitrac`
- Description
- Version from package.json
- Global options: `-o <format>`, `--push`, `--no-push`, `--no-commit`, `--author <name>`, `--dir <path>`
- `--dir <path>` validation: resolve the path, verify it's within the git repo root (from `getGitRoot`). Error if outside.
- `--no-commit` flag: passed through to the git operations layer. When set, all git commit/push calls become no-ops.
- Default command (no subcommand) starts the web UI
- Register all subcommands with their aliases

- [ ] **Step 2: Implement `init` command**

Register with Commander, no aliases. Add `--force` flag.

The `init` command:
- Verifies we're in a git repo (via `getGitRoot`). Errors if not.
- Checks if `.issues/` already exists — errors with "Already initialized. Use --force to reinitialize." unless `--force` is set
- Creates `.issues/`, `.issues/closed/`, and `config.yaml` with defaults (via `createDefaultConfig()`)
- Auto-commits if configured (respects `--no-commit`)

- [ ] **Step 3: Test manually**

Run: `./bun index.ts init` in a test repo
Expected: `.issues/config.yaml` created with default content.

Run: `./bun index.ts init` again
Expected: Error "Already initialized."

Run: `./bun index.ts init --force`
Expected: Reinitializes successfully.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add CLI program setup and init command"
```

---

### Task 3.3: Create Command

**Files:**
- Create: `src/cli/commands/create.ts`

- [ ] **Step 1: Implement `create` command**

Register with Commander, add aliases `new` and `add`.

Flags: `--title/-t`, `--priority/-p`, `--labels/-l`, `--assignee/-a`, `--status/-s`

Logic:
- If `--title` provided, use non-interactive mode
- If no `--title`, use interactive mode (prompt for title, then optional fields)
- Read config, allocate next ID
- Set `assignee` to empty string if not provided, `labels` to `[]` if not provided
- Set `status` to `config.defaultStatus` if not provided, `priority` to `config.defaultPriority` if not provided
- Create the issue file with slugified filename
- Auto-commit with message: `{prefix} create #{id} - {title}` (respects `--no-commit`)
- Push if configured
- Output the created issue in the requested format

- [ ] **Step 2: Test manually**

Run: `./bun index.ts create -t "Test issue" -p high -l bug`
Expected: Creates `.issues/1-test-issue.md` with correct frontmatter.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add create command"
```

---

### Task 3.4: List Command

**Files:**
- Create: `src/cli/commands/list.ts`

- [ ] **Step 1: Implement `list` command (with alias `ls`)**

Register with Commander, add alias `ls`.

Flags: `--status`, `--assignee`, `--label`, `--priority`, `--sort`

Logic:
- Default (no `--status` flag): read issue files from `.issues/` only (open issues). This naturally excludes closed issues since they live in `.issues/closed/`.
- `--status <value>`: filter by specific status value(s). If the status implies closed (e.g., `done`, `cancelled`), also search `.issues/closed/`.
- `--status all`: read all issue files from both `.issues/` and `.issues/closed/`
- Apply additional filters (`--assignee`, `--label`, `--priority`) after reading
- Sort by the specified field (default: id ascending)
- Output in requested format

Print branch warning if not on default branch.

- [ ] **Step 2: Test manually**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add list command with filtering and sorting"
```

---

### Task 3.5: Show Command

**Files:**
- Create: `src/cli/commands/show.ts`

- [ ] **Step 1: Implement `show` command (with alias `view`)**

Register with Commander, add alias `view`.

Logic:
- Find issue by ID (searches both directories)
- Parse the issue file
- Output full detail in requested format

Print branch warning if not on default branch.

- [ ] **Step 2: Test manually**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add show command"
```

---

### Task 3.6: Edit Command

**Files:**
- Create: `src/cli/commands/edit.ts`

- [ ] **Step 1: Implement `edit` command**

Flags: `--status/-s`, `--priority/-p`, `--assignee/-a`, `--labels/-l`, `--title/-t`

Logic:
- Find and read the issue
- Apply each provided flag to the issue's frontmatter
- If title changed, rename the file (new slug)
- Update `updated` timestamp
- Write the issue back
- Auto-commit with message: `{prefix} update #{id} {field}={value} ...`
- Push if configured

- [ ] **Step 2: Test manually**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add edit command"
```

---

### Task 3.7: Comment Command

**Files:**
- Create: `src/cli/commands/comment.ts`

- [ ] **Step 1: Implement `comment` command (with alias `c`)**

Register with Commander, add alias `c`. Accepts comment body as argument or via stdin (for piping).

Logic:
- Find and read the issue
- Determine author (`--author` flag or `git config user.name`)
- Create comment with current timestamp
- Append comment to issue
- Update `updated` timestamp
- Write the issue back
- Auto-commit with message: `{prefix} comment on #{id}`
- Push if configured

- [ ] **Step 2: Test manually**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add comment command"
```

---

### Task 3.8: Close and Reopen Commands

**Files:**
- Create: `src/cli/commands/close.ts`
- Create: `src/cli/commands/reopen.ts`

- [ ] **Step 1: Implement `close` command**

Register with Commander, no alias (to avoid confusion with `claim`). Add optional `--cancelled` flag to set status to `cancelled` instead of `done`.

Logic:
- Find and read the issue
- Set status to `done` (or `cancelled` if `--cancelled` flag)
- Update `updated` timestamp
- Write the issue
- Move file to `.issues/closed/`
- Auto-commit with message: `{prefix} close #{id} - {title}` (respects `--no-commit`)
- Push if configured

- [ ] **Step 2: Implement `reopen` command**

Logic:
- Find issue in `.issues/closed/`
- Set status to `backlog` (or previous status if tracked)
- Update `updated` timestamp
- Write the issue
- Move file back to `.issues/`
- Auto-commit with message: `{prefix} reopen #{id} - {title}`
- Push if configured

- [ ] **Step 3: Test manually**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add close and reopen commands"
```

---

### Task 3.9: Claim Command

**Files:**
- Create: `src/cli/commands/claim.ts`

- [ ] **Step 1: Implement `claim` command**

Logic:
- Find and read the issue
- Set assignee to current user (`--author` flag or `git config user.name`)
- Set status to `in_progress`
- Update `updated` timestamp
- Write the issue back
- Auto-commit with message: `{prefix} claim #{id} ({user})`
- Push if configured

- [ ] **Step 2: Test manually**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add claim command"
```

---

### Task 3.10: CLI Integration Tests + Full Check

- [ ] **Step 1: Run all tests**

Run: `./bun run check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 2: Test the full CLI workflow manually**

```bash
./bun index.ts init
./bun index.ts create -t "First issue" -p high -l bug
./bun index.ts create -t "Second issue" -p medium -l feature
./bun index.ts ls
./bun index.ts show 1
./bun index.ts edit 1 -s in_progress -a murrayju
./bun index.ts comment 1 "Working on this now"
./bun index.ts claim 2
./bun index.ts close 1
./bun index.ts ls --status all
./bun index.ts reopen 1
```

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Commit any fixes**

---

## Chunk 4: Web Server + API

Implements the Hono server, REST API routes, file watcher, and SSE.

### Task 4.1: Hono Server Setup + Static Serving

**Files:**
- Create: `src/web/server.ts`

- [ ] **Step 1: Implement the Hono server**

Set up:
- Hono app with CORS middleware (for dev mode with Vite proxy)
- Static file serving for built React SPA assets
- SPA fallback: serve `index.html` for all non-API, non-static routes
- Listen on a configurable port (default: 3000)
- Print URL and branch warning on startup
- Export `startServer(options)` function

- [ ] **Step 2: Test server starts and responds**

Run: Start server, verify `http://localhost:3000` responds.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add Hono server with static file serving"
```

---

### Task 4.2: Issues API Routes

**Files:**
- Create: `src/web/routes/issues.ts`
- Create: `src/web/routes/issues.test.ts`

- [ ] **Step 1: Implement issue API routes**

Routes:
- `GET /api/issues` — list issues with query param filters (`status`, `assignee`, `label`, `priority`, `sort`)
- `GET /api/issues/:id` — get single issue by ID
- `POST /api/issues` — create issue (body: `{ title, priority?, labels?, assignee?, status?, description? }`)
- `PATCH /api/issues/:id` — update issue metadata (body: partial frontmatter fields)
- `POST /api/issues/:id/comments` — add comment (body: `{ body, author? }`)
- `PATCH /api/issues/:id/close` — close issue
- `PATCH /api/issues/:id/reopen` — reopen issue

All mutating routes:
- Auto-commit via git operations layer
- Use amend tracker for the amend-until-pushed strategy
- Return the updated issue as JSON

Error responses: `{ error: string }` with appropriate HTTP status codes (400, 404, 500).

- [ ] **Step 2: Write integration tests for API routes**

Create `src/web/routes/issues.test.ts` using Hono's test client (`app.request()`):
- Test `GET /api/issues` returns issue list
- Test `GET /api/issues/:id` returns single issue
- Test `POST /api/issues` creates an issue and returns it
- Test `PATCH /api/issues/:id` updates metadata
- Test `POST /api/issues/:id/comments` adds a comment
- Test `PATCH /api/issues/:id/close` closes and moves issue
- Test `PATCH /api/issues/:id/reopen` reopens issue
- Test 404 for non-existent issue ID
- Test 400 for invalid request body

Use a temporary directory with initialized `.issues/` for each test.

- [ ] **Step 3: Run tests to verify they pass**

Run: `./bun test src/web/routes/issues.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add issues API routes with tests"
```

---

### Task 4.3: Config and Git Status API Routes

**Files:**
- Create: `src/web/routes/config.ts`
- Create: `src/web/routes/git.ts`
- Create: `src/web/routes/config.test.ts`

- [ ] **Step 1: Implement config route**

`GET /api/config` — returns the parsed config as JSON.

- [ ] **Step 2: Implement git status route**

`GET /api/git/status` — returns:
```json
{
  "branch": "main",
  "defaultBranch": "main",
  "isDefaultBranch": true,
  "hasUnpushedCommits": false,
  "hasRemote": true
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add config and git status API routes"
```

---

### Task 4.4: File Watcher + SSE

**Files:**
- Create: `src/web/watcher.ts`

- [ ] **Step 1: Implement file watcher**

Watch `.issues/` directory (and `closed/` subdirectory) using `fs.watch`. Debounce events (100ms). On change, emit an event.

- [ ] **Step 2: Implement SSE endpoint**

`GET /api/events` — SSE stream. Sends `event: issues-changed` when the file watcher detects changes. Client reconnects automatically.

- [ ] **Step 3: Wire watcher into server**

Start the watcher when the server starts. Connect watcher events to SSE stream.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add file watcher and SSE for live updates"
```

---

### Task 4.5: Wire default command to start server

- [ ] **Step 1: Update CLI default action**

When `gitrac` is run with no subcommand, call `startServer()` with appropriate options.

- [ ] **Step 2: Test full server lifecycle**

Run: `./bun index.ts`
Expected: Server starts, API responds, SSE endpoint connects.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: wire default command to start web server"
```

---

### Task 4.6: Run all tests + check

- [ ] **Step 1: Run full check**

Run: `./bun run check`
Expected: All tests pass.

- [ ] **Step 2: Fix any issues, commit**

---

## Chunk 5: Web UI (React + Tiptap)

Implements the React SPA with Tiptap WYSIWYG editor.

### Task 5.1: Vite + React + Tailwind Setup

**Files:**
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/web/ui/index.html`
- Create: `src/web/ui/main.tsx`
- Create: `src/web/ui/styles/globals.css`

- [ ] **Step 1: Install web UI dependencies**

```bash
./bun add react react-dom @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder tiptap-markdown react-router-dom
./bun add -d vite @vitejs/plugin-react tailwindcss postcss autoprefixer @types/react @types/react-dom
```

- [ ] **Step 2: Configure Vite**

`vite.config.ts`:
- React plugin
- Root: `src/web/ui`
- Build output: `dist/ui`
- Dev server proxy: `/api` -> `http://localhost:3000`

- [ ] **Step 3: Configure Tailwind**

`tailwind.config.ts`:
- Content: `src/web/ui/**/*.{tsx,ts}`
- Dark mode: `class`
- Custom theme colors for status/priority badges

- [ ] **Step 4: Create entry files**

`index.html` — minimal HTML with `<div id="root">` and script tag.
`main.tsx` — React root render with router.
`globals.css` — Tailwind directives + dark theme variables.

- [ ] **Step 5: Verify dev server works**

Run: `./bun run vite --config vite.config.ts` (in one terminal) and `./bun index.ts` (in another)
Expected: Vite dev server serves the SPA, proxies API requests to the Bun server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Vite + React + Tailwind setup for web UI"
```

---

### Task 5.2: API Client + Hooks

**Files:**
- Create: `src/web/ui/api.ts`
- Create: `src/web/ui/hooks.ts`

- [ ] **Step 1: Implement API client**

Typed fetch wrapper:
- `fetchIssues(filters?)` -> `Issue[]`
- `fetchIssue(id)` -> `Issue`
- `createIssue(data)` -> `Issue`
- `updateIssue(id, data)` -> `Issue`
- `addComment(id, body, author?)` -> `Issue`
- `closeIssue(id)` -> `Issue`
- `reopenIssue(id)` -> `Issue`
- `fetchConfig()` -> `Config`
- `fetchGitStatus()` -> `GitStatus`

- [ ] **Step 2: Implement React hooks**

- `useIssues(filters?)` — fetches and caches issue list, refetches on SSE event
- `useIssue(id)` — fetches single issue, refetches on SSE event
- `useConfig()` — fetches config once
- `useGitStatus()` — fetches git status, refetches periodically
- `useSSE()` — connects to `/api/events`, triggers callbacks on events

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add API client and React hooks"
```

---

### Task 5.3: Layout + Router + Branch Warning

**Files:**
- Create: `src/web/ui/App.tsx`
- Create: `src/web/ui/components/Layout.tsx`
- Create: `src/web/ui/components/BranchWarning.tsx`

- [ ] **Step 1: Implement App with router**

Routes:
- `/` -> Issue list
- `/issues/:id` -> Issue detail
- `/new` -> Create issue

- [ ] **Step 2: Implement Layout**

Linear-inspired shell:
- Sidebar with nav links (Issues, + New Issue)
- Sidebar shows project name and current filters
- Main content area

- [ ] **Step 3: Implement BranchWarning**

Persistent yellow banner at top when `gitStatus.isDefaultBranch === false`. Shows branch name and warning text.

- [ ] **Step 4: Add theme toggle**

Add a dark/light theme toggle button in the sidebar footer. Store preference in `localStorage`. Default to dark. Apply via `class="dark"` on the `<html>` element (Tailwind dark mode strategy: `class`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add app layout, router, and branch warning"
```

---

### Task 5.4: Status & Priority Badges

**Files:**
- Create: `src/web/ui/components/StatusBadge.tsx`
- Create: `src/web/ui/components/PriorityBadge.tsx`

- [ ] **Step 1: Implement StatusBadge**

Colored pill/badge component. Colors:
- backlog: gray
- todo: blue
- in_progress: yellow/amber
- done: green
- cancelled: red

- [ ] **Step 2: Implement PriorityBadge**

Icon or colored indicator:
- urgent: red
- high: orange
- medium: yellow
- low: blue
- none: gray

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add status and priority badge components"
```

---

### Task 5.5: Issue List View

**Files:**
- Create: `src/web/ui/components/IssueList.tsx`
- Create: `src/web/ui/components/IssueRow.tsx`

- [ ] **Step 1: Implement IssueList**

Sortable/filterable table:
- Columns: ID, Title, Status, Priority, Assignee, Labels, Updated
- Click column headers to sort
- Filter controls at top (status, priority, assignee dropdowns)
- Click row to navigate to detail view
- Uses `useIssues()` hook

- [ ] **Step 2: Implement IssueRow**

Single table row with:
- ID number
- Title (truncated if long)
- StatusBadge — **clickable** to cycle/select status inline (dropdown on click)
- PriorityBadge — **clickable** to cycle/select priority inline (dropdown on click)
- Assignee name or empty — **clickable** to assign inline
- Label pills
- Relative time for updated date

Inline edits call `updateIssue` API immediately (same as detail view).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add issue list view"
```

---

### Task 5.6: Tiptap Issue Editor

**Files:**
- Create: `src/web/ui/components/IssueEditor.tsx`

- [ ] **Step 1: Install any remaining Tiptap extensions if needed**

Check if `@tiptap/starter-kit` + `tiptap-markdown` cover: headings, bold, italic, code, code blocks, lists, links, blockquotes, horizontal rules.

- [ ] **Step 2: Implement IssueEditor**

Tiptap WYSIWYG editor component:
- Initialize with issue description markdown (converted to Tiptap doc via `tiptap-markdown`)
- On change: debounce (500ms), serialize to markdown, call `updateIssue` API
- No toolbar — use keyboard shortcuts and slash commands (Linear style)
- Placeholder text when empty: "Describe the issue..."
- Clean, minimal styling matching the dark theme

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add Tiptap WYSIWYG issue editor"
```

---

### Task 5.7: Issue Detail View

**Files:**
- Create: `src/web/ui/components/IssueDetail.tsx`
- Create: `src/web/ui/components/MetadataPanel.tsx`
- Create: `src/web/ui/components/CommentList.tsx`
- Create: `src/web/ui/components/CommentEditor.tsx`

- [ ] **Step 1: Implement MetadataPanel**

Inline editable metadata:
- Status dropdown (shows StatusBadge, click to change)
- Priority dropdown (shows PriorityBadge, click to change)
- Assignee text input
- Labels: pill list with add/remove
- Each change calls `updateIssue` API immediately

- [ ] **Step 2: Implement CommentList**

Renders comments with:
- Author name and avatar placeholder (first letter)
- Timestamp (relative + absolute on hover)
- Rendered markdown body (read-only Tiptap instance or dangerouslySetInnerHTML with sanitized markdown)

- [ ] **Step 3: Implement CommentEditor**

Tiptap editor at the bottom of the detail view:
- Placeholder: "Add a comment..."
- Submit button
- On submit: call `addComment` API, clear the editor

- [ ] **Step 4: Implement IssueDetail**

Combines:
- Title (editable inline — click to edit, blur to save)
- MetadataPanel (sidebar or top bar)
- IssueEditor (description — WYSIWYG, auto-save)
- `---` separator
- CommentList
- CommentEditor
- Uses `useIssue(id)` hook

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add issue detail view with metadata, comments, and WYSIWYG editor"
```

---

### Task 5.8: Create Issue Modal/Page

**Files:**
- Create: `src/web/ui/components/CreateIssueModal.tsx`

- [ ] **Step 1: Implement CreateIssueModal**

Form with:
- Title input (required)
- Priority dropdown (default from config)
- Labels multi-select (options from config)
- Assignee input
- Description Tiptap editor (optional)
- Create button
- On create: call `createIssue` API, navigate to the new issue detail view

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add create issue modal"
```

---

### Task 5.9: Polish & Test Full Web UI

- [ ] **Step 1: Test the complete flow**

Start server, open browser:
- Create an issue via the UI
- Edit the description with the WYSIWYG editor
- Change status, priority, assignee via the metadata panel
- Add a comment
- Close the issue
- Verify issue moves to closed section in list
- Reopen the issue
- Verify git commits are created correctly

- [ ] **Step 2: Polish visual styling**

- Ensure dark theme looks clean
- Verify responsive behavior
- Test keyboard navigation

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: polish web UI styling and interactions"
```

---

### Task 5.10: Run all tests + check

- [ ] **Step 1: Run full check**

Run: `./bun run check`
Expected: All tests pass.

- [ ] **Step 2: Fix any issues, commit**

---

## Chunk 6: Build, Packaging & CI

### Task 6.1: Build Script

**Files:**
- Create: `scripts/build.ts`

- [ ] **Step 1: Implement build script**

Two-phase build:
1. Run Vite to build the React SPA to `dist/ui/` (`./bun run vite build --config vite.config.ts`)
2. Run `bun build --compile` on `index.ts` with the built UI assets embedded

**Asset embedding strategy:** Use Bun's compile-time file embedding. In `src/web/server.ts`, import the built asset directory using `new Bun.FileSystemRouter` or read files from a known relative path. At compile time, `bun build --compile` automatically bundles files referenced via `import` or `Bun.file()` with known paths. The build script should:
- Set a `__UI_DIST_DIR__` compile-time define pointing to the absolute path of `dist/ui/`
- In the server, use this to resolve static assets
- Alternatively, use Hono's `serveStatic` middleware with the `dist/ui/` directory, which `bun build --compile` will embed automatically when the path is statically analyzable

Accept flags: `--outfile`, `--target`, `--minify`, `--sourcemap`

- [ ] **Step 2: Test local build**

Run: `./bun run scripts/build.ts --outfile=./bin/gitrac`
Expected: Single binary at `./bin/gitrac`.

Run: `./bin/gitrac --help`
Expected: CLI help output.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add build script for single binary compilation"
```

---

### Task 6.2: Release Script

**Files:**
- Create: `scripts/release.ts`

- [ ] **Step 1: Implement release script**

Adapted from ox's `release.ts`:
- Validate clean working directory
- Validate on `main` branch and up to date
- Accept version bump type (`major`, `minor`, `patch`) or explicit version
- Update `package.json` version
- Commit as `release: v{version}`
- Create annotated tag
- Push with `--follow-tags`

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add release script"
```

---

### Task 6.3: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/check.yml`
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create check workflow**

Adapted from ox:
- Trigger: push to main, pull requests
- Steps: checkout, `./bun install`, lint, typecheck, test

- [ ] **Step 2: Create publish workflow**

Adapted from ox:
- Trigger: push of `v*` tags
- Matrix build: linux-x64, linux-arm64, darwin-arm64
- Build binaries using `scripts/build.ts`
- Create GitHub release with binaries

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add GitHub Actions CI/CD workflows"
```

---

### Task 6.4: Final Integration Test

- [ ] **Step 1: Run full check**

Run: `./bun run check`
Expected: All passes.

- [ ] **Step 2: Build the binary**

Run: `./bun run scripts/build.ts --outfile=./bin/gitrac`
Expected: Binary compiles successfully.

- [ ] **Step 3: Test the binary end-to-end**

```bash
cd /tmp && mkdir test-gitrac && cd test-gitrac && git init
/path/to/bin/gitrac init
/path/to/bin/gitrac create -t "Test issue" -p high
/path/to/bin/gitrac ls
/path/to/bin/gitrac show 1
/path/to/bin/gitrac close 1
/path/to/bin/gitrac   # starts web server
```

- [ ] **Step 4: Fix any issues, commit**
