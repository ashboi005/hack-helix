# Hack Helix

Hack Helix is an attention-aware learning platform built around gaze tracking, document assistance, and task support. At a high level, the project combines a browser-based study experience, a backend for auth and AI-powered assistance, a real-time gaze service, and a Python camera client that streams face-pose data.

The repository is organized as a multi-part system rather than a single app. Together, the pieces support:

- **PDF-based study workflows** with attention-aware prompts
- **YouTube/LMS learning flows**
- **Real-time gaze and calibration pipelines**
- **AI assistance for summarization and reread explanation**
- **Task/project management with ADHD-aware support features**
- **Authentication and per-user knowledge-base provisioning**

---

## High-Level Overview

The project is made up of four main layers:

1. **Frontend (`app/apps/gaze-frontend`)**  
   A Next.js application that provides the user-facing experience for login, calibration, PDF reading, YouTube-based learning, and workspace navigation.

2. **Application backend (`app/apps/server`)**  
   A Bun + Elysia API server that handles authentication, document metadata, assistance routes, task workflows, and integration with the knowledge-base / AI layer.

3. **Gaze core service (`gaze-core`)**  
   A dedicated real-time service for gaze token issuance, live preview websocket sessions, calibration state, MQTT bridging, and gaze-point solving/fusion.

4. **Native / Python gaze publisher (`gaze-application`)**  
   A Python desktop camera client that uses MediaPipe/OpenCV to estimate face pose and publish tracking data to MQTT for downstream gaze processing.

---

## Core Features

### 1. Attention-Aware PDF Reading
The PDF reader is one of the central user experiences in this repo.

From the codebase, the PDF workspace supports:

- Uploading PDF files through a backend-initiated upload flow
- Selecting previously known documents
- Rendering PDFs in-browser
- Tracking recent coordinate windows while the user reads
- Detecting behavioral reading modes such as:
  - reading
  - rereading
  - scanning
  - distraction
- Triggering AI assistance based on detected behavior
- Capturing gaze evidence snapshots for context-aware assistance

The frontend logic suggests that the system keeps a recent attention window and uses it to decide when to:

- summarize the whole document,
- explain a reread region,
- or classify repeated gaze movement as meaningful visual reference vs distraction.

### 2. AI Study Assistance
The backend exposes assistance routes that support multiple study-oriented workflows.

Based on the repository, the assistance layer can:

- **Summarize a full document**
- **Summarize a subset of pages**
- **Explain a specific reread region** using OCR on a cropped image region
- **Summarize a single line/region** when the user seems distracted on a specific part of a page
- **Classify distraction vs genuine visual reference behavior**
- **Summarize YouTube videos** from transcript-based input

The implementation indicates a fast-query style integration with an AI/knowledge-base service and reuses document-linked chat continuity where available.

### 3. ADHD-Aware Task Support
The backend includes a task/project subsystem designed with behavior-aware flows.

Supported capabilities include:

- Creating and listing projects
- Creating, listing, updating, and deleting tasks
- Filtering tasks by status and priority
- AI-assisted smart task creation
- Rescheduling overdue tasks when the user is fatigued
- Generating shutdown summaries
- Suggesting a single “re-entry” task when the user is drifting

The code strongly suggests this subsystem is meant to reduce friction rather than just store todos. It adapts task creation and task suggestions based on attention-state labels such as drifting or fatigued.

### 4. Real-Time Gaze / Calibration Pipeline
A major part of Hack Helix is its gaze stack.

The repo contains:

- a browser calibration/setup flow,
- a gaze-core backend with websocket support,
- an MQTT bridge for live sensor-style updates,
- and a Python capture client.

From the code, the gaze system supports:

- issuing short-lived gaze access tokens,
- opening authenticated live preview websocket sessions,
- collecting calibration points,
- phase-zero / neutral / gyro snapshot flows,
- receiving gaze vectors,
- solving fused gaze points,
- and streaming live preview points back to the frontend.

This architecture separates the real-time tracking service from the main app backend, which is a good fit for low-latency interactive systems.

### 5. User Authentication and Session Management
Authentication is a first-class part of the platform.

The system supports:

- email/password sign-up and login,
- session retrieval,
- Better Auth-based auth handling,
- protected routes on the backend,
- frontend session hydration,
- and user-linked provisioning behavior.

One especially notable behavior: on sign-up/sign-in, the backend attempts to ensure the user has an associated knowledge base. That suggests each user gets a private or scoped AI context for assistance workflows.

### 6. YouTube / LMS Learning Workflow
The frontend contains a dedicated YouTube route and related components/hooks.

From the structure, this appears to support:

- searching or selecting YouTube content,
- loading videos into a learning view,
- attention-aware overlays/tracking in that experience,
- and backend-assisted summarization from transcript data.

The home hub labels this path as **LMS / YouTube Learning**, so this is clearly intended as a learning surface alongside the PDF reader.

---

## Repository Structure

A simplified view of the repository:

```text
hack-helix/
├── README.md
├── app/
│   ├── package.json
│   ├── apps/
│   │   ├── gaze-frontend/   # Next.js frontend
│   │   └── server/          # Bun + Elysia application backend
│   └── packages/
│       ├── auth/            # shared auth configuration / helpers
│       ├── config/          # shared TS config
│       ├── db/              # Drizzle schema + migrations
│       ├── env/             # typed/shared environment access
│       └── ui/              # reusable UI components
├── gaze-core/               # real-time gaze service
└── gaze-application/        # Python face-pose / MQTT publisher
```

---

## Tech Stack

### Frontend
Located primarily in `app/apps/gaze-frontend`.

- **Next.js 15**
- **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **Framer Motion**
- **Better Auth client integration**
- Custom gaze-related hooks and attention utilities
- In-browser PDF rendering via dynamically loaded PDF.js runtime

### Application Backend
Located in `app/apps/server`.

- **Bun** runtime
- **Elysia** web framework
- **TypeScript**
- **OpenAPI / Swagger** support
- **Drizzle ORM**
- **Zod** and typed validation schemas
- **Better Auth**
- AI integrations through service modules for:
  - summarization,
  - OCR-assisted explanation,
  - distraction classification,
  - YouTube transcript summarization,
  - ADHD-aware task assistance

### Gaze Core Service
Located in `gaze-core`.

- **Bun**
- **Elysia**
- **TypeScript**
- **Drizzle ORM**
- **JWT-like token/session handling for gaze access**
- **WebSocket support**
- **MQTT bridging**
- Calibration/gaze fusion/session-store logic

### Python Capture Client
Located in `gaze-application`.

- **Python**
- **OpenCV**
- **MediaPipe**
- **NumPy**
- **paho-mqtt**
- desktop auth dialog / auth client helpers
- face tracking and MQTT publishing

### Database / Shared Packages
Inside `app/packages`.

- **Drizzle ORM** with SQL migrations
- Shared auth package
- Shared env package
- Shared UI package
- Shared TypeScript config package

---

## Architectural Notes

### Monorepo Application Layer
The `app/` directory is a workspace-based monorepo. It contains:

- multiple apps,
- shared internal packages,
- workspace-level scripts,
- and a Bun lockfile.

This makes it easier to share:

- auth logic,
- database schema,
- environment handling,
- and UI building blocks.

### Separation of Concerns
The repo cleanly separates:

- **product/backend concerns** (auth, tasks, documents, AI routes),
- **real-time gaze infrastructure** (gaze-core),
- and **hardware/camera ingestion** (Python publisher).

That separation is one of the strongest signs that the project is designed as a real system rather than a quick prototype.

### AI + Behavioral Interface Design
A distinctive aspect of the codebase is that the AI workflows are not generic chatbot endpoints. They are tied to user behavior and learning context.

Examples include:

- summarizing when distraction is detected,
- explaining text when rereading is detected,
- suggesting a re-entry task when drifting,
- and generating shutdown summaries at the end of a session.

This gives the project a clear identity: it is an **attention-aware study/productivity assistant**, not just a gaze tracker.

---

## Notable Modules

### Frontend Pages
From the `src/app` structure, the frontend includes routes such as:

- `/login`
- `/pdf`
- `/youtube`
- `/calibrate`
- `/appliance`

These suggest the app supports both setup/diagnostics and end-user study workflows.

### Backend Modules
The server is organized into modules:

- `auth`
- `documents`
- `assistance`
- `eye`
- `tasks`

This modular split makes the backend easier to reason about and likely easier to evolve.

### Shared UI / UX Utilities
The frontend and package UI layer include reusable pieces for:

- buttons,
- cards,
- inputs,
- overlays,
- progress indicators,
- notification/sonner usage,
- and gaze-core setup widgets.

---

## What the Project Appears to Be Solving

From a product perspective, Hack Helix appears to target a specific problem space:

> Helping users stay engaged and supported while learning or working, especially in contexts where attention fluctuates.

It does this by combining:

- real-time motion / face-pose / gaze signals,
- document and video learning surfaces,
- AI summarization and explanation,
- and task-management support tuned to attention state.

That makes it especially relevant for:

- study tools,
- neurodivergent-friendly productivity experiences,
- focus coaching interfaces,
- or adaptive learning platforms.

---

## Development Notes

### Workspace Scripts
The monorepo root inside `app/` includes scripts for:

- running all apps in dev,
- building all apps,
- type-checking,
- and running DB tasks.

Examples from the repo include scripts for:

- `dev`
- `build`
- `check-types`
- `db:push`
- `db:studio`
- `db:generate`
- `db:migrate`

### Docker Support
Dockerfiles are present for multiple parts of the system, including:

- the frontend,
- the application backend,
- and gaze-core.

This suggests the project is intended to be deployable in containerized environments.

---

## Current State of the README

Before this file, the root of the repository did not have a strong project-level README describing how the pieces fit together. Some subprojects had their own local docs, but the overall architecture and feature story were fragmented.

This README is intended to provide that missing top-level explanation.

---

## Suggested Future README Improvements

If this project continues to evolve, good next additions would be:

- a full local setup guide for all services,
- an architecture diagram,
- environment variable documentation,
- MQTT topic conventions,
- end-to-end boot instructions,
- screenshots / demos of the PDF and YouTube workflows,
- and a deployment section describing how the services are expected to run together.

---

## Summary

Hack Helix is a multi-service attention-aware learning system that combines:

- **Next.js frontend UX**
- **Bun/Elysia backend APIs**
- **AI-powered assistance and summaries**
- **task management with ADHD-aware workflows**
- **real-time gaze processing**
- **Python-based camera / face-pose publishing**
- **MQTT-based event streaming**
- **Drizzle-based persistence and Better Auth integration**

Its strongest differentiator is that it uses behavioral signals not just for tracking, but to actively adapt the user experience through summaries, explanations, and task support.
