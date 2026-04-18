import { groq } from "@ai-sdk/groq";
import { generateObject, generateText } from "ai";
import { z } from "zod";

import { taskPriorityValues, type TaskPriority, type TaskRecord } from "@/db/schema";
import { ApiError } from "@/utils/api-error";
import { endOfUtcDay, upcomingSundayEndUtc, tomorrowAtNineUtc } from "@/utils/dates";

const TASK_AI_MODEL = "llama-3.3-70b-versatile";

const smartCreateSchema = z.object({
  priority: z.enum(taskPriorityValues),
  dueDateHint: z.enum(["today", "tomorrow", "this_week"]),
  clarification: z.string().min(1),
});

const driftSuggestionSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
});

function dueDateFromHint(hint: "today" | "tomorrow" | "this_week", now: Date = new Date()): Date {
  switch (hint) {
    case "today":
      return endOfUtcDay(now);
    case "tomorrow":
      return tomorrowAtNineUtc(now);
    case "this_week":
      return upcomingSundayEndUtc(now);
  }
}

export async function getSmartTaskSuggestion(input: {
  title: string;
  description?: string;
  adhdState: "DRIFTING" | "FATIGUED";
}): Promise<{ priority: TaskPriority; dueDate: Date; clarification: string }> {
  try {
    const { object } = await generateObject({
      model: groq(TASK_AI_MODEL),
      schema: smartCreateSchema,
      prompt: [
        `User with ADHD is in ${input.adhdState}.`,
        `Task title: ${input.title}`,
        input.description ? `Task description: ${input.description}` : undefined,
        "Assign priority and a due date hint.",
        "Prefer low or medium priority when the user is fatigued.",
        "Provide one short clarification sentence for why this framing helps.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    return {
      priority: object.priority,
      dueDate: dueDateFromHint(object.dueDateHint),
      clarification: object.clarification.trim(),
    };
  } catch {
    throw new ApiError(502, "task_ai_failed", "TASK_AI_FAILED");
  }
}

export async function generateShutdownMessage(input: {
  adhdState: string;
  completedToday: Array<Pick<TaskRecord, "title">>;
  pendingCount: number;
  dueTomorrow: Array<Pick<TaskRecord, "title">>;
}): Promise<string> {
  try {
    const completedTitles = input.completedToday.map((task) => task.title);
    const dueTomorrowTitles = input.dueTomorrow.map((task) => task.title);

    const { text } = await generateText({
      model: groq(TASK_AI_MODEL),
      prompt: [
        "Write a short shutdown summary for a user with ADHD.",
        `Current frontend-reported state: ${input.adhdState}`,
        `Completed today (${completedTitles.length}): ${completedTitles.join(", ") || "none"}`,
        `Pending count: ${input.pendingCount}`,
        `Due tomorrow (${dueTomorrowTitles.length}): ${dueTomorrowTitles.join(", ") || "none"}`,
        "Constraints:",
        "- Under 3 sentences.",
        "- Warm and non-judgmental.",
        "- Do not use the word 'but'.",
        "- Do not shame the user.",
      ].join("\n"),
    });

    return text.trim();
  } catch {
    throw new ApiError(502, "task_ai_failed", "TASK_AI_FAILED");
  }
}

export async function getDriftSuggestion(
  tasks: Array<Pick<TaskRecord, "id" | "title" | "description" | "priority" | "dueDate">>,
): Promise<z.infer<typeof driftSuggestionSchema>> {
  try {
    const normalizedTasks = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    }));

    const { object } = await generateObject({
      model: groq(TASK_AI_MODEL),
      schema: driftSuggestionSchema,
      prompt: [
        "User is drifting.",
        "Pick a single best starting task that is not the hardest and not the most punishingly overdue.",
        "Prefer a quick win or a task that makes re-entry easy.",
        `Tasks: ${JSON.stringify(normalizedTasks)}`,
      ].join("\n"),
    });

    return object;
  } catch {
    throw new ApiError(502, "task_ai_failed", "TASK_AI_FAILED");
  }
}