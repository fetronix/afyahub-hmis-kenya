/** Bounded, literal-only CSV reader. No type coercion or formula evaluation. */
export function csvRows(text) {
  const rows = [];
  let row = [],
    value = '',
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(value);
    if (row.length > 80) throw new Error('CSV exceeds 80 columns.');
    value = '';
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > 2000) throw new Error('CSV exceeds 2000 rows.');
  };
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('CSV contains binary data.');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else if (c === '"' && value === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Malformed quoted CSV cell.');
      value += c;
    }
    if (value.length > 1000) throw new Error('CSV cell exceeds 1000 characters.');
  }
  if (quoted) throw new Error('Unterminated quoted CSV cell.');
  if (value || row.length || closed) pushRow();
  if (rows.reduce((n, r) => n + r.length, 0) > 150000) throw new Error('Too many CSV cells.');
  return rows;
}
