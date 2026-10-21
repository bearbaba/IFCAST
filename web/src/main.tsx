import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity, ArrowRight, ArrowUpRight, BookOpen, Check, Clock3, Coins, ExternalLink, GitBranch, Globe2, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Trophy, Wallet, X} from 'lucide-react';
import {connectWallet, ready, read, write, TOKENS, type Market, type MarketKind, type Position, type Side, type Token, type Tx} from './genlayer';
import './style.css';

type Page = 'markets' | 'create' | 'activity';
const CACHE_KEY = 'ifcast-crypto-v02-tx';
const short = (s: string) => s.length > 17 ? `${s.slice(0,6)}…${s.slice(-4)}` : s;
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);
const time = (s: number) => new Date(s * 1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const utc = (s: number) => new Date(s * 1000).toISOString().replace('T',' ').slice(0,16) + ' UTC';
const tokenDisplay = (t: string) => t ? `${t}/USDT` : '';
const title = (m: Market) => m.kind==='OUTPERFORM'
  ? `Will ${m.token_a} outperform ${m.token_b} over ${m.duration_hours} hours?`
  : `Will ${m.token_a} ${m.kind==='TOUCH_ABOVE'?'reach or exceed':'touch or fall below'} ${fmt(m.target_e8/100_000_000)} USDT?`;
const tomorrowHour = () => {
  const n = Math.ceil((Date.now()/1000 + 900) / 3600) * 3600;
  return new Date(n * 1000).toISOString().slice(0,16);
};
const formDefault = () => ({kind:'TOUCH_ABOVE' as MarketKind, token_a:'ETH' as Token,
  token_b:'SOL' as Token, threshold:'2500', duration:24, start:tomorrowHour()});
const priceUnits = (text: string): number | null => {
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) return null;
  const [whole, fraction=''] = text.split('.');
  const value = Number(whole) * 100_000_000 + Number(fraction.padEnd(8, '0'));
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000_000_000 ? value : null;
};
const statusLabel = (m: Market, now: number) => m.status!=='OPEN'?m.status:now>=m.close_at*1000?'CLOSED':'OPEN';

function App(){
  const [tab,setTab]=useState<Page>('markets');
  const [wallet,setWallet]=useState('');
  const [markets,setMarkets]=useState<Market[]>([]);
  const [balance,setBalance]=useState<number|null>(null);
  const [granted,setGranted]=useState(false);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [position,setPosition]=useState<Position|null>(null);
  const [stakeSide,setStakeSide]=useState<Side>('YES');
  const [stake,setStake]=useState('100');
  const [form,setForm]=useState(formDefault);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'ALL'|'PRICE'|'BATTLE'>('ALL');
  const [busy,setBusy]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [clock,setClock]=useState(Date.now());
  const [txs,setTxs]=useState<Tx[]>(()=>{try{return JSON.parse(localStorage.getItem(CACHE_KEY)??'[]') as Tx[]}catch{return []}});
  const selected=markets.find(m=>m.id===selectedId)??null;
  const canWrite=ready&&!!wallet&&!busy;

  useEffect(()=>{const handle=window.setInterval(()=>setClock(Date.now()),30000);return()=>clearInterval(handle)},[]);
  useEffect(()=>{localStorage.setItem(CACHE_KEY,JSON.stringify(txs.slice(0,80)))},[txs]);
  const refresh=useCallback(async(account=wallet)=>{
    if(!ready)return;
    setLoading(true);
    try{
      const count=Number(await read<number>('get_market_count'));
      const offset=Math.max(count-30,0);
      const list=count?await read<Market[]>('get_markets',[offset,Math.min(count,30)]):[];
      setMarkets([...list].reverse());
      if(account){
        const [b,g]=await Promise.all([read<number>('get_balance',[account]),read<boolean>('has_claimed_grant',[account])]);
        setBalance(Number(b));setGranted(Boolean(g));
      }else{setBalance(null);setGranted(false)}
      setError('');
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setLoading(false)}
  },[wallet]);
  useEffect(()=>{void refresh()},[refresh]);
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(ready)void refresh()},60000);
    return()=>clearInterval(timer);
  },[refresh]);
  useEffect(()=>{
    let live=true;
    setPosition(null);
    if(selectedId!==null&&wallet&&ready){
      void read<Position>('get_position',[selectedId,wallet])
        .then(p=>{if(live)setPosition(p?.side?p:null)})
        .catch(()=>{if(live)setPosition(null)});
    }
    return()=>{live=false};
  },[selectedId,wallet,txs]);
  useEffect(()=>{
    const p=window.ethereum;
    if(!p?.on)return;
    const onAccounts=(value:unknown)=>{
      const a=Array.isArray(value)&&typeof value[0]==='string'?value[0]:'';
      setWallet(a);setPosition(null);setBalance(null);
    };
    const onChain=()=>{setWallet('');setPosition(null);setNotice('Network changed. Reconnect to GenLayer Studionet.');};
    p.on('accountsChanged',onAccounts);p.on('chainChanged',onChain);
    return()=>{p.removeListener?.('accountsChanged',onAccounts);p.removeListener?.('chainChanged',onChain)};
  },[]);

  const doConnect=async()=>{
    setError('');
    try{const a=await connectWallet();setWallet(a);await refresh(a);setNotice('Wallet connected on Studionet.');}
    catch(e){setError(e instanceof Error?e.message:String(e))}
  };
  const transact=async(label:string, fn:string, args:(string|number)[], onDone?:()=>void)=>{
    setBusy(label);setNotice('');setError('');let txHash='';
    try{
      await write(fn,args,wallet,h=>{txHash=h;setTxs(previous=>[{hash:h,label,at:Date.now(),status:'pending'},...previous])});
      setTxs(previous=>previous.map(t=>t.hash===txHash?{...t,status:'finalized'}:t));
      await refresh(wallet);
      onDone?.();setNotice(`${label}: finalized successfully.`);
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      setError(message);
      if(txHash)setTxs(previous=>previous.map(t=>t.hash===txHash?{...t,status:message.includes('without successful execution')?'failed':'unverified',error:message}:t));
    }finally{setBusy('')}
  };
  const filtered=useMemo(()=>markets.filter(m=>{
    const matches=filter==='ALL'||(filter==='PRICE'&&m.kind!=='OUTPERFORM')||(filter==='BATTLE'&&m.kind==='OUTPERFORM');
    return matches&&(title(m).toLowerCase().includes(search.toLowerCase())||String(m.id)===search.trim());
  }),[markets,filter,search]);
  const staked=markets.reduce((sum,m)=>sum+m.yes_pool+m.no_pool,0);
  const previewKind=form.kind==='OUTPERFORM';
  const invalidPair=previewKind&&form.token_a===form.token_b;
  const submitCreate=(event:React.FormEvent)=>{
    event.preventDefault();
    const start=Date.parse(`${form.start}Z`)/1000;
    const threshold=previewKind?0:priceUnits(form.threshold);
    const now=Math.floor(Date.now()/1000);
    if(!Number.isSafeInteger(start)||start%3600!==0){setError('Start must be a whole UTC hour.');return;}
    if(start<now+900||start>now+7*86400){setError('Start must be 15 minutes to 7 days in the future.');return;}
    if(threshold===null){setError('Enter a positive USDT price with at most 8 decimal places.');return;}
    if(invalidPair){setError('Choose two different assets.');return;}
    void transact('Create crypto market','create_market',[form.kind,form.token_a,previewKind?form.token_b:'',threshold,start,form.duration],()=>{setTab('markets');setForm(formDefault())});
  };
  const open=(m:Market)=>{setSelectedId(m.id);setStake('100');setStakeSide('YES');setPosition(null)};
  const close=()=>setSelectedId(null);
  const resolveReady=selected?.status==='OPEN'&&clock>=selected.resolve_after*1000&&(!selected.attempts||clock>= (selected.last_attempt_at+600)*1000);
  return <div className="app-shell">
    <div className="ambient ambient-a"/><div className="ambient ambient-b"/>
    <header className="topbar"><div className="wrap topbar-inner">
      <button className="brand" onClick={()=>{close();setTab('markets')}}><span className="brand-mark"><GitBranch size={19}/></span>IF<span className="brand-accent">CAST</span><span className="brand-beta">CRYPTO V0.2</span></button>
      <nav className="desktop-nav"><button className={tab==='markets'?'active':''} onClick={()=>{close();setTab('markets')}}>Explore</button><button className={tab==='create'?'active':''} onClick={()=>setTab('create')}>Create market</button><button className={tab==='activity'?'active':''} onClick={()=>setTab('activity')}>Activity</button></nav>
      <div className="nav-actions"><span className="network-pill"><i/> Studionet</span><button className="wallet-btn" onClick={()=>wallet?setWallet(''):void doConnect()}><Wallet size={16}/>{wallet?short(wallet):'Connect wallet'}</button></div>
    </div></header>
    <main className="wrap">
      {!ready&&<div className="banner warn"><ShieldCheck size={18}/><div><strong>Crypto v0.2 is not deployed yet.</strong> This is real contract-integrated source code, not a mock market. Configure <code>VITE_IFCAST_CRYPTO_V02_ADDRESS</code> only after separately deploying and verifying the new contract. The old GitHub-only v0.1 address is intentionally incompatible.</div></div>}
      {error&&<div className="banner err" role="alert"><X size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {notice&&<div className="banner good" role="status"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss notice"><X size={16}/></button></div>}
      {tab==='markets'&&<>
        <section className="hero crypto-hero"><div className="hero-left"><div className="eyebrow"><Sparkles size={14}/> CRYPTO PREDICTIONS · PROVABLE OUTCOMES</div><h1>Make your <span>call.</span></h1><p>Will ETH touch 2,500 USDT? Can SOL outperform ETH in 24 hours? Simple YES/NO markets with fixed rules and on-chain demo-credit settlement.</p><div className="hero-actions"><button className="primary" onClick={()=>setTab('create')}>Create a market <ArrowUpRight size={17}/></button><a className="outline" href="https://github.com/bearbaba/IFCAST/tree/feat/crypto-v02" target="_blank" rel="noreferrer">View source <BookOpen size={17}/></a></div></div><div className="hero-art"><div className="orbit orbit-1"/><div className="orbit orbit-2"/><div className="orbit-center"><span>YES</span><Trophy size={27}/><span>NO</span></div><div className="orbit-tag top"><Clock3 size={14}/> UTC PRICE WINDOW</div><div className="orbit-tag bottom"><ShieldCheck size={14}/> ON-CHAIN SETTLEMENT</div></div></section>
        <section className="stats"><div><span>MARKETS IN VIEW</span><strong>{fmt(markets.length)}</strong></div><div><span>DEMO CREDITS STAKED</span><strong>{fmt(staked)}</strong></div><div><span>SETTLED / VOID</span><strong>{markets.filter(m=>m.status!=='OPEN').length}</strong></div><div className="balance-stat"><span>YOUR TEST CREDITS</span><strong>{balance===null?'—':fmt(balance)}</strong>{wallet&&!granted&&<button disabled={!canWrite} onClick={()=>void transact('Claim demo credits','claim_demo_credits',[])}>Get 1,000 credits <ArrowUpRight size={13}/></button>}</div></section>
        <div className="section-heading"><div><div className="eyebrow">CRYPTO MARKET EXPLORER</div><h2>Explore predictions <span className="heading-star">✳</span></h2><p>BTC · ETH · SOL · BNB · DOGE · AVAX · LINK · XRP — all pairs quote USDT.</p></div><div className="section-tools"><label className="search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search markets" aria-label="Search markets"/></label><button className="icon-button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh"><RefreshCcw size={18}/></button></div></div>
        <div className="filter-tabs"><button className={filter==='ALL'?'active':''} onClick={()=>setFilter('ALL')}>All markets</button><button className={filter==='PRICE'?'active':''} onClick={()=>setFilter('PRICE')}>Price Targets</button><button className={filter==='BATTLE'?'active':''} onClick={()=>setFilter('BATTLE')}>Coin Battles</button></div>
        <div className="markets-grid">{filtered.length?filtered.map(m=><button className="market-card" onClick={()=>open(m)} key={m.id}><div className="market-top"><div className="market-number">#{String(m.id).padStart(3,'0')} · {m.kind==='OUTPERFORM'?'COIN BATTLE':'PRICE TARGET'}</div><div className={`status ${m.status.toLowerCase()}`}>{statusLabel(m,clock)}</div></div><div className="crypto-pair"><span className="token-bubble">{m.token_a.slice(0,1)}</span>{m.kind==='OUTPERFORM'&&<span className="token-bubble alt">{m.token_b.slice(0,1)}</span>}<span>{m.kind==='OUTPERFORM'?`${m.token_a} vs ${m.token_b}`:tokenDisplay(m.token_a)}</span></div><h3>{title(m)}</h3><p className="market-context"><Clock3 size={14}/> {m.duration_hours}h window · ends {time(m.end_at)}</p><div className="bar"><div style={{width:`${m.yes_pool+m.no_pool?100*m.yes_pool/(m.yes_pool+m.no_pool):50}%`}}/></div><div className="odds"><span className="yes">YES · {fmt(m.yes_pool)} credits</span><span className="no">NO · {fmt(m.no_pool)} credits</span></div><div className="market-bottom"><span><Coins size={14}/>{fmt(m.yes_pool+m.no_pool)} demo credits</span><span><Clock3 size={14}/>{m.status==='OPEN'?`Starts ${time(m.start_at)}`:'Settled'}</span><ArrowUpRight size={17}/></div></button>):<div className="empty-state"><Globe2 size={34}/><h3>{loading?'Reading finalized markets...':search?'No matching markets':'No crypto markets on this contract yet'}</h3><p>{ready?'Create the first crypto market using verifiable hourly data.':'The v0.2 contract must first be deployed. No fake markets are shown.'}</p><button className="primary small" onClick={()=>setTab('create')}><Plus size={15}/> Market builder</button></div>}</div>
        <section className="how"><div className="eyebrow">CLEAR QUESTIONS · FIXED RESOLUTION RULES</div><div className="how-grid"><div><span className="how-icon"><Trophy size={21}/></span><h3>Price target</h3><p>YES if a completed hourly candle high touches the threshold; otherwise NO only after every candle is verified.</p></div><div><span className="how-icon"><GitBranch size={21}/></span><h3>Coin battles</h3><p>Compare percentage returns across the same UTC hours; a tie refunds both sides.</p></div><div><span className="how-icon"><ShieldCheck size={21}/></span><h3>Independent validation</h3><p>Validators independently re-read pinned hourly observations, compare results and evidence digests.</p></div></div></section>
      </>}
      {tab==='create'&&<section className="page"><div className="eyebrow">MARKET FACTORY / CRYPTO V0.2</div><h1>Ask a <span>better question.</span></h1><p className="page-lead">Choose a clear binary crypto market. Trading closes before the fixed UTC observation window begins. Settlement uses completed Binance Spot 1h candles in USDT, not an LLM's guess.</p><form className="form-card" onSubmit={submitCreate}><div className="form-card-header"><span className="step">01</span><div><h2>Create a market</h2><p>Once published, the price source, assets and window cannot be edited.</p></div></div>
        <label>MARKET TYPE<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as MarketKind})}><option value="TOUCH_ABOVE">Touch or exceed price (YES/NO)</option><option value="TOUCH_BELOW">Touch or fall below price (YES/NO)</option><option value="OUTPERFORM">Coin A outperforms Coin B (YES/NO)</option></select></label>
        <div className="two-col"><label>{previewKind?'COIN A':'ASSET'}<select value={form.token_a} onChange={e=>setForm({...form,token_a:e.target.value as Token})}>{TOKENS.map(t=><option key={t} value={t}>{t}/USDT</option>)}</select></label>{previewKind?<label>COIN B<select value={form.token_b} onChange={e=>setForm({...form,token_b:e.target.value as Token})}>{TOKENS.map(t=><option key={t} value={t}>{t}/USDT</option>)}</select></label>:<label>TARGET PRICE (USDT)<input required type="number" min="0.00000001" max="10000000" step="any" value={form.threshold} onChange={e=>setForm({...form,threshold:e.target.value})} placeholder="2500"/></label>}</div>
        <div className="two-col"><label>OBSERVATION WINDOW<select value={form.duration} onChange={e=>setForm({...form,duration:Number(e.target.value)})}><option value={1}>1 hour</option><option value={4}>4 hours</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label><label>WINDOW START (UTC · WHOLE HOUR)<input required type="datetime-local" step={3600} value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label></div>
        <div className="preview-question"><span>MARKET PREVIEW</span><h3>{previewKind?`Will ${form.token_a} outperform ${form.token_b} over ${form.duration} hours?`:`Will ${form.token_a} ${form.kind==='TOUCH_ABOVE'?'reach or exceed':'touch or fall below'} ${form.threshold||'?'} USDT?`}</h3><p>YES/NO · Prediction cutoff at {form.start.replace('T',' ')} UTC · Full {form.duration}h observation · Resolve 5 minutes after window closes</p>{invalidPair&&<small className="form-error">Choose two different assets.</small>}</div>
        <div className="form-footer"><div><ShieldCheck size={19}/><span>Experiment only. Non-transferable credits. Oracle is Binance Spot hourly candles; USDT is not USD. Data unavailability means UNKNOWN, never automatic NO.</span></div><button className="primary" disabled={!canWrite||invalidPair}>{!wallet?'Connect wallet first':busy||'Publish market'} <ArrowUpRight size={16}/></button></div>
      </form></section>}
      {tab==='activity'&&<section className="page"><div className="eyebrow">YOUR BROWSER · TRANSACTIONS</div><h1>Activity <span>history.</span></h1><p className="page-lead">Transaction receipts shown here are saved locally on this browser and must be checked on GenLayer Explorer. Pending and unverified transactions are not treated as successes.</p><div className="tx-list">{txs.length?txs.map(t=><div className="tx-row" key={t.hash}><span className={`tx-icon ${t.status}`}><Activity size={19}/></span><div><strong>{t.label}</strong><span>{new Date(t.at).toLocaleString()} · {short(t.hash)}</span>{t.error&&<small>{t.error}</small>}</div><span className={`status ${t.status}`}>{t.status}</span><a className="icon-button" target="_blank" rel="noreferrer" href={`https://explorer-studio.genlayer.com/tx/${encodeURIComponent(t.hash)}`} title="View on GenLayer Explorer"><ExternalLink size={16}/></a></div>):<div className="empty-state"><Activity size={30}/><h3>No transactions recorded</h3><p>Connect a wallet and interact with the deployed v0.2 contract.</p></div>}</div></section>}
    </main>
    <footer className="wrap footer"><div className="brand foot-brand"><span className="brand-mark"><GitBranch size={16}/></span> IF<span className="brand-accent">CAST</span></div><span>Predict crypto. Verify the outcome.</span><div><a href="https://github.com/bearbaba/IFCAST" target="_blank" rel="noreferrer"><BookOpen size={15}/> GitHub</a><span>STUDIONET · DEMO CREDITS ONLY</span></div></footer>
    <div className="mobile-menu"><button className={tab==='markets'?'on':''} onClick={()=>{setTab('markets');close()}}>Explore</button><button className={tab==='create'?'on':''} onClick={()=>setTab('create')}>Create</button><button className={tab==='activity'?'on':''} onClick={()=>setTab('activity')}>Activity</button></div>
    {selected&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Crypto market ${selected.id}`}><div className="drawer-head"><div className="eyebrow">MARKET / {String(selected.id).padStart(3,'0')}</div><button className="icon-button" onClick={close} aria-label="Close"><X size={19}/></button></div><h2>{title(selected)}</h2><div className={`status ${selected.status.toLowerCase()}`}>{statusLabel(selected,clock)}{selected.outcome?` · ${selected.outcome}`:''}</div>
      <div className="drawer-section"><h4>MARKET RULES</h4><p>{selected.kind==='OUTPERFORM'?`Compare ${selected.token_a}/USDT and ${selected.token_b}/USDT percentage return between the same UTC start and end hours. Equal returns VOID and refund both sides.`:`YES if any complete Binance Spot ${selected.token_a}/USDT 1h candle ${selected.kind==='TOUCH_ABOVE'?'high reaches or exceeds':'low reaches or falls below'} ${fmt(selected.target_e8/100_000_000)} USDT. NO requires all candles.`}</p><small>Starts: {utc(selected.start_at)} · Ends: {utc(selected.end_at)} · Earliest resolution: {utc(selected.resolve_after)}</small><small>Source: {selected.source} · Missing/malformed data: UNKNOWN (retry after cooldown).</small></div>
      <div className="drawer-section"><div className="drawer-odds"><div><span>YES CREDITS</span><strong className="yes">{fmt(selected.yes_pool)}</strong></div><div><span>NO CREDITS</span><strong className="no">{fmt(selected.no_pool)}</strong></div></div><div className="bar"><div style={{width:`${selected.yes_pool+selected.no_pool?100*selected.yes_pool/(selected.yes_pool+selected.no_pool):50}%`}}/></div><small>These are pool shares, not market probabilities.</small></div>
      {position&&<div className="your-position"><span>YOUR POSITION</span><strong>{position.side} · {fmt(position.amount)} credits</strong><small>{position.claimed?'Claimed':'Not yet claimed'}</small></div>}
      {selected.status==='OPEN'&&clock<selected.close_at*1000&&<div className="drawer-section"><h4>YOUR PREDICTION</h4><div className="choice"><button className={stakeSide==='YES'?'picked yes':''} onClick={()=>setStakeSide('YES')}>YES</button><button className={stakeSide==='NO'?'picked no':''} onClick={()=>setStakeSide('NO')}>NO</button></div><label className="amount-label">Demo credits<input type="number" min={1} max={1000} step={1} value={stake} onChange={e=>setStake(e.target.value)}/></label><button className="primary full" disabled={!canWrite||!Number.isInteger(Number(stake))||Number(stake)<1||Number(stake)>1000||(!!position&&position.side!==stakeSide)} onClick={()=>void transact(`Predict ${stakeSide}`,'place_position',[selected.id,stakeSide,Number(stake)],()=>void refresh(wallet))}>{!wallet?'Connect wallet to predict':busy||`Predict ${stakeSide}`} <ArrowRight size={16}/></button>{position&&position.side!==stakeSide&&<small>You cannot hold both sides in one wallet.</small>}</div>}
      {selected.status==='OPEN'&&clock>=selected.resolve_after*1000&&<button className="primary full" disabled={!canWrite||!resolveReady} onClick={()=>void transact('Resolve crypto market','resolve_market',[selected.id],()=>void refresh(wallet))}>{!resolveReady?`Retry after ${time(selected.last_attempt_at+600)}`:busy||'Verify evidence & settle'} <Sparkles size={17}/></button>}
      {selected.status!=='OPEN'&&position&&!position.claimed&&<button className="primary full" disabled={!canWrite} onClick={()=>void transact('Claim demo-credit settlement','claim',[selected.id],()=>void refresh(wallet))}>{busy||'Claim settlement'} <Coins size={17}/></button>}
      {selected.reason&&<div className="drawer-section verdict"><h4>INDEPENDENT CONSENSUS EVIDENCE</h4><p>{selected.reason}</p><small>Evidence SHA256: {selected.evidence_digest||'not available'}</small><small>Resolution attempts: {selected.attempts}</small></div>}
    </aside></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
