import { getDocumentProxy } from 'unpdf';

const ALLOWED_PREFIX = 'https://spx.shopee.vn/api/awb_print/label/print?';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return new Response('Body không phải JSON', { status: 400 }); }

    const awbUrl = body.awb_url;
    if (!awbUrl || !awbUrl.startsWith(ALLOWED_PREFIX)) {
      return new Response('URL không hợp lệ', { status: 400 });
    }

    const r = await fetch(awbUrl, { headers: { Referer: 'https://spx.shopee.vn/' } });
    if (!r.ok) return new Response('SPX trả ' + r.status, { status: 502 });

    const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()));
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();

    // Dữ liệu gốc: từng mảnh chữ kèm tọa độ (PDF: y càng lớn càng ở trên)
    const items = content.items
      .filter(it => it.str && it.str.trim() !== '')
      .map(it => ({
        str: it.str,
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round(it.transform[5] * 10) / 10,
        w: Math.round((it.width || 0) * 10) / 10
      }));

    const result = {
      ok: true,
      awb: pickAwb(items),
      sort_line: pickSortLine(items),
      sender: pickBlock(items, 'sender'),
      receiver: pickBlock(items, 'receiver')
    };
    if (body.debug) result.items = items;   // gửi debug:true để xem toàn bộ tọa độ

    return Response.json(result);
  }
};

function pickAwb(items) {
  for (const it of items) {
    const m = it.str.match(/SPXVN\w+/);
    if (m) return m[0];
  }
  return '';
}

function pickSortLine(items) {
  const a = items.find(it => /^[A-Z]{2}-\d{2}-\d{2}-/.test(it.str.trim()));
  if (!a) return '';
  // gộp các mảnh cùng hàng (vd "MB-22-07-TT10-N" + "DV - Huy")
  return joinLine(items.filter(it => Math.abs(it.y - a.y) <= 4 && it.x >= a.x - 2));
}

// Gom mảnh chữ thành các dòng theo y, trong mỗi dòng sắp theo x
function toLines(arr) {
  const sorted = [...arr].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map(l => joinLine(l.items));
}

function joinLine(arr) {
  const s = [...arr].sort((p, q) => p.x - q.x);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0) {
      const gap = s[i].x - (s[i - 1].x + s[i - 1].w);
      if (gap > 1.5) out += ' ';
    }
    out += s[i].str;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Khối "Từ:" (bên trái) và "Đến:" (bên phải): lọc theo vị trí
function pickBlock(items, which) {
  const tu = items.find(it => /^từ\s*:?$/i.test(it.str.trim()));
  const den = items.find(it => /^đến\s*:?$/i.test(it.str.trim()));
  const stop = items.find(it => /^\*\*\*/.test(it.str.trim()));
  const noiDung = items.find(it => /^nội dung hàng/i.test(it.str.trim()));
  const anchor = which === 'sender' ? tu : den;
  if (!anchor) return '';

  const bottom = stop ? stop.y : (noiDung ? noiDung.y : 0);
  const xMin = anchor.x - 2;
  const xMax = which === 'sender' && den ? den.x - 2 : Infinity;

  const picked = items.filter(it =>
    it !== anchor &&
    it.x >= xMin && it.x < xMax &&
    it.y < anchor.y - 1 &&
    it.y > bottom + 1
  );
  return toLines(picked).join('\n');
}
