/** Walk indexed change keys before applying content eligibility. Keep PostgreSQL's exact
 * timestamp text (including microseconds) so equal clocks paginate without loss. */
export interface SemanticCursor {at:string;id:string}
export const SEMANTIC_CHANGE_WINDOW_SQL=`/* trace:semantic.change-window */
 SELECT id,greatest(coalesce(semantic_changed_at,updated_at),published_at)::text AS at
 FROM videos
 WHERE greatest(coalesce(semantic_changed_at,updated_at),published_at)>=$1::timestamptz
 AND ($2::timestamptz IS NULL OR (greatest(coalesce(semantic_changed_at,updated_at),published_at),id)>($2::timestamptz,$3::text))
 ORDER BY greatest(coalesce(semantic_changed_at,updated_at),published_at),id LIMIT $4`;
export async function readSemanticChangeWindow(
 db:{query:(sql:string,values:any[])=>Promise<{rows:any[]}>},since:Date|string,cursor:SemanticCursor|null,limit:number,
):Promise<{ids:string[];cursor:SemanticCursor|null;done:boolean}>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw Error('semantic change window must be 1..5000');
 const rows=(await db.query(SEMANTIC_CHANGE_WINDOW_SQL,[since,cursor?.at??null,cursor?.id??'',limit])).rows;
 const last=rows.at(-1);return {ids:rows.map(r=>r.id),cursor:last?{at:last.at,id:last.id}:cursor,done:rows.length<limit};
}
