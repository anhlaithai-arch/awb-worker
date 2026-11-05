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

    const items = content.items
      .filter(it => it.str && it.str.trim() !== '')
      .map(it => ({
        str: it.str,
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round(it.transform[5] * 10) / 10,
        w: Math.round((it.width || 0) * 10) / 10
      }));

    // Gom mảnh thành dòng: cùng y (dung sai 2), sắp theo x
    const rows = groupRows(items);

    const result = {
      ok: true,
      awb: pickAwb(rows),
      sort_line: pickSortLine(rows),
      sender: pickBlock(rows, /^từ\s*:/i, 'left'),
      receiver: pickBlock(rows, /^đến\s*:/i, 'right')
    };
    if (body.debug) result.rows = rows.map(r => `y=${r.y} x=${r.x} | ${r.text}`);

    return Response.json(result);
  }
};

function groupRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find(r => Math.abs(r.y - it.y) <= 2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map(r => {
    const s = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < s.length; i++) {
      if (i > 0) {
        const gap = s[i].x - (s[i - 1].x + s[i - 1].w);
        if (gap > 1.2) text += ' ';
      }
      text += s[i].str;
    }
    return { y: r.y, x: s[0].x, text: text.replace(/\s+/g, ' ').trim(), items: s };
  }).sort((a, b) => b.y - a.y);
}

function pickAwb(rows) {
  for (const r of rows) {
    const m = r.text.match(/SPXVN\w+/);
    if (m) return m[0];
  }
  return '';
}

// Mã phân loại lớn: dòng nằm ngay dưới mã vạch, có dạng XX-dd-dd-... và đứng ở nửa trên nhãn
function pickSortLine(rows) {
  const tu = rows.find(r => /^từ\s*:/i.test(r.text));
  const top = tu ? tu.y : 0;
  const cands = rows.filter(r => r.y > top && /^[A-Z]{2}-\d{2}-\d{2}/.test(r.text));
  return cands.length ? cands[0].text : '';
}

// Lấy khối dưới dòng tiêu đề ("Từ:" hoặc "Đến:") theo cột x, dừng ở dòng "***"
function pickBlock(rows, reTitle, side) {
  const tu = rows.find(r => /^từ\s*:/i.test(r.text));
  const den = rows.find(r => /^đến\s*:/i.test(r.text));
  const title = side === 'left' ? tu : den;
  if (!title) return '';

  const stop = rows.find(r => /^\*\*\*/.test(r.text) && r.y < title.y);
  const bottom = stop ? stop.y : 0;

  const xMin = title.x - 2;
  const xMax = side === 'left' && den ? den.x - 2 : Infinity;

  const lines = [];
  for (const r of rows) {
    if (r === title || r.y >= title.y - 1 || r.y <= bottom + 1) continue;
    const part = r.items.filter(it => it.x >= xMin && it.x < xMax);
    if (!part.length) continue;
    let text = '';
    for (let i = 0; i < part.length; i++) {
      if (i > 0 && part[i].x - (part[i - 1].x + part[i - 1].w) > 1.2) text += ' ';
      text += part[i].str;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}
