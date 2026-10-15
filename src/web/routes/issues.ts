import { type Context, Hono } from 'hono';
import { describeDependencies, indexIssues } from '../../core/dependencies.ts';
import { GitracError } from '../../core/errors.ts';
import { parseIssueFile } from '../../core/issue.ts';
import { type IssueQuery, parseIssueQuery } from '../../core/query.ts';
import type { Issue } from '../../core/types.ts';
import { readIssueContent } from '../../fs/issue-store.ts';
import { issuePath } from '../../service/context.ts';
import { deleteIssue } from '../../service/delete.ts';
import { IssueUnreadableError, ValidationError } from '../../service/errors.ts';
import {
  addComment,
  closeIssue,
  createIssue,
  deleteComment,
  editComment,
  type IssueChange,
  reopenIssue,
  updateIssue,
} from '../../service/issues.ts';
import { linkIssue, unlinkIssue } from '../../service/links.ts';
import { listIssues, loadAllIssues } from '../../service/list.ts';
import type { Precondition } from '../../service/load.ts';
import { ifMatchSatisfied, issueETag } from '../etag.ts';
import { mutationLock } from '../lock.ts';
import { asRecord, readJsonBody } from '../request-body.ts';
import type { ServerContext } from '../server.ts';
import { webServiceContext } from '../service-context.ts';
import { serverIdentity } from './identity.ts';

/** An issue as currently on disk, with its version (ETag) and location. */
interface LoadedIssue {
  issue: Issue;
  etag: string;
  filename: string;
  closed: boolean;
}

/** Whether `err` reports several files for one issue ID. */
function isDuplicateIssue(err: unknown): err is GitracError {
  return err instanceof GitracError && err.code === 'duplicate_issue';
}

/** 409 `{ error, code: "duplicate_issue", files }`. */
function duplicateResponse(c: Context, err: GitracError): Response {
  return c.json(
    { error: err.message, code: err.code, files: err.details?.files ?? [] },
    409,
  );
}

/** Whether `err` reports a malformed issue file. */
function isInvalidIssue(err: unknown): err is GitracError {
  return err instanceof GitracError && err.code === 'invalid_issue';
}

/** 409 `{ error, code: "invalid_issue", file }`. */
function invalidIssueResponse(c: Context, err: GitracError): Response {
  return c.json(
    { error: err.message, code: err.code, file: err.details?.file },
    409,
  );
}

/**
 * Read + parse an issue and compute its ETag; null if missing/unreadable.
 * Throws `duplicate_issue` if several files have the ID and `invalid_issue`
 * if its file is malformed.
 */
async function loadIssue(dir: string, id: number): Promise<LoadedIssue | null> {
  try {
    const raw = await readIssueContent(dir, id);
    if (!raw) return null;
    const path = issuePath(raw.filename, raw.closed);
    return {
      issue: parseIssueFile(raw.content, { id, path }),
      etag: issueETag(raw.content),
      filename: raw.filename,
      closed: raw.closed,
    };
  } catch (err) {
    if (isDuplicateIssue(err) || isInvalidIssue(err)) throw err;
    return null;
  }
}

/** Thrown by the `If-Match` precondition when the issue has changed. */
class PreconditionFailed extends Error {}

/**
 * Optimistic concurrency for a mutation of an existing issue. `precondition`
 * runs inside the service operation, under the repo lock, on the issue as
 * loaded: it remembers that version (for error responses) and aborts if the
 * request's `If-Match` doesn't match its ETag.
 */
function ifMatchGuard(c: Context): {
  precondition: Precondition;
  current: () => LoadedIssue | undefined;
} {
  let current: LoadedIssue | undefined;
  return {
    precondition: (stored) => {
      current = {
        issue: structuredClone(stored.issue),
        etag: issueETag(stored.content),
        filename: stored.filename,
        closed: stored.closed,
      };
      if (!ifMatchSatisfied(c.req.header('If-Match'), current.etag)) {
        throw new PreconditionFailed();
      }
    },
    current: () => current,
  };
}

/**
 * Map an error from a service operation to its HTTP response, or rethrow it
 * (-> 500). `current` is the issue version the operation loaded, if any.
 *
 * - `If-Match` mismatch: 409 `{ error, current }` (+ its ETag)
 * - `invalid_state` (already closed / already open): 409
 *   `{ error, code, current }` (+ its ETag), nothing written
 * - field validation: 400 `{ error, errors }`; other bad input: 400 `{ error }`
 * - missing or unreadable issue, comment index out of range: 404 `{ error }`
 * - several files for the issue ID: 409 `{ error, code, files }`
 * - malformed issue file: 409 `{ error, code: "invalid_issue", file }`
 */
function errorResponse(
  c: Context,
  err: unknown,
  current?: LoadedIssue,
): Response {
  if (err instanceof PreconditionFailed && current) {
    c.header('ETag', current.etag);
    return c.json(
      {
        error: `Issue #${current.issue.id} was modified since it was loaded`,
        current: current.issue,
      },
      409,
    );
  }
  if (err instanceof ValidationError) {
    return c.json({ error: err.errors.join('; '), errors: err.errors }, 400);
  }
  if (err instanceof IssueUnreadableError) {
    return c.json({ error: `Issue #${err.id} not found` }, 404);
  }
  if (isDuplicateIssue(err)) return duplicateResponse(c, err);
  if (isInvalidIssue(err)) return invalidIssueResponse(c, err);
  if (err instanceof GitracError) {
    if (err.code === 'invalid_state' && current) {
      c.header('ETag', current.etag);
      return c.json(
        { error: err.message, code: err.code, current: current.issue },
        409,
      );
    }
    if (err.code === 'invalid_input') {
      return c.json({ error: err.message }, 400);
    }
    if (err.code === 'not_found') {
      return c.json({ error: err.message }, 404);
    }
  }
  throw err;
}

/**
 * Respond with the issue as now on disk (exactly what a later GET returns)
 * plus its ETag, so clients can chain `If-Match` writes. Falls back to the
 * in-memory issue if it can't be re-read.
 */
async function respondWithIssue(
  c: Context,
  dir: string,
  issue: Issue,
  status: 200 | 201 = 200,
): Promise<Response> {
  const loaded = await loadIssue(dir, issue.id).catch(() => null);
  if (!loaded) return c.json(issue, status);
  c.header('ETag', loaded.etag);
  return c.json(loaded.issue, status);
}

export function issueRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  // Serialize every mutation (in-process queue + cross-process lockfile)
  const locked = mutationLock(ctx);

  // GET /issues — list issues with optional filters (same semantics as
  // `gitrac ls`; see `src/core/query.ts`)
  app.get('/issues', async (c) => {
    const { dir, config } = ctx;
    const q = (name: string): string[] | undefined => c.req.queries(name);
    let query: IssueQuery;
    try {
      query = parseIssueQuery(
        {
          status: q('status'),
          assignee: q('assignee'),
          label: q('label'),
          priority: q('priority'),
          search: q('search') ?? q('q'),
          sort: q('sort'),
        },
        config,
        {
          mine: isTruthy(c.req.query('mine'))
            ? await serverIdentity(ctx)
            : undefined,
        },
      );
    } catch (err) {
      return errorResponse(c, err);
    }
    const { issues } = await listIssues(dir, query, config);
    return c.json(issues);
  });

  // GET /issues/:id — get a single issue
  app.get('/issues/:id', async (c) => {
    const { dir } = ctx;
    const id = Number.parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }

    let loaded: LoadedIssue | null;
    try {
      loaded = await loadIssue(dir, id);
    } catch (err) {
      if (isDuplicateIssue(err)) return duplicateResponse(c, err);
      if (isInvalidIssue(err)) return invalidIssueResponse(c, err);
      throw err;
    }
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    c.header('ETag', loaded.etag);
    return c.json(loaded.issue);
  });

  /**
   * Run a service mutation on an existing issue (with `If-Match`) and reply
   * with the issue as written, or the mapped error.
   */
  async function mutateIssue(
    c: Context,
    run: (precondition: Precondition) => Promise<IssueChange>,
    status: 200 | 201 = 200,
  ): Promise<Response> {
    const guard = ifMatchGuard(c);
    try {
      const result = await run(guard.precondition);
      ctx.config = result.config;
      return respondWithIssue(c, ctx.dir, result.issue, status);
    } catch (err) {
      return errorResponse(c, err, guard.current());
    }
  }

  // POST /issues — create a new issue. `author` (optional) is the identity
  // picked in the UI; default: the server's git identity.
  app.post('/issues', locked, async (c) => {
    const body = await readJsonBody(c);
    return mutateIssue(
      c,
      () =>
        createIssue(webServiceContext(ctx), body, {
          author: asRecord(body).author,
        }),
      201,
    );
  });

  // PATCH /issues/:id — update issue metadata
  app.patch('/issues/:id', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const body = await readJsonBody(c);
    return mutateIssue(c, (precondition) =>
      updateIssue(webServiceContext(ctx), id, body, { precondition }),
    );
  });

  // DELETE /issues/:id — delete an issue (and the assets only it references),
  // remove links to it from other issues, and commit the removal. Honors
  // `If-Match`. Replies `{ deleted: true, issue, paths, assets, unlinked }`
  // with the issue as it was.
  app.delete('/issues/:id', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const guard = ifMatchGuard(c);
    try {
      const result = await deleteIssue(webServiceContext(ctx), id, {
        precondition: guard.precondition,
      });
      ctx.config = result.config;
      return c.json({
        deleted: true,
        issue: result.issue,
        paths: result.paths,
        assets: result.assets,
        unlinked: result.unlinked,
      });
    } catch (err) {
      return errorResponse(c, err, guard.current());
    }
  });

  // POST /issues/:id/comments — add a comment
  app.post('/issues/:id/comments', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const { body, author } = asRecord(await readJsonBody(c));
    return mutateIssue(c, (precondition) =>
      addComment(webServiceContext(ctx), id, body, { author, precondition }),
    );
  });

  // PUT /issues/:id/comments/:commentIndex — edit a comment
  app.put('/issues/:id/comments/:commentIndex', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    const commentIndex = Number.parseInt(c.req.param('commentIndex'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    if (Number.isNaN(commentIndex) || commentIndex < 0) {
      return c.json({ error: 'Invalid comment index' }, 400);
    }
    const { body } = asRecord(await readJsonBody(c));
    return mutateIssue(c, (precondition) =>
      editComment(webServiceContext(ctx), id, commentIndex, body, {
        precondition,
      }),
    );
  });

  // DELETE /issues/:id/comments/:commentIndex — delete a comment
  app.delete('/issues/:id/comments/:commentIndex', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    const commentIndex = Number.parseInt(c.req.param('commentIndex'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    if (Number.isNaN(commentIndex) || commentIndex < 0) {
      return c.json({ error: 'Invalid comment index' }, 400);
    }
    return mutateIssue(c, (precondition) =>
      deleteComment(webServiceContext(ctx), id, commentIndex, {
        precondition,
      }),
    );
  });

  // PATCH /issues/:id/close — close an issue. Optional JSON body
  // `{ status }` (a configured closed status) or `{ cancelled: true }` (the
  // configured cancel status); default: the configured close status (done).
  app.patch('/issues/:id/close', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const { status, cancelled } = asRecord(await readJsonBody(c));
    return mutateIssue(c, (precondition) =>
      closeIssue(webServiceContext(ctx), id, {
        status: status ?? undefined,
        cancelled: cancelled === true,
        precondition,
      }),
    );
  });

  // PATCH /issues/:id/reopen — reopen a closed issue. Optional JSON body
  // `{ status }` picks the status (default: config.defaultStatus).
  app.patch('/issues/:id/reopen', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const { status } = asRecord(await readJsonBody(c));
    return mutateIssue(c, (precondition) =>
      reopenIssue(webServiceContext(ctx), id, {
        status: status ?? undefined,
        precondition,
      }),
    );
  });

  // GET /issues/:id/dependencies — the issue's parent, sub-issues, blockers
  // and the issues it blocks (derived), each `{ id, title, status, resolved }`
  // (`status: null` for a missing issue), plus `blocked`.
  app.get('/issues/:id/dependencies', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    let loaded: LoadedIssue | null;
    try {
      loaded = await loadIssue(ctx.dir, id);
    } catch (err) {
      if (isDuplicateIssue(err)) return duplicateResponse(c, err);
      throw err;
    }
    if (!loaded) {
      return c.json({ error: `Issue #${id} not found` }, 404);
    }
    const byId = indexIssues((await loadAllIssues(ctx.dir)).issues);
    byId.set(id, loaded.issue);
    return c.json(describeDependencies(loaded.issue, byId, ctx.config));
  });

  // POST /issues/:id/link — `{ blockedBy?: id | id[], parent?: id }`: add
  // blockers / set the parent. 400 if a target is missing, the issue itself,
  // or the link would create a cycle. Honors `If-Match`.
  app.post('/issues/:id/link', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const body = await readJsonBody(c);
    return mutateIssue(c, (precondition) =>
      linkIssue(webServiceContext(ctx), id, body, { precondition }),
    );
  });

  // POST /issues/:id/unlink — `{ blockedBy?: id | id[], parent?: true }`:
  // remove blockers / clear the parent. Honors `If-Match`.
  app.post('/issues/:id/unlink', locked, async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid issue ID' }, 400);
    }
    const body = await readJsonBody(c);
    return mutateIssue(c, (precondition) =>
      unlinkIssue(webServiceContext(ctx), id, body, { precondition }),
    );
  });

  return app;
}

/** A boolean query flag: present and not `0` / `false` / `no`. */
function isTruthy(value: string | undefined): boolean {
  return (
    value !== undefined && !['0', 'false', 'no'].includes(value.toLowerCase())
  );
}
