import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib';
import sharp from 'sharp';

export interface PdfFixture {
  name: string;
  bytes: Buffer;
  supported: boolean;
  message?: string;
  feature: string;
}
/** Entirely synthetic artwork and PDF dictionaries. Never read patient/facility documents. */
export async function pdfCompatibilityFixtures(): Promise<PdfFixture[]> {
  const result: PdfFixture[] = [];
  async function make(
    name: string,
    feature: string,
    modify?: (pdf: PDFDocument) => void | Promise<void>,
    message?: string,
  ) {
    const pdf = await PDFDocument.create();
    pdf
      .addPage([595.28, 841.89])
      .drawText('SYNTHETIC PDF COMPATIBILITY — '.replace('—', '-') + name, {
        x: 35,
        y: 775,
        size: 12,
      });
    await modify?.(pdf);
    result.push({
      name,
      feature,
      bytes: Buffer.from(await pdf.save()),
      supported: !message,
      message,
    });
  }
  const png = async (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
  const signature = await png(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect width="360" height="100" fill="white"/><path d="M10 75 Q40 5 60 65 T105 45 Q125 5 140 65 T200 45 Q230 20 245 60 L320 40" fill="none" stroke="#123" stroke-width="4"/></svg>',
  );
  await make('static-text', 'ordinary printable text');
  await make('scanned-letterhead', 'one full-page scanned PNG', async (pdf) => {
    const scan = await png(
      '<svg xmlns="http://www.w3.org/2000/svg" width="596" height="842"><rect width="596" height="842" fill="white"/><rect x="30" y="30" width="45" height="45" fill="#087f80"/><text x="90" y="60" font-size="23">SYNTHETIC FACILITY</text><path d="M30 95H560" stroke="#087f80" stroke-width="3"/><text x="45" y="180" font-size="17">Static scanned letterhead - synthetic only</text><path d="M30 780H560" stroke="#087f80"/><text x="45" y="810" font-size="13">Synthetic footer - not a real facility</text></svg>',
    );
    const image = await pdf.embedPng(scan);
    pdf.getPage(0).drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  });
  await make('images', 'embedded static raster image', async (pdf) => {
    const img = await pdf.embedPng(
      await sharp({ create: { width: 100, height: 100, channels: 3, background: '#17858a' } })
        .png()
        .toBuffer(),
    );
    pdf.getPage(0).drawImage(img, { x: 60, y: 550, width: 160, height: 160 });
  });
  await make(
    'scanned-signature',
    'embedded scanned ink image, not a verified signature',
    async (pdf) => {
      const img = await pdf.embedPng(signature);
      pdf
        .getPage(0)
        .drawText('Scanned signature sample - not proof of consent', { x: 40, y: 650, size: 14 });
      pdf.getPage(0).drawImage(img, { x: 50, y: 500, width: 360, height: 100 });
    },
  );
  await make('graphics', 'static graphics, header/footer and logos', (pdf) => {
    const p = pdf.getPage(0);
    p.drawRectangle({ x: 35, y: 650, width: 525, height: 60, color: rgb(0.04, 0.5, 0.52) });
    p.drawCircle({ x: 100, y: 500, size: 35, borderColor: rgb(0, 0, 0), borderWidth: 2 });
    p.drawLine({ start: { x: 35, y: 65 }, end: { x: 560, y: 65 }, thickness: 2 });
    p.drawText('Synthetic footer', { x: 35, y: 40, size: 12 });
  });
  await make('type3-glyph-A', '/Type /Font /Subtype /Type3 /CharProcs << /A stream >>', (pdf) => {
    const glyph = pdf.context.register(
      pdf.context.flateStream(
        '600 0 0 0 600 700 d1\n0 0 0 rg\n50 0 m 300 700 l 550 0 l 450 0 l 300 470 l 150 0 l h f',
      ),
    );
    const font = pdf.context.register(
      pdf.context.obj({
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: [0, 0, 600, 700],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: { A: glyph },
        Encoding: { Type: 'Encoding', Differences: [65, PDFName.of('A')] },
        FirstChar: 65,
        LastChar: 65,
        Widths: [600],
        Resources: {},
      }),
    );
    const p = pdf.getPage(0);
    p.node.setFontDictionary(PDFName.of('SyntheticGlyph'), font);
    p.node.addContentStream(
      pdf.context.register(pdf.context.flateStream('BT /SyntheticGlyph 55 Tf 45 620 Td (A) Tj ET')),
    );
  });
  await make(
    'tagged-layout-A',
    '/Type /StructElem /A << /O /Layout /Placement /Block >>',
    (pdf) => {
      const p = pdf.getPage(0);
      p.node.set(PDFName.of('StructParents'), pdf.context.obj(0));
      p.node.addContentStream(
        pdf.context.register(
          pdf.context.flateStream(
            '/P << /MCID 0 >> BDC\nq 0.1 0.6 0.6 rg 40 650 480 40 re f Q\nEMC',
          ),
        ),
      );
      const root = pdf.context.obj({ Type: 'StructTreeRoot' }),
        rootRef = pdf.context.register(root);
      const element = pdf.context.register(
        pdf.context.obj({
          Type: 'StructElem',
          S: 'P',
          P: rootRef,
          Pg: p.ref,
          K: 0,
          A: { O: 'Layout', Placement: 'Block', BBox: [40, 650, 520, 690] },
        }),
      );
      root.set(PDFName.of('K'), pdf.context.obj([element]));
      root.set(PDFName.of('ParentTree'), pdf.context.obj({ Nums: [0, [element]] }));
      pdf.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
      pdf.catalog.set(PDFName.of('MarkInfo'), pdf.context.obj({ Marked: true }));
    },
  );
  await make(
    'initial-view-fit',
    '/OpenAction [pageRef /Fit] is a destination, not an action',
    (pdf) =>
      pdf.catalog.set(
        PDFName.of('OpenAction'),
        pdf.context.obj([pdf.getPage(0).ref, PDFName.of('Fit')]),
      ),
  );
  await make(
    'static-annotations',
    'printable ink/highlight/text and stamp state named /A',
    (pdf) => {
      const ap = pdf.context.register(
        pdf.context.flateStream('q 0 0.5 0.5 rg 0 0 80 25 re f Q', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 80, 25],
          Resources: {},
        }),
      );
      const entries = [
        {
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [40, 650, 60, 670],
          Contents: PDFString.of('Synthetic static note'),
          F: 4,
        },
        {
          Type: 'Annot',
          Subtype: 'Highlight',
          Rect: [40, 600, 260, 620],
          QuadPoints: [40, 620, 260, 620, 40, 600, 260, 600],
          C: [1, 1, 0],
          F: 4,
        },
        {
          Type: 'Annot',
          Subtype: 'Ink',
          Rect: [40, 500, 260, 560],
          InkList: [[40, 505, 80, 540, 120, 515, 220, 545]],
          C: [0, 0, 0],
          F: 4,
        },
        {
          Type: 'Annot',
          Subtype: 'Stamp',
          Rect: [40, 420, 120, 445],
          AP: { N: { A: ap } },
          AS: 'A',
          F: 4,
        },
      ];
      pdf
        .getPage(0)
        .node.set(
          PDFName.of('Annots'),
          pdf.context.obj(entries.map((e) => pdf.context.register(pdf.context.obj(e)))),
        );
    },
  );
  await make('internal-link', 'static link annotation with local /Dest and no action', (pdf) => {
    pdf.getPage(0).node.set(
      PDFName.of('Annots'),
      pdf.context.obj([
        pdf.context.register(
          pdf.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [40, 500, 240, 520],
            Border: [0, 0, 0],
            Dest: [pdf.getPage(0).ref, PDFName.of('Fit')],
          }),
        ),
      ]),
    );
  });
  await make('form-xobject', 'Form XObject is static graphics, not an AcroForm', async (pdf) => {
    const src = await PDFDocument.create();
    src
      .addPage([100, 100])
      .drawRectangle({ x: 10, y: 10, width: 80, height: 80, color: rgb(0, 0.4, 0.4) });
    const logo = await pdf.embedPage(src.getPage(0));
    pdf.getPage(0).drawPage(logo, { x: 40, y: 500, width: 100, height: 100 });
  });
  await make(
    'local-navigation',
    '/OpenAction /S /GoTo with a validated local array destination',
    (pdf) =>
      pdf.catalog.set(
        PDFName.of('OpenAction'),
        pdf.context.obj({ S: 'GoTo', D: [pdf.getPage(0).ref, PDFName.of('Fit')] }),
      ),
  );
  await make(
    'javascript',
    '/OpenAction -> action /S /JavaScript /JS string',
    (pdf) =>
      pdf.catalog.set(
        PDFName.of('OpenAction'),
        pdf.context.obj({
          S: 'JavaScript',
          JS: PDFString.of('app.alert("SYNTHETIC - DO NOT EXECUTE")'),
        }),
      ),
    'JavaScript',
  );
  await make(
    'additional-javascript',
    '/AA /O -> indirect JavaScript action',
    (pdf) =>
      pdf.getPage(0).node.set(
        PDFName.of('AA'),
        pdf.context.obj({
          O: pdf.context.register(
            pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("SYNTHETIC")') }),
          ),
        }),
      ),
    'JavaScript',
  );
  await make(
    'launch',
    '/OpenAction -> action /S /Launch',
    (pdf) =>
      pdf.catalog.set(
        PDFName.of('OpenAction'),
        pdf.context.obj({ S: 'Launch', F: PDFString.of('synthetic.exe') }),
      ),
    'Launch',
  );
  await make(
    'attachments',
    '/Names /EmbeddedFiles and /EF embedded text attachment',
    (pdf) => {
      const file = pdf.context.register(
        pdf.context.flateStream('synthetic inert attachment', { Type: 'EmbeddedFile' }),
      );
      const spec = pdf.context.register(
        pdf.context.obj({ Type: 'Filespec', F: PDFString.of('synthetic.txt'), EF: { F: file } }),
      );
      pdf.catalog.set(
        PDFName.of('Names'),
        pdf.context.obj({ EmbeddedFiles: { Names: [PDFString.of('synthetic.txt'), spec] } }),
      );
    },
    'attachments',
  );
  await make(
    'interactive-form',
    'nonempty AcroForm and Widget, with printable appearance',
    (pdf) => {
      const field = pdf.getForm().createTextField('synthetic');
      field.setText('Visible form content');
      field.addToPage(pdf.getPage(0), { x: 40, y: 500, width: 300, height: 40 });
    },
    'interactive form',
  );
  await make(
    'external-link',
    '/Annot /Link /A << /S /URI >>',
    (pdf) =>
      pdf.getPage(0).node.set(
        PDFName.of('Annots'),
        pdf.context.obj([
          pdf.context.register(
            pdf.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [40, 500, 200, 520],
              A: { S: 'URI', URI: PDFString.of('https://example.invalid/synthetic') },
            }),
          ),
        ]),
      ),
    'external actions',
  );
  await make(
    'unsupported-media',
    '/Annot /Subtype /Screen',
    (pdf) =>
      pdf
        .getPage(0)
        .node.set(
          PDFName.of('Annots'),
          pdf.context.obj([
            pdf.context.register(
              pdf.context.obj({ Type: 'Annot', Subtype: 'Screen', Rect: [40, 500, 200, 520] }),
            ),
          ]),
        ),
    'interactive annotations',
  );
  result.push({
    name: 'corrupted',
    bytes: Buffer.from('%PDF-1.7\ncorrupted synthetic objects\n%%EOF\n'),
    supported: false,
    message: 'safely parsed',
    feature: 'invalid object structure',
  });
  result.push({
    name: 'escaped-javascript',
    bytes: escapedJavascriptPdf(),
    supported: false,
    message: 'JavaScript',
    feature: 'escaped /Java#53cript and /J#53 names, valid xref',
  });
  return result;
}

/** Reproduce the pre-fix blanket-name rule, for synthetic diagnostic evidence only. */
export async function legacyPdfRejection(bytes: Buffer): Promise<string | null> {
  const { PDFArray, PDFDict, PDFName, PDFStream } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  const forbidden = new Set([
    'JS',
    'JavaScript',
    'AA',
    'OpenAction',
    'A',
    'EmbeddedFiles',
    'EF',
    'XFA',
    'RichMedia',
    'Collection',
  ]);
  const visited = new Set<unknown>();
  const walk = (obj: unknown, path: string): string | null => {
    if (!obj || visited.has(obj)) return null;
    visited.add(obj);
    if (obj instanceof PDFStream) return walk(obj.dict, path + '/stream-dictionary');
    if (obj instanceof PDFDict)
      for (const [key, value] of obj.entries()) {
        const next = path + '/' + key.decodeText();
        if (forbidden.has(key.decodeText())) return next;
        if (value instanceof PDFName && ['Filespec', 'EmbeddedFile'].includes(value.decodeText()))
          return next;
        const found = walk(value, next);
        if (found) return found;
      }
    if (obj instanceof PDFArray)
      for (const [i, value] of obj.asArray().entries()) {
        const found = walk(value, path + `[${i}]`);
        if (found) return found;
      }
    return null;
  };
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    const found = walk(obj, ref.toString());
    if (found) return found;
  }
  return null;
}

/** Valid xref offsets, with hex-escaped action names rather than a broken byte replacement. */
export function escapedJavascriptPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /S /Java#53cript /J#53 (synthetic - never execute) >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << >> /Contents 5 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}
