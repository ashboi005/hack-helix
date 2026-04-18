import { Elysia } from "elysia";
import { z } from "zod";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { taskPriorityValues, taskStatusValues } from "@/db/schema";
import { ApiError } from "@/utils/api-error";
import { tomorrowAtNineUtc } from "@/utils/dates";

import { generateShutdownMessage, getDriftSuggestion, getSmartTaskSuggestion } from "./tasks.ai.service";
import { tasksService } from "./tasks.service";

const uuidSchema = z.string().uuid();

const projectBody = z.object({
  title: z.string().min(1),
});

const projectParams = z.object({
  id: uuidSchema,
});

const projectTaskParams = z.object({
  projectId: uuidSchema,
});

const taskParams = z.object({
  id: uuidSchema,
});

const taskCreateBody = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: z.string().min(1).optional(),
});

const taskListQuery = z.object({
  status: z.enum(taskStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
});

const taskUpdateBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: z.enum(taskStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: z.string().min(1).optional(),
});

const smartCreateBody = z.object({
  projectId: uuidSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  adhdState: z.enum(["DRIFTING", "FATIGUED"]),
});

const rescheduleBody = z.object({
  adhdState: z.literal("FATIGUED"),
});

const shutdownBody = z.object({
  adhdState: z.string().min(1),
});

const driftBody = z.object({
  adhdState: z.literal("DRIFTING"),
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
      body: projectBody.partial(),
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
      detail: {
        summary: "Delete a task",
      },
    },
  );