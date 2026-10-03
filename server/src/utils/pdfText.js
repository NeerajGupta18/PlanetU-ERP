/** pdfkit wraps long text onto a second line even with lineBreak:false, so shorten it to fit instead. */
export function fit(doc, text, width) {
  let t = String(text ?? '');
  if (doc.widthOfString(t) <= width) return t;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}
