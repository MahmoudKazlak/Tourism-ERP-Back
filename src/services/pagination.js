// Max page size prevents clients from requesting unbounded result sets.
// Adjust MAX_PAGE_SIZE if your use case genuinely needs larger pages.
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

export function pagination(page, size) {
  const parsedPage = parseInt(page);
  const parsedSize = parseInt(size);

  const safePage = parsedPage > 0 ? parsedPage : 1;
  const safeSize =
    parsedSize > 0 ? Math.min(parsedSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  return {
    limit: safeSize,
    skip: (safePage - 1) * safeSize,
  };
}
