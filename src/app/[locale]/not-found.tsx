import NotFoundBody from "@/components/NotFoundBody";

/**
 * The 404 for a URL that matches no route at all.
 *
 * No route means no route group, so neither shell applies here and the page has to carry its own
 * wordmark — see `NotFoundBody`. The two group-scoped copies handle everything reached by a real
 * page calling `notFound()`, which is the common case, and those get the full header and footer.
 */
export default function NotFound() {
  return <NotFoundBody standalone />;
}
