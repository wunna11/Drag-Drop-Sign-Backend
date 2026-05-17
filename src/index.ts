import { createApp } from "./app.js";
import { env } from "./config.js";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
