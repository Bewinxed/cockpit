import { Elysia, t } from 'elysia';
import type { Db } from '@cockpit/db';
import type { CreateProjectData, UpdateProjectData } from '@cockpit/core';
import { projects, eq, desc, like } from '@cockpit/db';
import { generateId } from '@cockpit/core/utils';
import { getDashboardRegistry } from '../services';

/**
 * Project CRUD routes
 */
export function createProjectRoutes(db: Db) {
  // Note: Don't cache broadcast here - get fresh reference on each request
  // to avoid stale references after hot reload

  return new Elysia({ prefix: '/projects' })
    // List all projects
    .get(
      '/',
      async ({ query }) => {
        let dbQuery = db.select().from(projects).$dynamic();

        if (query.machineId) {
          dbQuery = dbQuery.where(eq(projects.machineId, query.machineId));
        }

        if (query.search) {
          dbQuery = dbQuery.where(like(projects.name, `%${query.search}%`));
        }

        dbQuery = dbQuery.orderBy(desc(projects.updatedAt));

        if (query.limit) {
          dbQuery = dbQuery.limit(parseInt(query.limit));
        }

        if (query.offset) {
          dbQuery = dbQuery.offset(parseInt(query.offset));
        }

        const results = await dbQuery;

        return {
          success: true,
          data: results.map(dbRowToProject),
          total: results.length,
        };
      },
      {
        query: t.Object({
          machineId: t.Optional(t.String()),
          search: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )

    // Get project by ID
    .get(
      '/:id',
      async ({ params, set }) => {
        const result = await db
          .select()
          .from(projects)
          .where(eq(projects.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Project not found',
          };
        }

        return {
          success: true,
          data: dbRowToProject(result[0]),
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Create a new project
    .post(
      '/',
      async ({ body }) => {
        const id = generateId();
        const now = new Date();

        const newProject = {
          id,
          name: body.name,
          description: body.description ?? null,
          rootPath: body.rootPath ?? null,
          machineId: body.machineId ?? null,
          settings: body.settings ? JSON.stringify(body.settings) : null,
          createdAt: now,
          updatedAt: now,
        };

        await db.insert(projects).values(newProject);

        const project = dbRowToProject(newProject);

        // Broadcast project creation
        getDashboardRegistry().broadcast('project:created', project);

        return {
          success: true,
          data: project,
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          description: t.Optional(t.String()),
          rootPath: t.Optional(t.String()),
          machineId: t.Optional(t.String()),
          settings: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      }
    )

    // Update a project
    .patch(
      '/:id',
      async ({ params, body, set }) => {
        // Check if project exists
        const existing = await db
          .select()
          .from(projects)
          .where(eq(projects.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Project not found',
          };
        }

        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (body.name !== undefined) updateData.name = body.name;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.rootPath !== undefined) updateData.rootPath = body.rootPath;
        if (body.machineId !== undefined) updateData.machineId = body.machineId;
        if (body.settings !== undefined) updateData.settings = JSON.stringify(body.settings);

        await db
          .update(projects)
          .set(updateData)
          .where(eq(projects.id, params.id));

        // Fetch updated project
        const result = await db
          .select()
          .from(projects)
          .where(eq(projects.id, params.id))
          .limit(1);

        const project = dbRowToProject(result[0]);

        // Broadcast project update
        getDashboardRegistry().broadcast('project:updated', project);

        return {
          success: true,
          data: project,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1 })),
          description: t.Optional(t.String()),
          rootPath: t.Optional(t.String()),
          machineId: t.Optional(t.String()),
          settings: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      }
    )

    // Delete a project
    .delete(
      '/:id',
      async ({ params, set }) => {
        // Check if project exists
        const existing = await db
          .select()
          .from(projects)
          .where(eq(projects.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Project not found',
          };
        }

        await db.delete(projects).where(eq(projects.id, params.id));

        // Broadcast project deletion
        getDashboardRegistry().broadcast('project:deleted', { id: params.id });

        return {
          success: true,
          data: { id: params.id, deleted: true },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}

/**
 * Convert database row to Project type
 */
function dbRowToProject(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rootPath: row.rootPath ?? undefined,
    machineId: row.machineId ?? undefined,
    settings: row.settings ? (typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
