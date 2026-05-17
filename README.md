# Drag & Drop Sign — BoldSign-Like Embedded Signing API

A lean, high-performance, and production-ready **API-first** e-signature core featuring embedded multi-file document request sessions, recipient-validated signing links, real-time properties metadata, sequential signing workflows, and visual drag-and-drop document design.

---

## ⚡ Key Features

- **Consolidated BoldSign APIs**: All redundant legacy routes removed; clean, high-performance, key-secured core.
- **Embedded Multi-File Upload & Merge**: Seamlessly uploads multiple PDFs, merging them instantly into a single unified signing document using `pdf-lib`.
- **Tri-Column Drag & Drop UI**: Beautiful, premium, hosted layout featuring interactive left tools panel, center high-performance pointer-event tracking canvas, and dynamic right properties manager.
- **Real-Time Auditing**: Traceable events logs (e.g. created, viewed, signed) compiled into detailed audit trails.
- **Visual Signature Polish**: Renders signatures as transparent permanent images (`dataUrl`) upon signing completion.
- **Sleek Swagger API Tool**: Built-in, zero-dependency interactive documentation sandbox with an elegant, responsive dark-mode layout at `/docs` or `/swagger`.

---

## 🛠️ Stack & Infrastructure

- **Backend Core**: Node.js + TypeScript + Express 5
- **Database Schema**: SQLite + Prisma ORM (relations optimized; unused schemas/models cleaned up)
- **Local Storage**: Storage-key mapped PDF store (`FILE_STORAGE_DIR`)
- **PDF Core Engine**: `pdf-lib` for robust programmatic merging, page counting, and flat canvas signature drawing.

---

## 🚀 Quick Start

### 1. Configure Environments
Create a `.env` file in the project root:
```bash
cp .env.example .env
```

### 2. Install & Migrate Database
Bootstrap local SQLite database, auto-compile client schemas, run migrations, and seed credentials:
```bash
npm install
npm run db:generate
npm run db:migrate
node prisma/seed.mjs
```

#### 🔑 Why run `node prisma/seed.mjs`?
The database seed script is essential to run because it:
1. **Initializes the Organization**: Creates your base organization (`Demo Org`) in the SQLite database.
2. **Generates the API Access Token**: Creates and hashes the default API key (`dev_live_replace_me`) inside the database, enabling secure access. You **must** provide this key in the `x-api-key` header to authenticate your requests against the `/v1/*` endpoints.

### 3. Start Development Server
```bash
npm run dev
```

---

## 🌐 Active API Reference (v1)

All endpoints under `/v1/*` require the following header:
```http
x-api-key: dev_live_replace_me
```

### Interactive Sandbox
Open `http://localhost:3000/docs/` (or `/swagger`) in your browser to view the interactive, fully pre-authorized **Swagger Sandbox** to test endpoints in real time.

---

### 1. Create Embedded Request Session
- **Path**: `POST /v1/embed/sessions/create-request-url`
- **Purpose**: Generates a dynamic hosted workflow URL to upload, configure, and place drag-and-drop fields.
- **Headers**: `x-api-key: dev_live_replace_me`
- **Request Body (JSON)**:
```json
{
  "title": "Commercial Agreement",
  "message": "Terms and duration of the contract.",
  "files": [],
  "signers": []
}
```
- **Response**:
```json
{
  "documentId": "cmp9dvhzd000oi5cnjy3yla19",
  "sendUrl": "http://localhost:3000/embed/request?token=..."
}
```

---

### 2. Get Embedded Signing Link
- **Path**: `GET /v1/document/getEmbeddedSignLink`
- **Purpose**: Generates a secure, recipient-validated signing link.
- **Parameters**:
  - `documentId` (string, required)
  - `signerEmail` (string, required)
  - `redirectUrl` (string, optional)
- **Response**:
```json
{
  "signLink": "http://localhost:3000/embed/sign?token=..."
}
```

---

### 3. Get Document Properties
- **Path**: `GET /v1/document/properties`
- **Purpose**: Retrieves all metadata, file order, signer statuses, field geometries, and historical audit logs.
- **Parameters**:
  - `documentId` (string, required)
- **Response**:
```json
{
  "documentId": "cmp9dvhzd000oi5cnjy3yla19",
  "messageTitle": "Test Agreement",
  "status": "InProgress",
  "files": [
    {
      "id": "file-id",
      "documentName": "circular-1.pdf",
      "order": 0,
      "pageCount": 2
    }
  ],
  "senderDetail": {
    "name": "Demo Org",
    "emailAddress": "",
    "isViewed": false
  },
  "signerDetails": [
    {
      "id": "cmp9dwnq1000zi5cndphokbih",
      "signerName": "SM",
      "signerEmail": "wana11391@gmail.com",
      "status": "Completed",
      "order": 1,
      "signerType": "Signer"
    }
  ]
}
```

---

### 4. List Documents (Paginated)
- **Path**: `GET /v1/document/list`
- **Purpose**: Paginated listing of documents belonging to the authenticated organization.
- **Parameters**:
  - `page` (number, optional, default: `1`)
  - `pagesize` (number, optional, default: `10`)
- **Response**:
```json
{
  "pageDetails": {
    "pageSize": 5,
    "page": 1,
    "totalRecordsCount": 1,
    "totalPages": 1,
    "sortedColumn": "activityDate",
    "sortDirection": "DESC"
  },
  "result": [
    {
      "documentId": "cmp9dvhzd000oi5cnjy3yla19",
      "messageTitle": "Test Agreement",
      "status": "InProgress",
      "signerDetails": [
        {
          "id": "cmp9dwnq1000zi5cndphokbih",
          "signerName": "SM",
          "signerEmail": "wana11391@gmail.com",
          "status": "Completed",
          "order": 1,
          "signerType": "Signer"
        }
      ]
    }
  ]
}
```

---

### 5. Download Document PDF
- **Path**: `GET /v1/document/download`
- **Purpose**: Downloads the PDF file. Resolves automatically to the fully signed/flattened PDF (if completed) or the original PDF (if in progress/unsigned).
- **Parameters**:
  - `documentId` (string, required)
- **Response**:
  - Binary PDF file (`Content-Type: application/pdf`).

---

## 📂 Layout Structure

```
prisma/              # SQLite Database schemas, migrations, seeds
public/
  docs/              # Swagger UI docs (index.html, swagger.json)
  embed/             # Client-side scripts for hosted drag & drop pages
src/
  app.ts             # Express App initialization & router mounts
  index.ts           # Server port bootstrap
  db.ts              # Global Prisma client
  config.ts          # Static/environment configurations
  middleware/        # API key verification logic
  lib/
    completeSigning.ts # Signature flattening & PDF coordinate calculation
    flattenPdf.ts      # pdf-lib drawing and PDF merging engine
  routes/
    embed/           # Hosted Drag & Drop request / signing pages & APIs
    v1/              # Endpoint routers (create-request-url, document)
```

---

## 🔄 Database Reset & Refresh

If you want to clear your local database entirely and recreate all tables based on the updated Prisma schema, run:

```bash
npx prisma db push --force-reset
node prisma/seed.mjs
```

#### What does this do?
1. **`npx prisma db push --force-reset`**: Drops all existing tables in your local `dev.db` SQLite database and rebuilds them fresh according to the current schema (`schema.prisma`). This is the clean developer way to perform a database refresh without running legacy raw SQL push scripts.
2. **`node prisma/seed.mjs`**: Re-populates the freshly reset database with default seed records (Organization `Demo Org` and your API Key `dev_live_replace_me`).
