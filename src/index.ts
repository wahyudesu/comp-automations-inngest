import { Hono } from 'hono';
import { inngest, functions } from './inngest';
// import { serve } from 'inngest/cloudflare';
import { serve } from "inngest/hono";

const app = new Hono();

// Health check endpoint
app.get('/', (c) => {
	return c.json({ status: 'ok', message: 'Competition Automation API' });
});

// Inngest serve endpoint for Cloudflare Workers
// app.use('/inngest', serve(inngest, functions));
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  })
);


export default app;
