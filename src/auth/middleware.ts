import { createMiddleware } from "@tanstack/react-start";
import { getSessionUser } from "./session.server";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized: Please sign in");
  return next({ context: { userId: user.id, user } });
});
