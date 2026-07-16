// Clone template XLSX bằng JSZip (port từ globeway-renbill/lib/xlsx-zip-engine.js) — KHÔNG dùng ExcelJS để
// GIỮ NGUYÊN 100% layout/format A4 của template (ExcelJS rebuild styles làm tràn trang). Với mỗi hóa đơn:
// clone sheet1.xml → sheetN.xml, thay giá trị ô qua regex, cập nhật sharedStrings/workbook/ContentTypes/rels.
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

export type CellOverride = { type: 'string' | 'number'; value: string | number };
export type Overrides = Record<string, CellOverride>;

function escXml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export class TemplateZip {
  private zip: JSZip;
  private sst: string[] = [];
  private sstMap = new Map<string, number>();
  private sheet1Xml = '';
  private sheet1Rels = '';
  private workbookXml = '';
  private contentTypes = '';
  private workbookRels = '';
  private sheets: { name: string; sheetIdx: number; rId: number }[] = [];

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async fromFile(path: string): Promise<TemplateZip> {
    const buf = await readFile(path);
    const zip = await JSZip.loadAsync(buf);
    const tz = new TemplateZip(zip);
    await tz.loadFromTemplate();
    return tz;
  }

  private async loadFromTemplate(): Promise<void> {
    const sstFile = this.zip.file('xl/sharedStrings.xml');
    if (sstFile) {
      const sstXml = await sstFile.async('string');
      const re = /<si\s*\/>|<si>([\s\S]*?)<\/si>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sstXml)) !== null) {
        const inner = m[1] || '';
        let text = '';
        const tRe = /<t[^>]*>([^<]*)<\/t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = tRe.exec(inner)) !== null) text += this.decodeXml(tm[1]);
        const idx = this.sst.length;
        this.sst.push(text);
        if (!this.sstMap.has(text)) this.sstMap.set(text, idx);
      }
    }

    const sheet1File = this.zip.file('xl/worksheets/sheet1.xml');
    if (!sheet1File) throw new Error('Template thiếu xl/worksheets/sheet1.xml — không phải XLSX hợp lệ');
    this.sheet1Xml = await sheet1File.async('string');
    const sheet1RelsFile = this.zip.file('xl/worksheets/_rels/sheet1.xml.rels');
    this.sheet1Rels = sheet1RelsFile ? await sheet1RelsFile.async('string') : '';
    const wbFile = this.zip.file('xl/workbook.xml');
    if (!wbFile) throw new Error('Template thiếu xl/workbook.xml');
    this.workbookXml = await wbFile.async('string');
    const ctFile = this.zip.file('[Content_Types].xml');
    if (!ctFile) throw new Error('Template thiếu [Content_Types].xml');
    this.contentTypes = await ctFile.async('string');
    const wbRelsFile = this.zip.file('xl/_rels/workbook.xml.rels');
    if (!wbRelsFile) throw new Error('Template thiếu xl/_rels/workbook.xml.rels');
    this.workbookRels = await wbRelsFile.async('string');
  }

  private decodeXml(s: string): string {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  private ssIndex(text: string): number {
    const t = String(text);
    const existing = this.sstMap.get(t);
    if (existing !== undefined) return existing;
    const idx = this.sst.length;
    this.sst.push(t);
    this.sstMap.set(t, idx);
    return idx;
  }

  private buildSheetXml(overrides: Overrides): string {
    let xml = this.sheet1Xml;
    const tAttrRe = /\s*t="[^"]*"/;

    for (const [ref, ov] of Object.entries(overrides)) {
      const v = ov.value;
      const isNumber = ov.type === 'number';
      let newInner = '';
      let extraAttr = '';
      if (v === null || v === undefined || v === '') {
        // để trống — giữ style template
      } else if (isNumber) {
        if (!Number.isFinite(v as number)) {
          newInner = '<v>0</v>';
        } else {
          newInner = `<v>${v}</v>`;
        }
      } else {
        const ssi = this.ssIndex(String(v));
        extraAttr = ' t="s"';
        newInner = `<v>${ssi}</v>`;
      }

      const re = new RegExp(`<c r="${ref}"([^>]*?)(\\/>|>[\\s\\S]*?<\\/c>)`);
      xml = xml.replace(re, (_full, attrs: string) => {
        const cleanedAttrs = attrs.replace(tAttrRe, '').trimEnd();
        return newInner
          ? `<c r="${ref}"${cleanedAttrs}${extraAttr}>${newInner}</c>`
          : `<c r="${ref}"${cleanedAttrs}/>`;
      });
    }
    return xml;
  }

  addSheet(name: string, overrides: Overrides): void {
    const sheetIdx = this.sheets.length + 2;
    const rId = this.sheets.length + 100;
    this.sheets.push({ name, sheetIdx, rId });

    const xml = this.buildSheetXml(overrides);
    this.zip.file(`xl/worksheets/sheet${sheetIdx}.xml`, xml);
    if (this.sheet1Rels) {
      this.zip.file(`xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`, this.sheet1Rels);
    }
  }

  async toBuffer(): Promise<Buffer> {
    const ssEntries = this.sst.map((s) => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('');
    const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.sst.length}" uniqueCount="${this.sst.length}">${ssEntries}</sst>`;
    this.zip.file('xl/sharedStrings.xml', sstXml);

    const sheetsXml = this.sheets
      .map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${s.rId}"/>`)
      .join('');
    let wb = this.workbookXml;
    wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsXml}</sheets>`);
    this.zip.file('xl/workbook.xml', wb);

    let wbRels = this.workbookRels;
    const relsRe = /<Relationship[^>]*\/>/g;
    const existingRels = wbRels.match(relsRe) || [];
    const keepRels = existingRels.filter((r) => !/Type="[^"]*\/worksheet"/.test(r));
    const newSheetRels = this.sheets
      .map((s) => `<Relationship Id="rId${s.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.sheetIdx}.xml"/>`)
      .join('');
    const allRels = keepRels.join('') + newSheetRels;
    wbRels = wbRels.replace(/<Relationships[^>]*>[\s\S]*<\/Relationships>/,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${allRels}</Relationships>`);
    this.zip.file('xl/_rels/workbook.xml.rels', wbRels);

    let ct = this.contentTypes;
    ct = ct.replace(/<Override PartName="\/xl\/worksheets\/sheet1\.xml"[^>]*\/>/g, '');
    ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, '');
    const newOverrides = this.sheets
      .map((s) => `<Override PartName="/xl/worksheets/sheet${s.sheetIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('');
    ct = ct.replace(/<\/Types>/, `${newOverrides}</Types>`);
    this.zip.file('[Content_Types].xml', ct);

    this.zip.remove('xl/worksheets/sheet1.xml');
    this.zip.remove('xl/worksheets/_rels/sheet1.xml.rels');
    this.zip.remove('xl/calcChain.xml');

    return this.zip.generateAsync({ type: 'nodebuffer' });
  }
}
