import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { ApiError } from "@/utils/api-error";
import { tomorrowAtNineUtc } from "@/utils/dates";

import { generateShutdownMessage, getDriftSuggestion, getSmartTaskSuggestion } from "./tasks.ai.service";
import { tasksService } from "./tasks.service";

const projectSchema = t.Object({
  id: t.String({ format: "uuid" }),
  userId: t.String({ format: "uuid" }),
  title: t.String(),
  createdAt: t.Date(),
});

const taskSchema = t.Object({
  id: t.String({ format: "uuid" }),
  projectId: t.String({ format: "uuid" }),
  userId: t.String({ format: "uuid" }),
  title: t.String(),
  description: t.Union([t.String(), t.Null()]),
  status: t.Union([t.Literal("todo"), t.Literal("in_progress"), t.Literal("done")]),
  priority: t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")]),
  dueDate: t.Union([t.Date(), t.Null()]),
  completedAt: t.Union([t.Date(), t.Null()]),
  createdAt: t.Date(),
});

const uuidSchema = t.String({ format: "uuid" });

const projectBody = t.Object({
  title: t.String({ minLength: 1 }),
});

const projectParams = t.Object({
  id: uuidSchema,
});

const projectTaskParams = t.Object({
  projectId: uuidSchema,
});

const taskParams = t.Object({
  id: uuidSchema,
});

const taskCreateBody = t.Object({
  title: t.String({ minLength: 1 }),
  description: t.Optional(t.String({ minLength: 1 })),
  priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")])),
  dueDate: t.Optional(t.String({ format: "date-time" })),
});

const taskListQuery = t.Object({
  status: t.Optional(t.Union([t.Literal("todo"), t.Literal("in_progress"), t.Literal("done")])),
  priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")])),
});

const taskUpdateBody = t.Object({
  title: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.Union([t.Literal("todo"), t.Literal("in_progress"), t.Literal("done")])),
  priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")])),
  dueDate: t.Optional(t.String({ format: "date-time" })),
});

const smartCreateBody = t.Object({
  projectId: uuidSchema,
  title: t.String({ minLength: 1 }),
  description: t.Optional(t.String({ minLength: 1 })),
  adhdState: t.Union([t.Literal("DRIFTING"), t.Literal("FATIGUED")]),
});

const rescheduleBody = t.Object({
  adhdState: t.Literal("FATIGUED"),
});

const shutdownBody = t.Object({
  adhdState: t.String({ minLength: 1 }),
});

const driftBody = t.Object({
  adhdState: t.Literal("DRIFTING"),
});

const rescheduleResponse = t.Object({
  rescheduledCount: t.Number(),
  tasks: t.Array(taskSchema),
});

const shutdownResponse = t.Object({
  completedToday: t.Array(taskSchema),
  pendingCount: t.Number(),
  dueTomorrow: t.Array(taskSchema),
  message: t.String(),
});

const driftSuggestResponse = t.Object({
  suggestedTask: taskSchema,
  reason: t.String(),
});

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "invalid_due_date", "INVALID_DUE_DATE");
  }

  return parsed;
}

function appendAiClarification(description: string | undefined, clarification: string): string {
  const note = `[AI note]: ${clarification}`;
  return description ? `${description}\n\n${note}` : note;
}

export const tasksRoutes = new Elysia({ tags: ["Tasks"] })
  .use(authContextPlugin)
  .post(
    "/projects",
    ({ body, currentUser }) => tasksService.createProject(currentUser.id, body.title),
    {
      auth: true,
      body: projectBody,
      response: projectSchema,
      detail: {
        summary: "Create a project",
      },
    },
  )
  .get(
    "/projects",
    ({ currentUser }) => tasksService.listProjects(currentUser.id),
    {
      auth: true,
      response: t.Array(projectSchema),
      detail: {
        summary: "List projects",
      },
    },
  )
  .patch(
    "/projects/:id",
    ({ params, body, currentUser }) => tasksService.updateProject(params.id, currentUser.id, body.title),
    {
      auth: true,
      params: projectParams,
      body: t.Partial(projectBody),
      response: projectSchema,
      detail: {
        summary: "Update a project",
      },
    },
  )
  .delete(
    "/projects/:id",
    async ({ params, currentUser, set }) => {
      await tasksService.deleteProject(params.id, currentUser.id);
      set.status = 204;
      return undefined;
    },
    {
      auth: true,
      params: projectParams,
      response: {
        204: t.Null(),
      },
      detail: {
        summary: "Delete a project and its tasks",
      },
    },
  )
  .post(
    "/projects/:projectId/tasks",
    ({ params, body, currentUser }) =>
      tasksService.createTask(currentUser.id, params.projectId, {
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueDate: parseDate(body.dueDate),
      }),
    {
      auth: true,
      params: projectTaskParams,
      body: taskCreateBody,
      response: taskSchema,
      detail: {
        summary: "Create a task in a project",
      },
    },
  )
  .get(
    "/projects/:projectId/tasks",
    ({ params, query, currentUser }) => tasksService.listProjectTasks(currentUser.id, params.projectId, query),
    {
      auth: true,
      params: projectTaskParams,
      query: taskListQuery,
      response: t.Array(taskSchema),
      detail: {
        summary: "List tasks for a project",
      },
    },
  )
  .post(
    "/tasks/smart-create",
    async ({ body, currentUser }) => {
      const suggestion = await getSmartTaskSuggestion(body);

      return tasksService.createTask(currentUser.id, body.projectId, {
        title: body.title,
        description: appendAiClarification(body.description, suggestion.clarification),
        priority: suggestion.priority,
        dueDate: suggestion.dueDate,
      });
    },
    {
      auth: true,
      body: smartCreateBody,
      response: taskSchema,
      detail: {
        summary: "AI-assisted task creation for drifting or fatigued states",
      },
    },
  )
  .post(
    "/tasks/reschedule-overdue",
    async ({ currentUser }) => {
      const overdueTasks = await tasksService.getOverdueTasks(currentUser.id);

      if (overdueTasks.length === 0) {
        return {
          rescheduledCount: 0,
          tasks: [],
        };
      }

      const nextDueDate = tomorrowAtNineUtc();
      const updatedTasks = await tasksService.rescheduleTasks(
        currentUser.id,
        overdueTasks.map((task) => task.id),
        nextDueDate,
      );

      return {
        rescheduledCount: updatedTasks.length,
        tasks: updatedTasks,
      };
    },
    {
      auth: true,
      body: rescheduleBody,
      response: rescheduleResponse,
      detail: {
        summary: "Reschedule overdue tasks to tomorrow morning when the user is fatigued",
      },
    },
  )
  .post(
    "/tasks/shutdown-summary",
    async ({ body, currentUser }) => {
      const summary = await tasksService.getShutdownSummary(currentUser.id);

      const message = await generateShutdownMessage({
        adhdState: body.adhdState,
        completedToday: summary.completedToday,
        pendingCount: summary.pendingCount,
        dueTomorrow: summary.dueTomorrow,
      });

      return {
        ...summary,
        message,
      };
    },
    {
      auth: true,
      body: shutdownBody,
      response: shutdownResponse,
      detail: {
        summary: "Generate a shutdown summary for the current task state",
      },
    },
  )
  .post(
    "/tasks/drift-suggest",
    async ({ currentUser }) => {
      const incompleteTasks = await tasksService.listIncompleteTasks(currentUser.id);

      const fallbackTask = incompleteTasks[0];

      if (!fallbackTask) {
        throw new ApiError(404, "no_incomplete_tasks", "NO_INCOMPLETE_TASKS");
      }

      const suggestion = await getDriftSuggestion(incompleteTasks);
      const suggestedTask = incompleteTasks.find((task) => task.id === suggestion.taskId) ?? fallbackTask;

      return {
        suggestedTask,
        reason:
          suggestedTask.id === suggestion.taskId
            ? suggestion.reason
            : "Suggested a quick re-entry task based on the current task list.",
      };
    },
    {
      auth: true,
      body: driftBody,
      response: driftSuggestResponse,
      detail: {
        summary: "Suggest a single re-entry task when the user is drifting",
      },
    },
  )
  .get(
    "/tasks/:id",
    ({ params, currentUser }) => tasksService.getTask(params.id, currentUser.id),
    {
      auth: true,
      params: taskParams,
      response: taskSchema,
      detail: {
        summary: "Get a single task",
      },
    },
  )
  .patch(
    "/tasks/:id",
    ({ params, body, currentUser }) =>
      tasksService.updateTask(params.id, currentUser.id, {
        title: body.title,
        description: body.description,
        status: body.status,
        priority: body.priority,
        dueDate: parseDate(body.dueDate),
      }),
    {
      auth: true,
      params: taskParams,
      body: taskUpdateBody,
      response: taskSchema,
      detail: {
        summary: "Update a task",
      },
    },
  )
  .delete(
    "/tasks/:id",
    async ({ params, currentUser, set }) => {
      await tasksService.deleteTask(params.id, currentUser.id);
      set.status = 204;
      return undefined;
    },
    {
      auth: true,
      params: taskParams,
      response: {
        204: t.Null(),
      },
      detail: {
        summary: "Delete a task",
      },
    },
  );