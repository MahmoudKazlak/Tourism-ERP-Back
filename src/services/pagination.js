export function pagination(page, size) {
  if (!page || page <= 0) page = 1;
  if (!size || size <= 0) size = 10;
  const limit = parseInt(size);
  const skip = (parseInt(page) - 1) * limit;
  return { limit, skip };
}
