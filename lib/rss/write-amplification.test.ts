import fs from 'node:fs';
import path from 'node:path';
import {recordTitleChange,TITLE_WATCH_STAMP_ONE_SQL} from './title-change';
jest.mock('../app/revalidate-remote',()=>({revalidateRemote:jest.fn(async()=>{})}));

test('title sync preserves authoritative evidence without the abandoned scheduler stamp',async()=>{
 const sql:string[]=[];const pool={query:jest.fn(async(q:string)=>{sql.push(q);return {rows:q.includes('max(version)')?[{v:1}]:[]};})};
 const now=new Date('2026-10-13T18:00:00Z');
 const result=await recordTitleChange(pool as any,'v','old','new','2020-01-01',now,null);
 expect(result.kind).toBe('sync');expect(sql).toContain(TITLE_WATCH_STAMP_ONE_SQL);
 expect(sql.some(q=>q.includes('insert into title_versions'))).toBe(true);
 expect(sql.some(q=>q.includes('update videos set title'))).toBe(true);
 expect(sql.some(q=>q.includes('update track_schedule'))).toBe(false);
});

test('real title changes still reopen the launch tracking lane',async()=>{
 const sql:string[]=[];const pool={query:jest.fn(async(q:string)=>{sql.push(q);return {rows:q.includes('max(version)')?[{v:1}]:[]};})};
 const now=new Date('2026-10-13T18:00:00Z');
 const result=await recordTitleChange(pool as any,'v','old','new',now,now,null);
 expect(result.kind).toBe('change');expect(sql.some(q=>q.includes('update track_schedule set phase'))).toBe(true);
});

test('RSS flush does not write the unused last-title-check checkpoint',()=>{
 const source=fs.readFileSync(path.join(process.cwd(),'scripts/rss-poll.ts'),'utf8');
 expect(source).not.toContain("await insert('track_schedule.checked'");
 expect(source).toContain("await insert('video_title_watch', TITLE_WATCH_UPSERT_SQL");
});
