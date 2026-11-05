import { handleSheetAction } from './sheet-ai.mjs';
import { getDocument } from 'unpdf/pdfjs';
const BASE='https://spx.shopee.vn';
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export default {
  async fetch(request, env) {
    if(request.method==='GET') return reply({
      ok:true,
      version:'awb-sheet-ai-2.0.2-json-schema',
      config:{
        worker_api_key_present:typeof env?.WORKER_API_KEY==='string' && env.WORKER_API_KEY.length>0,
        worker_api_key_length:typeof env?.WORKER_API_KEY==='string' ? env.WORKER_API_KEY.length : 0,
        worker_api_key_valid:typeof env?.WORKER_API_KEY==='string' && env.WORKER_API_KEY.length>=24,
        google_service_account_present:typeof env?.GOOGLE_SERVICE_ACCOUNT_JSON==='string' && env.GOOGLE_SERVICE_ACCOUNT_JSON.length>0
      }
    });
    if(request.method!=='POST') return reply({ok:false,error:'Chỉ hỗ trợ POST.'},405);
    let task,debug=false;
    try {
      let body;
      try {body=await request.json();}catch{return reply({ok:false,error:'Body phải là JSON.'},400);}
      if (['address_lookup','sheet_test'].includes(body?.action)) return handleSheetAction(request,body,env);
      if (body?.action === 'ai_test') {
        if (!env || !env.AI) return reply({ok:false,error:'Chưa có Workers AI binding tên AI.'},400);
        try {
          const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
            messages:[{role:'user',content:'Reply with exactly one word: OK'}],
            max_tokens:16
          });
          return reply({ok:true,action:'ai_test',model:'@cf/meta/llama-3.1-8b-instruct-fp8',response:answer.response || answer});
        } catch (error) {
          return reply({ok:false,error:'Workers AI test lỗi: ' + String(error.message || error).slice(0,700)},502);
        }
      }
      debug=body?.debug===true;
      let url;
      try {url=new URL(body?.awb_url);}catch{return reply({ok:false,error:'Thiếu awb_url hợp lệ.'},400);}
      if(url.origin!==BASE || url.pathname!=='/api/awb_print/label/print' || !url.searchParams.has('token_str')) {
        return reply({ok:false,error:'Chỉ nhận link nhãn AWB của SPX.'},400);
      }
      const res=await fetch(url.href,{redirect:'manual',signal:AbortSignal.timeout(25000)});
      if(!res.ok) {await res.body?.cancel();return reply({ok:false,error:'AWB HTTP '+res.status},502);}
      if(!res.body) throw new Error('PDF rỗng.');
      const reader=res.body.getReader(),chunks=[];let size=0;
      try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>3*1024*1024){await reader.cancel();throw new Error('PDF vượt 3 MB.');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new Error('Link không trả PDF.');
      task=getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,verbosity:0,maxImageSize:16777216});
      const pdf=await task.promise;
      if(pdf.numPages!==1) throw new Error('Bản này chỉ xử lý nhãn một trang.');
      const page=await pdf.getPage(1),content=await page.getTextContent();
      // Keep whitespace fragments to preserve spaces between Vietnamese words.
      const items=content.items.filter(it=>typeof it.str==='string' && it.str.length).map(it=>({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width||0}));
      let parsed;
      try{parsed=parseLabel(items);}catch(error){return reply({ok:false,error:error.message,...(debug?{items,rows:groupRows(items).map(r=>({y:r.y,text:r.text}))}:{})},422);}
      const {rows,...result}=parsed;
      return reply({ok:true,...result,...(debug?{items,rows:rows.map(r=>({y:r.y,text:r.text}))}:{})});
    }catch{return reply({ok:false,error:'Không tải hoặc giải mã được PDF AWB.'},502);}
    finally{if(task)await task.destroy();}
  }
};

function fold(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
}
function joinLine(items) {
  const sorted = [...items].sort((a,b)=>a.x-b.x);
  let text='', end=-Infinity;
  for (const it of sorted) {
    if (text && it.x-end>1.2 && !/\s$/.test(text) && !/^\s/.test(it.str)) text+=' ';
    text+=it.str;
    end=Math.max(end,it.x+it.w);
  }
  return text.replace(/\s+/g,' ').trim();
}
function groupRows(items) {
  const rows=[];
  for(const it of [...items].sort((a,b)=>b.y-a.y || a.x-b.x)) {
    let row=rows.find(r=>Math.abs(r.y-it.y)<=2);
    if(!row) {row={y:it.y,items:[]};rows.push(row);}
    row.items.push(it);
  }
  return rows.map(r=>({...r,items:r.items.sort((a,b)=>a.x-b.x),text:joinLine(r.items)})).sort((a,b)=>b.y-a.y);
}
function findTitle(rows, word) {
  // Look inside each row: a row can contain BOTH Từ: and Đến:.
  // Test neighboring fragments too, since Vietnamese glyphs may be split.
  const pattern=new RegExp('^'+word+'\\s*:$');
  for(const row of rows) {
    for(let i=0;i<row.items.length;i++) {
      if (!row.items[i].str.trim()) continue; // Anchor must start at visible ink, never whitespace.
      for(let j=i;j<Math.min(row.items.length,i+8);j++) {
        const part=row.items.slice(i,j+1);
        if(pattern.test(fold(joinLine(part)))) return {x:part[0].x,y:row.y};
      }
    }
  }
  return null;
}
function pickBlocks(rows) {
  const senderTitle=findTitle(rows,'tu'), receiverTitle=findTitle(rows,'den');
  if(!senderTitle || !receiverTitle || Math.abs(senderTitle.y-receiverTitle.y)>5 || receiverTitle.x<=senderTitle.x) {
    throw new Error('Không xác định được hai cột Từ/Đến.');
  }
  const stops=rows.filter(r=>r.y<receiverTitle.y-3 &&
    (/^\s*\*{3}/.test(r.text) || /^noi\s*dung\s*hang/.test(fold(r.text))));
  if(!stops.length) throw new Error('Không xác định được cuối vùng người nhận.');
  const bottom=stops[0].y;
  const cut=(anchor,left,right)=>rows.filter(r=>r.y<anchor.y-2 && r.y>bottom+1)
    .map(r=>joinLine(r.items.filter(it=>it.x>=left && it.x<right)))
    .filter(Boolean).join('\n');
  const sender=cut(senderTitle,senderTitle.x-2,receiverTitle.x-2);
  const receiver=cut(receiverTitle,receiverTitle.x-2,Infinity);
  if(!receiver) throw new Error('Vùng Đến không có text.');
  return {sender,receiver};
}
function parseLabel(items) {
  const rows=groupRows(items);
  const blocks=pickBlocks(rows);
  const awb=rows.map(r=>r.text.match(/SPXVN[A-Z0-9]+/i)?.[0]).find(Boolean)||'';
  const title=findTitle(rows,'tu');
  const sort=rows.find(r=>r.y>title.y && /^[A-Z]{2,4}\d*-\d{2}-\d{2}/.test(r.text));
  const lines=blocks.receiver.split('\n');
  const combined=lines.join(' ');
  const marker=/\bDchi\b|Địa\s+chỉ\s*:/i.exec(combined);
  // For ordinary labels the first recipient line is the name.
  const name=marker?combined.slice(0,marker.index).trim():lines[0];
  const address=marker?combined.slice(marker.index).trim():lines.slice(1).join(' ').trim();
  return {awb,sort_line:sort?.text||'',...blocks,recipient_name:name,address,rows};
}
