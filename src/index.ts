import { Hono } from "hono";
import { serve } from "inngest/hono";
import { functions, inngest } from "./inngest";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  })
);

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

export default app;
