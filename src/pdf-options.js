export const PDF_NEIGHBOR_LIMIT = 100;
export function pdfReadOptions(value) {
  const mode = ['current', 'window', 'all'].includes(value?.mode) ? value.mode : 'window';
  const pages = n => Number.isInteger(n) ? Math.max(0, Math.min(PDF_NEIGHBOR_LIMIT, n)) : 1;
  return {mode, before: pages(value?.before), after: pages(value?.after)};
}
