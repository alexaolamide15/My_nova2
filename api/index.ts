import app from "../artifacts/api-server/src/app.js";

// Vercel invokes this Express app per request. The Telegram worker is started
// only by the standalone process entrypoint, never during a serverless import.
export default app;
