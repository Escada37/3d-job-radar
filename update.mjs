import { readFile, writeFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url)));
const file = new URL('./data.json', import.meta.url);
let previous = { jobs: [], notified: [], initialized: false };
try { previous = JSON.parse(await readFile(file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const errors = [], jobs = [];
const strip = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#39;|&amp;|&quot;/g, ' ').replace(/\s+/g, ' ').trim();
for (const board of config.boards) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.jobs)) throw new Error('Неожиданный ответ');
    for (const j of data.jobs) {
      const title = strip(j.title), description = strip(j.content);
      const titleLower = title.toLowerCase();
      if (!config.keywords.some(k => titleLower.includes(k.toLowerCase()))) continue;
      const all = `${title} ${description}`.toLowerCase();
      const hints = [];
      if (/stylized|stylised|стилизован|hand.paint/.test(all)) hints.push('Стилизация');
      if (/remote|удал[её]н/.test(all)) hints.push('Упоминается удалённая работа');
      if (/russia|росси/.test(all)) hints.push('Упоминается Россия');
      jobs.push({id:`greenhouse:${board}:${j.id}`, title, company:board, location:strip(j.location?.name) || 'Не указано', url:j.absolute_url, updated:j.updated_at, hints});
    }
  } catch (e) { errors.push({source:board,error:e.message}); }
}
// Keep the prior jobs of failed sources rather than silently treating them as closed.
for (const old of previous.jobs || []) if (errors.some(e => e.source === old.company) && !jobs.some(j=>j.id===old.id)) jobs.push({...old, stale:true});
jobs.sort((a,b)=>(b.updated||'').localeCompare(a.updated||''));
const known = new Set(previous.notified || []);
const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
let notificationError = null;
if (previous.initialized && token && chat) {
  for (const job of jobs.filter(j=>!known.has(j.id) && !j.stale).slice(0,50)) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({chat_id:chat,text:`Новая вакансия: ${job.title}\n${job.company} · ${job.location}\n${job.hints.join(' · ')}\n${job.url}`,disable_web_page_preview:true}),signal:AbortSignal.timeout(15000)});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('Telegram не принял сообщение');
      known.add(job.id);
    } catch { notificationError = 'Не удалось отправить уведомление. Проверьте секреты и журнал запуска.'; break; }
  }
} else if (!previous.initialized) { for (const job of jobs) known.add(job.id); }
const result = {updatedAt:new Date().toISOString(), initialized:true, sources:config.boards, errors, notificationError, jobs:jobs.slice(0,config.maxResults), notified:[...known].slice(-5000)};
await writeFile(file, JSON.stringify(result,null,2)+'\n');
console.log(`Найдено: ${jobs.length}; ошибок источников: ${errors.length}; уведомления: ${notificationError || (token && chat ? 'включены' : 'не настроены')}`);
