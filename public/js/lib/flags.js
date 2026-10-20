// URL flags. Pure: takes the query string, not `location`.

/**
 * @param {string} search `location.search`, with or without the leading `?`
 * @returns {{ debug: boolean }}
 */
export function parseFlags(search) {
  const params = new URLSearchParams(search);
  return { debug: params.get('debug') === '1' };
}
