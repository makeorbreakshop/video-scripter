import {refreshChannelStatsSql} from '../app/channel-stats';
export interface StatsClient {query(sql:string,values?:any[]):Promise<{rows: {channel_id:string}[]}>}
export async function refreshScoredChannels(client:StatsClient,channelIds:Iterable<string>):Promise<string[]> {
 const ids=[...new Set(channelIds)].filter(Boolean);
 if (!ids.length) return [];
 const result=await client.query(refreshChannelStatsSql(true),[ids]);
 return result.rows.map(r=>r.channel_id);
}
