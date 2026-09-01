import { createFileRoute } from "@tanstack/react-router";
import { googleAuthorization } from "@/auth/google.server";

export const Route = createFileRoute("/api/auth/google")({
  server: { handlers: { GET: async ({ request }) => googleAuthorization(request) } },
});
