// Reselling HQ: a small Excel (.xlsx) writer and reader, enough for the Download backup button and for
// bringing in an old tracker. No outside library: an .xlsx file is a zip of a few XML files.
// Runs in the browser (window.RHQXlsx) and in the tests (require).
(function (root) {
const enc = new TextEncoder(), dec = new TextDecoder();
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const xmlUnesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'"}[e.toLowerCase()]);
const colName = i => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/* ---------- zip ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// Files are stored uncompressed: simple, and Excel, Numbers and Google Sheets all open it.
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nm.length, 2], [28, 0, 2]]
      .forEach(([o, v, n]) => n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, n]) => n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true));
    parts.push(new Uint8Array(head.buffer), nm, data);
    central.push(new Uint8Array(cen.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([o, v, n]) => n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not_a_zip");
  const count = v.getUint16(e + 10, true), files = {};
  let p = v.getUint32(e + 16, true);
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("bad_zip");
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), raw = bytes.subarray(start, start + csize);
    files[name] = {method, raw};
    p += 46 + nlen + xlen + clen;
  }
  return {async text(name) { const f = files[name]; if (!f) return null; return dec.decode(f.method === 8 ? await inflate(f.raw) : f.raw); }};
}

/* ---------- xlsx ---------- */
// sheets: [{name, rows: [[cell, ...], ...]}]. Numbers stay numbers; everything else is text.
function writeXlsx(sheets) {
  const sheetXml = rows => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + rows.map((r, y) => `<row r="${y + 1}">` + r.map((c, x) => {
      if (c == null || c === "") return "";
      const ref = colName(x) + (y + 1);
      return typeof c === "number" && isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"${y === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEsc(c)}</t></is></c>`;
    }).join("") + "</row>").join("") + "</sheetData></worksheet>";
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => `<sheet name="${xmlEsc(String(s.name).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets></workbook>"],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]),
  ];
  return zip(files);
}
// Returns [{name, rows}] with every cell as text (Excel dates come back as day numbers, which the importer understands).
async function readXlsx(bytes) {
  const z = await unzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const wb = await z.text("xl/workbook.xml"); if (!wb) throw new Error("not_xlsx");
  const rels = (await z.text("xl/_rels/workbook.xml.rels")) || "";
  const target = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/), t = m[0].match(/Target="([^"]+)"/); if (id && t) target[id[1]] = t[1]; }
  const shared = []; const ss = await z.text("xl/sharedStrings.xml");
  if (ss) for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlUnesc([...si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = xmlUnesc((m[0].match(/name="([^"]*)"/) || [])[1] || ""), rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    let path = target[rid] || ""; path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
    const xml = await z.text(path); if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const y = +((r[0].match(/\br="(\d+)"/) || [])[1] || rows.length + 1) - 1, row = [];
      for (const c of (r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (c[1].match(/\br="([A-Z]+\d+)"/) || [])[1], t = (c[1].match(/\bt="(\w+)"/) || [])[1], body = c[2] || "";
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const val = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? xmlUnesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")) : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v != null ? xmlUnesc(v) : "";
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[y] = Array.from(row, x => x ?? "");
    }
    out.push({name, rows: Array.from(rows, x => x || [])});
  }
  return out;
}
// One sheet as tab-separated text, so the same table reader handles CSV files and Excel tabs.
const rowsToTsv = rows => rows.map(r => r.map(c => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");

const RHQXlsx = {writeXlsx, readXlsx, rowsToTsv, crc32};
if (typeof module === "object" && module.exports) module.exports = RHQXlsx; else root.RHQXlsx = RHQXlsx;
})(typeof self !== "undefined" ? self : this);
