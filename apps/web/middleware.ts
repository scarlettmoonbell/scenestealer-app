import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches Clerk auth context so auth()/currentUser() work in Server
// Components — actual route protection happens at the resource level
// (in page.tsx / route handlers), per Clerk's own guidance, not here.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
