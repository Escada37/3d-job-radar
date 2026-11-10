import { readFile, writeFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url)));
const file = new URL('./data.json', import.meta.url);
let previous = { jobs: [], notified: [], initialized: false };
try { previous = JSON.parse(await readFile(file)); } catch(e) { if(e.code !== 'ENOENT') throw e; }
const errors=[], jobs=[];
const decode = s => s.replace(/&#(x[\da-f]+|\d+);/gi, (_,v)=>String.fromCodePoint(v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):+v)).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ');
const strip = s => decode(String(s||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
for(const channel of config.channels){
 try {
  const r=await fetch(`https://t.me/s/${encodeURIComponent(channel)}`,{signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw Error(`HTTP ${r.status}`);
  const html=await r.text();
  const chunks=html.split(/(?=<div class="tgme_widget_message_wrap\b)/);
  if(chunks.length<2) throw Error('Публикации не найдены');
  for(const chunk of chunks.slice(1)){
   const post=chunk.match(/data-post="([^"/]+\/\d+)"/)?.[1];
   const raw=chunk.match(/<div class="tgme_widget_message_text[^" ]*(?: [^" ]+)*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
   const date=chunk.match(/<time[^>]+datetime="([^"]+)"/)?.[1];
   if(!post||!raw||!date)continue;
   const description=strip(raw), all=description.toLowerCase();
   if(!/(?:3\s*д|3\s*d|тр[её]хмерн)/i.test(all) || !/(художник|artist|модел|model|персонаж|character|пропс|prop|окружени|environment|generalist|женералист)/i.test(all)) continue;
   if(!/(стилиз|styliz|stylis|casual|казуал|hand.painted|low.poly|лоу.пол|персонаж|character|пропс|prop|окружени|environment|hard.surface|хард.серф)/i.test(all))continue;
   const title=description.split('\n').map(x=>x.trim()).find(x=>/3\s*[dд]|художник|artist|моделлер/i.test(x)&&x.length>5&&x.length<150) || 'Вакансия для 3D-художника';
   const hints=[];if(/стилиз|styliz|stylis|casual|казуал|hand.painted/i.test(all))hints.push('Стилизация');if(/remote|удал[её]н|удаленк/i.test(all))hints.push('Упоминается удалённая работа');
   jobs.push({id:`telegram:${post}`,title,company:channel,location:'Условия — в объявлении',url:`https://t.me/${post}`,updated:date,hints});
  }
 }catch(e){errors.push({source:channel,error:e.message});}
}
for(const old of previous.jobs||[]) if(errors.some(e=>e.source===old.company)&&!jobs.some(j=>j.id===old.id))jobs.push({...old,stale:true});
jobs.sort((a,b)=>(b.updated||'').localeCompare(a.updated||''));
const known=new Set(previous.notified||[]),token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
let notificationError=null;
if(previous.initialized && token && chat){
 for(const job of jobs.filter(j=>!known.has(j.id)&&!j.stale).slice(0,50)){
  try{const res=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:`Новая вакансия: ${job.title}\nИсточник: ${job.company}\n${job.hints.join(' · ')}\n${job.url}`,disable_web_page_preview:true}),signal:AbortSignal.timeout(15000)});const d=await res.json();if(!res.ok||!d.ok)throw Error();known.add(job.id)}catch{notificationError='Не удалось отправить уведомление. Проверьте секреты и журнал запуска.';break}
 }
}else if(!previous.initialized){for(const job of jobs)known.add(job.id)}
await writeFile(file,JSON.stringify({updatedAt:new Date().toISOString(),initialized:true,sources:config.channels,errors,notificationError,jobs:jobs.slice(0,config.maxResults),notified:[...known].slice(-5000)},null,2)+'\n');
console.log(`Найдено: ${jobs.length}; ошибок источников: ${errors.length}; уведомления: ${notificationError||(token&&chat?'включены':'не настроены')}`);
