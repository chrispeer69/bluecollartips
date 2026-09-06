import { createFileRoute } from "@tanstack/react-router";
import { googleCallback } from "@/auth/google.server";

export const Route = createFileRoute("/api/auth/google/callback")({
  server: { handlers: { GET: async ({ request }) => googleCallback(request) } },
});
