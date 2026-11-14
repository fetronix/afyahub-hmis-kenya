/**
 * Where may a document write on a facility's letterhead?
 *
 * The letterhead is a designed page: a logo block, a colour band, a footer with
 * contacts and often an accreditation strip. Generated content has to land in
 * whatever is left, and "left" depends entirely on the file the facility
 * uploaded. This module measures that file instead of guessing.
 *
 * HOW IT MEASURES
 * ---------------
 * The first page's content streams are decoded and a deliberately small subset
 * of the PDF imaging model is interpreted: the current transformation matrix,
 * paths, text placement, and image/form XObjects. Anything that would put ink
 * on the page widens a box. The union of those boxes is the letterhead's ink.
 *
 * Two details decide whether the result is trustworthy:
 *
 *   - A rectangle used as a *clip* is not ink. Generators emit
 *     `0 0 595 842 re W n` around almost every object; counting those would
 *     report the page as fully covered and yield no body area at all. A path
 *     only counts when a painting operator (`f`, `S`, `B`, …) follows it;
 *     `n` and `W` do not paint.
 *
 *   - Whitespace-only text is not ink either. Accessibility and pagination
 *     artefacts are frequently emitted as single spaces at coordinates off the
 *     page — the client's own letterhead carries several at x = 601.9 on a
 *     595.2 pt page.
 *
 * The printable band is then the gap between the header cluster and the footer
 * cluster:
 *
 *     bodyTop    = height - (lowest edge of header ink)        + padding
 *     bodyBottom = (highest edge of footer ink)                + padding
 *
 * Taking the *lowest* header edge and the *highest* footer edge means a stray
 * mark anywhere near the top or bottom shrinks the body rather than overlapping
 * it. That is the safe direction to be wrong in.
 *
 * WHEN IT REFUSES TO GUESS
 * ------------------------
 * If ink appears in the middle of the page the letterhead is not a frame and
 * there is no definable body: a watermark, a border or a full-page background
 * would be silently covered. The estimator then returns the default rectangle
 * and says so, and the administrator corrects it in the preview. A confident
 * wrong number is worse than an admitted one.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';

export interface BodyRectangle {
  pageWidthPt: number;
  pageHeightPt: number;
  bodyTopPt: number;
  bodyBottomPt: number;
  bodyLeftPt: number;
  bodyRightPt: number;
  /*
   * MEASURED: derived from the uploaded artwork. DEFAULT: nothing usable could
   * be measured, so a conservative rectangle was assumed. ADJUSTED: an
   * administrator corrected it before activation (0089 records that value too).
   */
  layoutSource: 'MEASURED' | 'DEFAULT' | 'ADJUSTED';
}

export interface InkBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
  /*
   * ARTWORK is a painted path or image: its horizontal extent is exact.
   * TEXT is a text run: its width is an estimate from the font size, so it
   * bounds the vertical band reliably and the horizontal band not at all.
   * Omitted is treated as ARTWORK.
   */
  kind?: 'ARTWORK' | 'TEXT';
}

/** Space between the letterhead's ink and the first line of content. */
const PADDING_PT = 8;

/** Below this a letterhead has no usable body, and the default is used. */
const MIN_BODY_HEIGHT_PT = 120;

/** Never place content closer to an edge than this, whatever the artwork does. */
const MIN_SIDE_INSET_PT = 24;

/** Falls back to these fractions of the page when the PDF cannot be measured. */
const DEFAULT_TOP_FRACTION = 0.22;
const DEFAULT_BOTTOM_FRACTION = 0.12;
const DEFAULT_SIDE_FRACTION = 0.08;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Scale factor of the matrix, used to size text under a transformed CTM. */
function scaleOf(m: Matrix): number {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  return (sx + sy) / 2 || 1;
}

function emptyBox(): InkBox {
  return { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity };
}

function isEmpty(box: InkBox): boolean {
  return !Number.isFinite(box.left) || !Number.isFinite(box.top);
}

function addPoint(box: InkBox, x: number, y: number): void {
  box.left = Math.min(box.left, x);
  box.right = Math.max(box.right, x);
  box.bottom = Math.min(box.bottom, y);
  box.top = Math.max(box.top, y);
}

function mergeBox(a: InkBox, b: InkBox): void {
  if (isEmpty(b)) return;
  a.left = Math.min(a.left, b.left);
  a.right = Math.max(a.right, b.right);
  a.bottom = Math.min(a.bottom, b.bottom);
  a.top = Math.max(a.top, b.top);
}

type Token = string | number | { kind: 'string'; value: string; bytes: number[] };

/**
 * Split a content stream into operands and operators.
 *
 * Only what the interpreter needs: numbers, names, strings (literal and hex),
 * arrays, and bare operators. Inline images (`BI … ID … EI`) are binary and are
 * reported as unsupported rather than mis-tokenised.
 */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const char = source[i];

    if (char === '%') {
      while (i < n && source[i] !== '\n' && source[i] !== '\r') i += 1;
      continue;
    }
    if (
      char === '\u0000' ||
      char === '\u0009' ||
      char === '\u000a' ||
      char === '\u000d' ||
      char === ' '
    ) {
      i += 1;
      continue;
    }

    // Literal string, with balanced parentheses and backslash escapes.
    if (char === '(') {
      let depth = 1;
      let j = i + 1;
      let value = '';
      const bytes: number[] = [];
      while (j < n && depth > 0) {
        const c = source[j];
        if (c === '\\') {
          const next = source[j + 1];
          const escaped = next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
          value += escaped ?? '';
          bytes.push((escaped ?? '').charCodeAt(0) || 0);
          j += 2;
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
        value += c;
        bytes.push(c.charCodeAt(0));
        j += 1;
      }
      tokens.push({ kind: 'string', value, bytes });
      i = j;
      continue;
    }

    // Hex string.
    if (char === '<' && source[i + 1] !== '<') {
      const end = source.indexOf('>', i + 1);
      if (end < 0) return null;
      const hex = source.slice(i + 1, end).replace(/\s+/g, '');
      const bytes: number[] = [];
      for (let k = 0; k + 1 < hex.length; k += 2)
        bytes.push(parseInt(hex.slice(k, k + 2), 16) || 0);
      tokens.push({ kind: 'string', value: '', bytes });
      i = end + 1;
      continue;
    }

    if (char === '[' || char === ']' || (char === '<' && source[i + 1] === '<')) {
      if (char === '<') {
        const end = source.indexOf('>>', i + 2);
        if (end < 0) return null;
        tokens.push('<< >>');
        i = end + 2;
        continue;
      }
      tokens.push(char);
      i += 1;
      continue;
    }

    if (char === '/') {
      let j = i + 1;
      while (j < n && !/[\s/<>[\]()]/.test(source[j])) j += 1;
      tokens.push(`/${source.slice(i + 1, j)}`);
      i = j;
      continue;
    }

    // Number.
    if (/[+-.\d]/.test(char)) {
      let j = i;
      while (j < n && /[+-.\d]/.test(source[j])) j += 1;
      const value = Number(source.slice(i, j));
      if (!Number.isFinite(value)) return null;
      tokens.push(value);
      i = j;
      continue;
    }

    // Operator or bare word.
    let j = i;
    while (j < n && !/[\s/<>[\]()%]/.test(source[j])) j += 1;
    const word = source.slice(i, j);
    if (word === 'BI') return null; // inline image: not interpreted
    tokens.push(word);
    i = j === i ? i + 1 : j;
  }

  return tokens;
}

/** A run is whitespace when every code it carries is a control code or space. */
function isWhitespaceRun(token: Extract<Token, { kind: 'string' }>): boolean {
  if (token.bytes.length === 0) return true;
  return token.bytes.every((byte) => byte <= 0x20);
}

interface InkResult {
  boxes: InkBox[];
  unsupported: boolean;
}

/**
 * Interpret one decoded content stream and collect the boxes that paint ink.
 *
 * Anything outside the subset — inline images, colour-managed shadings — is not
 * simulated. A stream that cannot be tokenised is reported as unsupported so
 * the caller falls back rather than trusting a partial measurement.
 */
function collectInk(
  source: string,
  resources: PDFDict | undefined,
  page: { width: number; height: number },
): InkResult {
  const tokens = tokenize(source);
  if (!tokens) return { boxes: [], unsupported: true };

  const boxes: InkBox[] = [];
  let ctm: Matrix = IDENTITY;
  let stack: { ctm: Matrix; fontSize: number }[] = [];
  let fontSize = 12;

  let path: InkBox = emptyBox();
  let textMatrix: Matrix = IDENTITY;

  let operands: Token[] = [];

  const numbers = (count: number): number[] | null => {
    const slice = operands.slice(-count);
    if (slice.length !== count) return null;
    const values = slice.map((value) => (typeof value === 'number' ? value : Number.NaN));
    return values.every((value) => Number.isFinite(value)) ? values : null;
  };

  for (const token of tokens) {
    /*
     * Everything that is not a bare operator is an operand: a name (`/F1`), a
     * delimiter (`[`, `]`), a string object, or a number. A bare word is an
     * operator — `true`/`false`/`null` never carry ink, and ignoring them as
     * operators costs nothing.
     */
    const isOperator =
      typeof token === 'string' &&
      !token.startsWith('/') &&
      token !== '[' &&
      token !== ']' &&
      token !== '<< >>';

    if (!isOperator) {
      operands.push(token);
      continue;
    }

    const operator = token;
    switch (operator) {
      case 'q':
        stack = [...stack, { ctm, fontSize }];
        break;
      case 'Q': {
        const previous = stack.pop();
        if (previous) {
          ctm = previous.ctm;
          fontSize = previous.fontSize;
        }
        break;
      }
      case 'cm': {
        const value = numbers(6);
        if (value) ctm = multiply(value as Matrix, ctm);
        break;
      }
      case 're': {
        const value = numbers(4);
        if (value) {
          const [x, y, w, h] = value;
          for (const [px, py] of [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h],
          ]) {
            const point = apply(ctm, px, py);
            addPoint(path, point.x, point.y);
          }
        }
        break;
      }
      case 'm':
      case 'l': {
        const value = numbers(2);
        if (value) {
          const point = apply(ctm, value[0], value[1]);
          addPoint(path, point.x, point.y);
        }
        break;
      }
      case 'c': {
        const value = numbers(6);
        if (value) {
          for (const [px, py] of [
            [value[0], value[1]],
            [value[2], value[3]],
            [value[4], value[5]],
          ]) {
            const point = apply(ctm, px, py);
            addPoint(path, point.x, point.y);
          }
        }
        break;
      }
      case 'v':
      case 'y': {
        const value = numbers(4);
        if (value) {
          for (const [px, py] of [
            [value[0], value[1]],
            [value[2], value[3]],
          ]) {
            const point = apply(ctm, px, py);
            addPoint(path, point.x, point.y);
          }
        }
        break;
      }
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*': {
        // A painting operator: whatever the path covers is ink.
        if (!isEmpty(path)) boxes.push({ ...path, kind: 'ARTWORK' });
        path = emptyBox();
        break;
      }
      case 'n':
      case 'W':
      case 'W*':
        // End of path with no paint, or a clip. Neither leaves a mark.
        if (operator === 'n') path = emptyBox();
        break;
      case 'BT':
        textMatrix = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tf': {
        const size = operands[operands.length - 1];
        if (typeof size === 'number' && Number.isFinite(size)) fontSize = size;
        break;
      }
      case 'Tm': {
        const value = numbers(6);
        if (value) textMatrix = value as Matrix;
        break;
      }
      case 'Td':
      case 'TD': {
        const value = numbers(2);
        if (value) textMatrix = multiply([1, 0, 0, 1, value[0], value[1]], textMatrix);
        break;
      }
      case 'T*':
        textMatrix = multiply([1, 0, 0, 1, 0, -fontSize], textMatrix);
        break;
      case 'Tj':
      case "'":
      case '"':
      case 'TJ': {
        const strings = operands.filter(
          (operand): operand is Extract<Token, { kind: 'string' }> =>
            typeof operand === 'object' && operand !== null && 'kind' in operand,
        );
        const meaningful = strings.filter((run) => !isWhitespaceRun(run));
        if (meaningful.length > 0) {
          const origin = apply(multiply(textMatrix, ctm), 0, 0);
          const scale = scaleOf(ctm) * (Math.abs(textMatrix[0]) || 1);
          const size = fontSize * scale;
          // A text run has no measurable width without font metrics. One em per
          // code is an upper bound on a single glyph and understates a long
          // line, so the box is used for the vertical band only; horizontal
          // margins are taken from artwork, which is exact.
          const glyphs = meaningful.reduce(
            (total, run) => total + Math.max(1, run.bytes.length),
            0,
          );
          const width = size * Math.min(glyphs, 60);
          const box: InkBox = {
            left: origin.x,
            right: origin.x + width,
            bottom: origin.y - size * 0.25,
            top: origin.y + size,
            kind: 'TEXT',
          };
          boxes.push(box);
        }
        if (operator === "'" || operator === '"') {
          textMatrix = multiply([1, 0, 0, 1, 0, -fontSize], textMatrix);
        }
        break;
      }
      case 'Do': {
        const name = operands.find(
          (operand): operand is string => typeof operand === 'string' && operand.startsWith('/'),
        );
        const xobject = name ? xObjectDictionary(resources, name.slice(1)) : undefined;
        const subtype = xobject ? String(xobject.get(PDFName.of('Subtype')) ?? '') : '';
        let bbox: InkBox = { left: 0, bottom: 0, right: 1, top: 1 };
        if (subtype.includes('Form')) {
          const rawBbox = xobject?.get(PDFName.of('BBox'));
          if (rawBbox instanceof PDFArray) {
            const values = rawBbox.asArray().map((entry) => Number(entry.toString()));
            if (values.length === 4 && values.every((value) => Number.isFinite(value))) {
              bbox = {
                left: Math.min(values[0], values[2]),
                bottom: Math.min(values[1], values[3]),
                right: Math.max(values[0], values[2]),
                top: Math.max(values[1], values[3]),
              };
            }
          } else {
            return { boxes, unsupported: true };
          }
        }
        const box = emptyBox();
        for (const [px, py] of [
          [bbox.left, bbox.bottom],
          [bbox.right, bbox.bottom],
          [bbox.left, bbox.top],
          [bbox.right, bbox.top],
        ]) {
          const point = apply(ctm, px, py);
          addPoint(box, point.x, point.y);
        }
        // Placements wholly outside the page are clipped by the viewer and
        // cannot collide with content; ignoring them keeps a bleed harmless.
        if (box.right > 0 && box.left < page.width && box.top > 0 && box.bottom < page.height) {
          boxes.push({ ...box, kind: 'ARTWORK' });
        }
        break;
      }
      default:
        break;
    }

    operands = [];
  }

  return { boxes, unsupported: false };
}

function xObjectDictionary(resources: PDFDict | undefined, name: string): PDFDict | undefined {
  if (!resources) return undefined;
  const xobjects = resources.get(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return undefined;
  const entry = xobjects.get(PDFName.of(name));
  if (entry instanceof PDFRawStream) {
    const dict = entry.dict;
    return dict ?? undefined;
  }
  return entry instanceof PDFDict ? entry : undefined;
}

/** Default rectangle, used when the artwork cannot be measured. */
export function defaultBodyRectangle(pageWidthPt: number, pageHeightPt: number): BodyRectangle {
  return {
    pageWidthPt,
    pageHeightPt,
    bodyTopPt: round2(pageHeightPt * DEFAULT_TOP_FRACTION),
    bodyBottomPt: round2(pageHeightPt * DEFAULT_BOTTOM_FRACTION),
    bodyLeftPt: round2(pageWidthPt * DEFAULT_SIDE_FRACTION),
    bodyRightPt: round2(pageWidthPt * DEFAULT_SIDE_FRACTION),
    layoutSource: 'DEFAULT',
  };
}

/**
 * Every box of ink on the first page, in PDF points from the bottom-left.
 *
 * `null` means the page could not be interpreted — an inline image, an
 * unparseable stream, a form XObject without a usable BBox. Callers must treat
 * that as "unknown", never as "no ink": a page reported as empty would give the
 * whole area to the content and print straight over the artwork.
 */
export async function letterheadInkBoxes(bytes: Buffer): Promise<InkBox[] | null> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = pdf.getPage(0);
  const width = page.getWidth();
  const height = page.getHeight();

  /*
   * `/Contents` is reached through the document's object graph, and in practice
   * it is usually an INDIRECT reference — pdf-lib itself writes an array of
   * refs. Skipping refs silently reported "this page has no ink", which gave
   * the content the whole sheet and printed it over the artwork. Every entry is
   * now resolved, and anything that does not resolve to a stream makes the page
   * unmeasurable rather than empty.
   */
  const contents = page.node.Contents();
  const resolve = (entry: unknown): PDFRawStream | null => {
    const object = entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
    return object instanceof PDFRawStream ? object : null;
  };

  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (const entry of contents.asArray()) {
      const stream = resolve(entry);
      if (!stream) return null;
      streams.push(stream);
    }
  } else if (contents) {
    const stream = resolve(contents);
    if (!stream) return null;
    streams.push(stream);
  }

  /* A page with no content stream at all is blank — but if `/Contents` was
   * present and unusable that was handled above; a missing one is measurable. */

  const resourcesEntry = page.node.Resources();
  const resources = resourcesEntry instanceof PDFDict ? resourcesEntry : undefined;

  const boxes: InkBox[] = [];
  for (const stream of streams) {
    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(stream).decode();
    } catch {
      return null;
    }
    const result = collectInk(Buffer.from(decoded).toString('latin1'), resources, {
      width,
      height,
    });
    if (result.unsupported) return null;
    boxes.push(...result.boxes);
  }
  return boxes;
}

/**
 * Measure a letterhead and return the body rectangle.
 *
 * Never throws for an unmeasurable document: an administrator can fix a default
 * in the preview, but cannot fix a failed upload they were not told about.
 */
export async function measureLetterheadLayout(bytes: Buffer): Promise<BodyRectangle> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = pdf.getPage(0);
  const width = page.getWidth();
  const height = page.getHeight();

  const boxes = await letterheadInkBoxes(bytes);
  if (!boxes) return defaultBodyRectangle(width, height);

  const ink = emptyBox();
  for (const box of boxes) mergeBox(ink, box);
  if (isEmpty(ink)) return defaultBodyRectangle(width, height);

  // Clusters. Anything between the header zone and the footer zone means the
  // letterhead is not a frame, so the body is not inferable.
  const headerZone = height * 0.55;
  const footerZone = height * 0.45;
  let headerBottom = Infinity;
  let footerTop = -Infinity;
  let middleInk = false;

  for (const box of boxes) {
    const touchesTop = box.top >= headerZone;
    const touchesBottom = box.bottom <= footerZone;
    if (touchesTop) headerBottom = Math.min(headerBottom, box.bottom);
    if (touchesBottom) footerTop = Math.max(footerTop, box.top);
    if (!touchesTop && !touchesBottom) middleInk = true;
  }

  if (middleInk) return defaultBodyRectangle(width, height);

  const sideInsets = measureSideInsets(width, boxes);
  const bodyTopPt = Number.isFinite(headerBottom)
    ? height - headerBottom + PADDING_PT
    : height * DEFAULT_TOP_FRACTION;
  const bodyBottomPt = Number.isFinite(footerTop)
    ? footerTop + PADDING_PT
    : height * DEFAULT_BOTTOM_FRACTION;

  const body: BodyRectangle = {
    pageWidthPt: round2(width),
    pageHeightPt: round2(height),
    bodyTopPt: round2(Math.max(0, bodyTopPt)),
    bodyBottomPt: round2(Math.max(0, bodyBottomPt)),
    bodyLeftPt: round2(sideInsets.left),
    bodyRightPt: round2(sideInsets.right),
    layoutSource: 'MEASURED',
  };

  // A letterhead that leaves almost nothing is not usable as a frame; report a
  // default so the administrator starts from a sane rectangle.
  if (height - body.bodyTopPt - body.bodyBottomPt < MIN_BODY_HEIGHT_PT) {
    return defaultBodyRectangle(width, height);
  }
  return body;
}

/**
 * Side margins come from side artwork only.
 *
 * Three kinds of box are deliberately excluded:
 *
 * - Text. Its width is an estimate (the font is not parsed), so it can only
 *   bound the vertical band. Including it made every designed letterhead
 *   collapse to the minimum margin.
 * - Full-width bands. A header or footer rule that spans the paper says
 *   nothing about where a text column may start; treating it as side art
 *   would set both margins to zero.
 * - Bleed. A band drawn wider than the page is clipped by the viewer, so it
 *   is clamped rather than allowed to pull a margin negative.
 *
 * With no usable side artwork the default fraction applies. A floor keeps a
 * genuine 4 pt rule from putting content on the paper edge.
 */
function measureSideInsets(width: number, boxes: InkBox[]): { left: number; right: number } {
  let left = Infinity;
  let right = -Infinity;
  for (const box of boxes) {
    if ((box.kind ?? 'ARTWORK') !== 'ARTWORK') continue;
    const boxLeft = Math.max(0, Math.min(box.left, width));
    const boxRight = Math.min(width, Math.max(box.right, 0));
    if (boxRight <= boxLeft) continue;
    /* A band spanning ~the whole sheet is horizontal furniture, not a column. */
    if (boxRight - boxLeft >= width * 0.9) continue;
    left = Math.min(left, boxLeft);
    right = Math.max(right, boxRight);
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    const inset = round2(width * DEFAULT_SIDE_FRACTION);
    return { left: inset, right: inset };
  }

  const symmetric = Math.min(left, width - right);
  const inset = Math.max(MIN_SIDE_INSET_PT, Math.min(symmetric, width * 0.3));
  return { left: round2(inset), right: round2(inset) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
