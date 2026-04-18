import { and, count, desc, eq, gte, lt, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { projects, tasks, type TaskPriority, type TaskStatus } from "@/db/schema";
import { ApiError } from "@/utils/api-error";
import { startOfUtcDay, tomorrowRangeUtc } from "@/utils/dates";

type CreateTaskInput = {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: Date;
};

type UpdateTaskInput = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date;
};

async function getOwnedProject(projectId: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) {
    throw new ApiError(404, "project_not_found", "PROJECT_NOT_FOUND");
  }

  return project;
}

async function getOwnedTask(taskId: string, userId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!task) {
    throw new ApiError(404, "task_not_found", "TASK_NOT_FOUND");
  }

  return task;
}

async function createProject(userId: string, title: string) {
  const [project] = await db
    .insert(projects)
    .values({
      userId,
      title,
    })
    .returning();

  if (!project) {
    throw new ApiError(500, "project_creation_failed", "PROJECT_CREATION_FAILED");
  }

  return project;
}

function listProjects(userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

async function updateProject(projectId: string, userId: string, title?: string) {
  await getOwnedProject(projectId, userId);

  if (!title) {
    return getOwnedProject(projectId, userId);
  }

  const [project] = await db
    .update(projects)
    .set({ title })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  if (!project) {
    throw new ApiError(500, "project_update_failed", "PROJECT_UPDATE_FAILED");
  }

  return project;
}

async function deleteProject(projectId: string, userId: string): Promise<void> {
  await getOwnedProject(projectId, userId);
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

async function createTask(userId: string, projectId: string, input: CreateTaskInput) {
  await getOwnedProject(projectId, userId);

  const [task] = await db
    .insert(tasks)
    .values({
      projectId,
      userId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
    })
    .returning();

  if (!task) {
    throw new ApiError(500, "task_creation_failed", "TASK_CREATION_FAILED");
  }

  return task;
}

async function listProjectTasks(
  userId: string,
  projectId: string,
  filters: { status?: TaskStatus; priority?: TaskPriority },
) {
  await getOwnedProject(projectId, userId);

  const conditions = [eq(tasks.userId, userId), eq(tasks.projectId, projectId)];

  if (filters.status) {
    conditions.push(eq(tasks.status, filters.status));
  }

  if (filters.priority) {
    conditions.push(eq(tasks.priority, filters.priority));
  }

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt));
}

function getTask(taskId: string, userId: string) {
  return getOwnedTask(taskId, userId);
}

async function updateTask(taskId: string, userId: string, input: UpdateTaskInput) {
  const existingTask = await getOwnedTask(taskId, userId);

  const updates: Partial<typeof tasks.$inferInsert> = {
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate,
  };

  if (input.status === "done") {
    updates.completedAt = new Date();
  } else if (input.status && existingTask.status === "done") {
    updates.completedAt = null;
  }

  const [task] = await db
    .update(tasks)
    .set(updates)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();

  if (!task) {
    throw new ApiError(500, "task_update_failed", "TASK_UPDATE_FAILED");
  }

  return task;
}

async function deleteTask(taskId: string, userId: string): Promise<void> {
  await getOwnedTask(taskId, userId);
  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
}

function getOverdueTasks(userId: string, now: Date = new Date()) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), ne(tasks.status, "done"), lt(tasks.dueDate, now)))
    .orderBy(desc(tasks.createdAt));
}

async function rescheduleTasks(userId: string, taskIds: string[], dueDate: Date) {
  if (taskIds.length === 0) {
    return [];
  }

  const updatedTasks = await Promise.all(
    taskIds.map((taskId) =>
      db
        .update(tasks)
        .set({ dueDate })
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning()
        .then((rows) => rows[0]),
    ),
  );

  return updatedTasks.filter((task): task is NonNullable<typeof task> => Boolean(task));
}

function listIncompleteTasks(userId: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), ne(tasks.status, "done")))
    .orderBy(desc(tasks.createdAt));
}

async function getShutdownSummary(userId: string, now: Date = new Date()) {
  const todayStart = startOfUtcDay(now);
  const tomorrowRange = tomorrowRangeUtc(now);

  const [pendingResult] = await db
    .select({ value: count() })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), ne(tasks.status, "done")));

  const completedToday = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.completedAt, todayStart)))
    .orderBy(desc(tasks.completedAt));

  const dueTomorrow = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        gte(tasks.dueDate, tomorrowRange.start),
        lt(tasks.dueDate, tomorrowRange.end),
      ),
    )
    .orderBy(desc(tasks.createdAt));

  return {
    completedToday,
    pendingCount: pendingResult?.value ?? 0,
    dueTomorrow,
  };
}

export const tasksService = {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getOverdueTasks,
  getOwnedProject,
  getOwnedTask,
  getShutdownSummary,
  getTask,
  listIncompleteTasks,
  listProjectTasks,
  listProjects,
  rescheduleTasks,
  updateProject,
  updateTask,
};