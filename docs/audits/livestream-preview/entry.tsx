import React from 'react';
import {createRoot} from 'react-dom/client';
import {MarkerHoverProvider,VideoChart} from '../../../components/app/video-chart';
import {Thumb} from '../../../components/app/thumb';
import view from './view.json';
const v:any=view;
function Preview(){return <main style={{maxWidth:1150,margin:'32px auto',padding:'0 18px'}}>
<style>{`.vp-head{display:flex;gap:16px;align-items:flex-start;margin-bottom:18px}.vp-th{width:200px;flex:none}.cs-thumb{aspect-ratio:16/9;overflow:hidden;border-radius:6px}.cs-thumb img{width:100%;height:100%;object-fit:cover}h1{margin:4px 0 12px}@media(max-width:719px){.vp-head{flex-direction:column;gap:12px}.vp-th{width:100%;max-width:320px}}`}</style>
<div className="vp-head"><div className="vp-th"><Thumb src={v.thumbUrl} fallbackSrc={v.thumbFallbackUrl} alt="" loading="eager" fetchPriority="high"/></div><div style={{minWidth:0}}>
<a style={{color:'var(--cs-accent)',fontWeight:600}}>{v.channelName}</a>
<h1 style={{fontSize:25}}>{v.title}</h1>
<p style={{color:'var(--cs-muted)'}}><span title={v.broadcastNotice}>Stream started</span> Sep 3, 11:57 AM ET · {v.views.toLocaleString()} views at last capture</p>
</div></div>
<MarkerHoverProvider><VideoChart publishedAt={v.chartOriginAt} actuals={v.actuals} series={v.series} curve={v.curve} marks={v.marks} score={null} comparison={v.comparison}/></MarkerHoverProvider>
</main>}
createRoot(document.getElementById('root')!).render(<Preview/>);
