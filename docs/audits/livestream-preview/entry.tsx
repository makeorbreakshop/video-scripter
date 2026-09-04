import React from 'react';
import {createRoot} from 'react-dom/client';
import {MarkerHoverProvider,VideoChart} from '../../../components/app/video-chart';
import view from './view.json';
const v:any=view;
function Preview(){return <main style={{maxWidth:1150,margin:'32px auto',padding:'0 18px'}}>
<a style={{color:'var(--cs-accent)',fontWeight:600}}>{v.channelName}</a>
<h1 style={{fontSize:25}}>{v.title}</h1>
<p style={{color:'var(--cs-muted)'}}>Stream started Sep 3, 11:57 AM ET · {v.views.toLocaleString()} views at last capture</p>
<p style={{color:'var(--cs-muted)',maxWidth:'70ch'}}>{v.broadcastNotice}</p>
<h3>Views since stream start</h3>
<MarkerHoverProvider><VideoChart publishedAt={v.chartOriginAt} actuals={v.actuals} series={v.series} curve={v.curve} marks={v.marks} score={null} comparison={v.comparison}/></MarkerHoverProvider>
</main>}
createRoot(document.getElementById('root')!).render(<Preview/>);
