import type { TaskRecord, TaskState } from "../types.js";

function id(): string {
  return `task-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTaskId(input: string): string {
  return input.trim().replace(/\s+/g, "");
}

export class TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();

  create(initialMessage = "accepted"): TaskRecord {
    const now = Date.now();
    const taskId = normalizeTaskId(id());
    const task: TaskRecord = {
      taskId,
      createdAt: now,
      updatedAt: now,
      state: "accepted",
      message: initialMessage,
      progress: 0,
      events: [{ id: 1, state: "accepted", progress: 0, message: initialMessage, final: false }],
    };
    this.tasks.set(taskId, task);
    return task;
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(normalizeTaskId(taskId));
  }

  update(
    taskId: string,
    state: TaskState,
    options: { progress?: number; message?: string; final?: boolean; result?: unknown } = {}
  ): TaskRecord | undefined {
    const canonical = normalizeTaskId(taskId);
    const task = this.tasks.get(canonical);
    if (!task) return undefined;

    task.state = state;
    task.updatedAt = Date.now();
    task.progress = options.progress ?? task.progress;
    task.message = options.message ?? task.message;
    if (options.result !== undefined) task.result = options.result;

    task.events.push({
      id: task.events.length + 1,
      state,
      progress: task.progress,
      message: task.message,
      final: Boolean(options.final),
    });
    return task;
  }
}
