# FocusLayer Frontend Handoff

## Base URL

- Local default: `http://localhost:3000`
- The actual deployed base URL should match `BETTER_AUTH_URL`

## Authentication

- Primary frontend auth flow uses:
  - `POST /auth/signup`
  - `POST /auth/login`
  - `GET /me`
- Both signup and login return a bearer token in the JSON response body.
- Send the token on every protected request:

```http
Authorization: Bearer <token>
```

- Protected routes do not use cookies from the frontend contract point of view.
- The server also mounts Better Auth at `/api/auth/*`, but the frontend does not need that surface for the product flows below.

## Shared Response Shapes

### User

```json
{
  "id": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
  "email": "user@example.com",
  "name": "Ash",
  "kbId": "kb_123"
}
```

### Document Metadata

```json
{
  "id": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "fileName": "biology-notes.pdf",
  "createdAt": "2026-04-19T10:15:00.000Z"
}
```

### Project

```json
{
  "id": "d43e3711-3fa4-4b1b-bfca-06e2f6f34a60",
  "userId": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
  "title": "Spring Semester",
  "createdAt": "2026-04-19T10:20:00.000Z"
}
```

### Task

```json
{
  "id": "2e68e20c-ecf8-4d14-b29e-fad5dcc7dfd9",
  "projectId": "d43e3711-3fa4-4b1b-bfca-06e2f6f34a60",
  "userId": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
  "title": "Finish reading chapter 3",
  "description": "Skim pages 40-55 first.",
  "status": "todo",
  "priority": "medium",
  "dueDate": "2026-04-20T09:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-04-19T10:25:00.000Z"
}
```

## Auth Routes

### `POST /auth/signup`

- Request body:

```json
{
  "email": "user@example.com",
  "password": "super-secure-password",
  "name": "Ash"
}
```

- Response body:

```json
{
  "token": "session-token-string",
  "user": {
    "id": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
    "email": "user@example.com",
    "name": "Ash",
    "kbId": "kb_123"
  }
}
```

- When to call:
  - Call when the user creates an account.
  - Store the returned `token` immediately.
  - The backend creates the user record, creates the user’s AutoSage knowledge base, stores `kbId`, then returns the authenticated session token.

### `POST /auth/login`

- Request body:

```json
{
  "email": "user@example.com",
  "password": "super-secure-password"
}
```

- Response body:

```json
{
  "token": "session-token-string",
  "user": {
    "id": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
    "email": "user@example.com",
    "name": "Ash",
    "kbId": "kb_123"
  }
}
```

- When to call:
  - Call on sign-in.
  - Replace any previous stored token with the new one.

### `GET /me`

- Auth required: yes
- Request body: none
- Response body:

```json
{
  "id": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
  "email": "user@example.com",
  "name": "Ash",
  "kbId": "kb_123"
}
```

- When to call:
  - Call on app boot after restoring a stored token.
  - Use this to validate the token and hydrate the current user session in the frontend.

## Document Routes

### `POST /documents/initiate-upload`

- Auth required: yes
- Request body:

```json
{
  "fileName": "biology-notes.pdf",
  "fileSizeBytes": 4203142
}
```

- Response body:

```json
{
  "presignedUrl": "https://autosage-upload.example.com/...",
  "documentId": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9"
}
```

- When to call:
  - Call once the user has chosen a PDF file to upload.
  - The backend creates a local document metadata record and requests an AutoSage presigned upload URL.

### `GET /documents`

- Auth required: yes
- Request body: none
- Response body:

```json
[
  {
    "id": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
    "fileName": "biology-notes.pdf",
    "createdAt": "2026-04-19T10:15:00.000Z"
  }
]
```

- When to call:
  - Call to populate the user’s document list.

### `GET /documents/:id`

- Auth required: yes
- Request body: none
- Response body:

```json
{
  "id": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "fileName": "biology-notes.pdf",
  "createdAt": "2026-04-19T10:15:00.000Z"
}
```

- When to call:
  - Call when reopening a specific document from saved state if you need to confirm it still exists.

### `DELETE /documents/:id`

- Auth required: yes
- Request body: none
- Response body: empty with HTTP `204`
- When to call:
  - Call when the user removes a document from their library.
  - This deletes backend metadata only. The backend does not manage PDF rendering bytes.

## Assistance Routes

All assistance routes are protected and are only called when the frontend has already detected a behavior pattern. The backend does not infer ADHD state or attention state on its own.

### `POST /assistance/summarise`

- Auth required: yes
- Request body for full summary:

```json
{
  "docId": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "scope": "full"
}
```

- Request body for partial summary:

```json
{
  "docId": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "scope": "partial",
  "pageNumbers": [4, 5, 6]
}
```

- Response body:

```json
{
  "summary": "Key ideas from the requested material..."
}
```

- When to call:
  - Call when the frontend detects overload or erratic scrolling and wants a document-level or page-range summary.

### `POST /assistance/explain-reread`

- Auth required: yes
- Request body:

```json
{
  "docId": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "pageNumber": 8,
  "regionBase64": "iVBORw0KGgoAAA..."
}
```

- Response body:

```json
{
  "explanation": "This section is saying that..."
}
```

- When to call:
  - Call when the frontend detects the user repeatedly rereading a specific region.
  - The backend OCRs the cropped region in memory and then asks AutoSage to explain the extracted text.
  - The image is never stored.

### `POST /assistance/check-distraction`

- Auth required: yes
- Request body:

```json
{
  "docId": "525d9f5c-b8af-4c8f-bcc8-81689fa7a6d9",
  "fullPageBase64": "iVBORw0KGgoAAA...",
  "regionImages": [
    "iVBORw0KGgoAAA...",
    "iVBORw0KGgoBBB..."
  ],
  "pageNumbers": [8]
}
```

- Response body:

```json
{
  "genuine": true,
  "reason": "One repeated region is a labeled diagram, so the user is likely referencing a visual element rather than drifting.",
  "pageNumbers": [8]
}
```

- When to call:
  - Call when the frontend sees repeated gaze jumps and wants to decide if that behavior is a valid visual-reference pattern or likely distraction.
  - The backend does not auto-chain to summary or explanation routes. The frontend decides what to do next.

## Projects and Tasks Routes

### `POST /projects`

- Auth required: yes
- Request body:

```json
{
  "title": "Spring Semester"
}
```

- Response body: `Project`
- When to call:
  - Call when a user creates a new board or project bucket.

### `GET /projects`

- Auth required: yes
- Request body: none
- Response body: `Project[]`
- When to call:
  - Call to hydrate the project list.

### `PATCH /projects/:id`

- Auth required: yes
- Request body:

```json
{
  "title": "Updated Project Title"
}
```

- Response body: `Project`
- When to call:
  - Call when the user renames a project.

### `DELETE /projects/:id`

- Auth required: yes
- Request body: none
- Response body: empty with HTTP `204`
- When to call:
  - Call when the user deletes a project.
  - All tasks in the project are deleted by cascade.

### `POST /projects/:projectId/tasks`

- Auth required: yes
- Request body:

```json
{
  "title": "Finish reading chapter 3",
  "description": "Skim pages 40-55 first.",
  "priority": "medium",
  "dueDate": "2026-04-20T09:00:00.000Z"
}
```

- Response body: `Task`
- When to call:
  - Call for standard manual task creation.

### `GET /projects/:projectId/tasks`

- Auth required: yes
- Optional query params:
  - `status=todo|in_progress|done`
  - `priority=low|medium|high`
- Response body: `Task[]`
- When to call:
  - Call when displaying tasks for one project.
  - Apply the optional filters from the UI if the board supports them.

### `GET /tasks/:id`

- Auth required: yes
- Request body: none
- Response body: `Task`
- When to call:
  - Call if a task detail screen needs the latest backend copy.

### `PATCH /tasks/:id`

- Auth required: yes
- Request body example:

```json
{
  "status": "done",
  "priority": "high",
  "dueDate": "2026-04-21T17:00:00.000Z"
}
```

- Response body: `Task`
- When to call:
  - Call for edits to title, description, status, priority, or due date.
  - If status becomes `done`, the backend sets `completedAt` automatically.

### `DELETE /tasks/:id`

- Auth required: yes
- Request body: none
- Response body: empty with HTTP `204`
- When to call:
  - Call when the user deletes a task.

## ADHD-Aware Task Helper Routes

### `POST /tasks/smart-create`

- Auth required: yes
- Request body:

```json
{
  "projectId": "d43e3711-3fa4-4b1b-bfca-06e2f6f34a60",
  "title": "Start chemistry notes cleanup",
  "description": "Need a first pass only.",
  "adhdState": "FATIGUED"
}
```

- Response body: `Task`
- When to call:
  - Call when the frontend wants the backend to create a task with AI-adjusted priority and due-date framing for a user who is drifting or fatigued.
  - The backend appends a short `[AI note]: ...` clarification to the description.

### `POST /tasks/reschedule-overdue`

- Auth required: yes
- Request body:

```json
{
  "adhdState": "FATIGUED"
}
```

- Response body:

```json
{
  "rescheduledCount": 2,
  "tasks": [
    {
      "id": "2e68e20c-ecf8-4d14-b29e-fad5dcc7dfd9",
      "projectId": "d43e3711-3fa4-4b1b-bfca-06e2f6f34a60",
      "userId": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
      "title": "Finish reading chapter 3",
      "description": "Skim pages 40-55 first.",
      "status": "todo",
      "priority": "medium",
      "dueDate": "2026-04-20T09:00:00.000Z",
      "completedAt": null,
      "createdAt": "2026-04-19T10:25:00.000Z"
    }
  ]
}
```

- When to call:
  - Call when the frontend has classified the user as `FATIGUED` and wants a one-shot reset of overdue unfinished tasks.

### `POST /tasks/shutdown-summary`

- Auth required: yes
- Request body:

```json
{
  "adhdState": "FOCUSED"
}
```

- Response body:

```json
{
  "completedToday": [],
  "pendingCount": 5,
  "dueTomorrow": [],
  "message": "You cleared meaningful work today, and tomorrow already has a clear shape. You can stop here without needing to hold the whole board in your head."
}
```

- When to call:
  - Call during end-of-day or session shutdown flow.
  - `adhdState` is accepted as a plain string here and is only used as prompt context for the message tone.

### `POST /tasks/drift-suggest`

- Auth required: yes
- Request body:

```json
{
  "adhdState": "DRIFTING"
}
```

- Response body:

```json
{
  "suggestedTask": {
    "id": "2e68e20c-ecf8-4d14-b29e-fad5dcc7dfd9",
    "projectId": "d43e3711-3fa4-4b1b-bfca-06e2f6f34a60",
    "userId": "caec1aa5-9f99-4269-9f61-7ceebb98f68f",
    "title": "Finish reading chapter 3",
    "description": "Skim pages 40-55 first.",
    "status": "todo",
    "priority": "medium",
    "dueDate": "2026-04-20T09:00:00.000Z",
    "completedAt": null,
    "createdAt": "2026-04-19T10:25:00.000Z"
  },
  "reason": "This is a manageable re-entry task with a clear first step and lower friction than the heavier items on the board."
}
```

- When to call:
  - Call when the user is drifting and the UI wants a single suggested restart task.

## Eye Route

### `POST /eye/token`

- Auth required: yes
- Request body: none

- Response body:

```json
{
  "token": "gaze-session-token",
  "expiresIn": 3600
}
```

- When to call:
  - Call before initializing the eye-tracker hardware SDK or remote eye session.
  - The backend proxies the request to the external gaze service.
  - The backend sends `{ apiKey, metadata: { uuid } }` to the gaze service using the authenticated user id.
  - The frontend does not send request payload for this endpoint.

## ADHD State Contract

The frontend owns all classification logic.

Exact state strings used in the product:

- `FOCUSED`
- `DRIFTING`
- `HYPERFOCUSED`
- `FATIGUED`

Where the backend requires or consumes these values:

- `POST /tasks/smart-create`
  - accepts only `DRIFTING` or `FATIGUED`
- `POST /tasks/reschedule-overdue`
  - accepts only `FATIGUED`
- `POST /tasks/drift-suggest`
  - accepts only `DRIFTING`
- `POST /tasks/shutdown-summary`
  - accepts any string and uses it only as prompt context

Important:

- The backend never infers attention or ADHD state.
- Assistance routes do not require `adhdState`.
- All gaze, scroll, cursor, and attention classification remains fully client-side.

## Document Upload and Viewing Flow

1. Frontend calls `POST /documents/initiate-upload` with `fileName` and `fileSizeBytes`.
2. Backend returns `presignedUrl` and `documentId`.
3. Frontend uploads the PDF bytes directly to `presignedUrl` with a `PUT` request.
4. Frontend stores `documentId` locally.
5. Frontend uses its own local file or viewer source for rendering the PDF.
6. Frontend sends `documentId` to the assistance routes whenever it wants AutoSage-backed help.

Important:

- The backend stores metadata only.
- The backend does not store or serve the PDF bytes for rendering.

## AutoSage Chat Continuity

- The frontend never passes `chatId`.
- The frontend always passes `docId`.
- The backend stores `autosageChatId` per document metadata record.
- The first assistance request on a document creates or captures the AutoSage chat thread.
- Later assistance requests for the same document reuse that thread automatically.

This means:

- Summaries, reread explanations, and future document help remain context-aware per document.
- The frontend only needs to persist `documentId`.

## Eye Tracker Flow

1. Frontend calls `POST /eye/token` with no body.
2. Backend calls `POST {GAZE_BASE_URL}/api/gaze/token` with:

```json
{
  "apiKey": "<GAZE_API_KEY>",
  "metadata": {
    "uuid": "<authenticated-user-id>"
  }
}
```

3. Backend returns the external response body directly to the frontend.
4. Frontend passes the returned token payload into the eye-tracker SDK or backend integration.
4. All gaze data handling, scroll correlation, cursor telemetry, and ADHD state classification remain on the frontend.

## Unified Error Shape

All backend-controlled errors use this JSON format:

```json
{
  "error": "machine_readable_error",
  "code": "UPPER_SNAKE_CASE_CODE",
  "details": "optional-extra-context"
}
```

## Common HTTP Statuses

- `400` malformed request body, invalid due date, or validation failure
- `401` missing or invalid bearer token
- `404` resource not found or not owned by the current user
- `409` precondition issue such as `knowledge_base_not_ready`
- `502` upstream AI or AutoSage failure
- `503` eye backend unavailable

## Common Error Examples

### Validation failure

```json
{
  "error": "validation_error",
  "code": "VALIDATION_ERROR",
  "details": []
}
```

### Unauthorized

```json
{
  "error": "unauthorized",
  "code": "UNAUTHORIZED"
}
```

### Eye backend unavailable

```json
{
  "error": "gaze_backend_unavailable",
  "code": "GAZE_BACKEND_UNAVAILABLE"
}
```

### Missing knowledge base

```json
{
  "error": "knowledge_base_not_ready",
  "code": "KNOWLEDGE_BASE_NOT_READY"
}
```