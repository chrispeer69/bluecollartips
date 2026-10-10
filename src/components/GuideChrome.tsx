import { Link } from "@tanstack/react-router";

/** Visible breadcrumb + "updated" date at the top of a guide (matches its BreadcrumbList data). */
export function GuideBreadcrumb({ title, updated }: { title: string; updated: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link to="/" className="hover:underline">Home</Link></li>
        <li aria-hidden="true">›</li>
        <li><a href="/#guides" className="hover:underline">Guides</a></li>
        <li aria-hidden="true">›</li>
        <li aria-current="page" className="text-foreground">{title}</li>
      </ol>
      <p className="mt-2">
        Updated <time dateTime={updated}>{new Date(`${updated}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
      </p>
    </nav>
  );
}

/** Footer with links to every public page so each guide is a hop away from the rest of the site. */
export function GuideFooter() {
  return (
    <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
      <nav aria-label="Site" className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2">
        <Link to="/" className="hover:underline">Home</Link>
        <Link to="/guides/tip-pooling" className="hover:underline">Tip pooling guide</Link>
        <Link to="/guides/fica-tip-credit" className="hover:underline">FICA tip credit guide</Link>
        <Link to="/privacy" className="hover:underline">Privacy</Link>
        <Link to="/terms" className="hover:underline">Terms</Link>
      </nav>
      © {new Date().getFullYear()} Blue Collar Tips
    </footer>
  );
}
