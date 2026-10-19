import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, Clock3, Code2, Coins, ExternalLink, FileCheck2, GitBranch, Globe2, Menu, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Wallet, X} from 'lucide-react';
import {connectWallet, ready, read, write, type Market, type Position, type Side, type Tx} from './genlayer';
import './style.css';

type Tab = 'markets' | 'create' | 'activity';
const txKey = 'ifcast-transactions-v1';
const shorten = (s:string, a=6) => s.length > a * 2 ? `${s.slice(0,a)}…${s.slice(-4)}` : s;
const fmt = (n:number) => new Intl.NumberFormat('en-US').format(n);
const when = (n:number) => new Date(n * 1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const pct = (yes:number,no:number) => (yes + no) ? Math.round(100 * yes / (yes + no)) : 50;
const blankForm = { title:'',condition:'',target:'',condition_url:'',target_url:'',close_at:'',resolve_after:''};
const toTs = (s:string) => Math.floor(new Date(s).getTime() / 1000);

function App() {
  const [tab,setTab] = useState<Tab>('markets');
  const [wallet,setWallet] = useState('');
  const [balance,setBalance] = useState<number|null>(null);
  const [grantClaimed,setGrantClaimed] = useState(false);
  const [markets,setMarkets] = useState<Market[]>([]);
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState<Market|null>(null);
  const [position,setPosition] = useState<Position|null>(null);
  const [side,setSide] = useState<Side>('YES');
  const [amount,setAmount] = useState('50');
  const [form,setForm] = useState(blankForm);
  const [txs,setTxs] = useState<Tx[]>(() => {try { return JSON.parse(localStorage.getItem(txKey) || '[]') as Tx[]; }catch{return []}});
  const [clock,setClock] = useState(Date.now());
  useEffect(()=>{const t=window.setInterval(()=>setClock(Date.now()),30000);return ()=>clearInterval(t)},[]);
  useEffect(()=>{localStorage.setItem(txKey,JSON.stringify(txs.slice(0,60)));},[txs]);

  const refresh = useCallback(async (walletValue=wallet) => {
    if (!ready) return;
    setLoading(true);
    try {
      const count = Number(await read<number>('get_market_count'));
      const data = count ? await read<Market[]>('get_markets',[Math.max(0,count-30),Math.min(30,count)]) : [];
      setMarkets([...data].reverse());
      if (walletValue) {
        const [available, claimed] = await Promise.all([read<number>('get_balance',[walletValue]),read<boolean>('has_claimed_grant',[walletValue])]);
        setBalance(Number(available));setGrantClaimed(Boolean(claimed));
      } else { setBalance(null);setGrantClaimed(false); }
      setError('');
    } catch(e) {setError(e instanceof Error ? e.message : String(e));}
    finally {setLoading(false)}
  },[wallet]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if (!selected || !wallet || !ready) {setPosition(null);return;}
    void read<Position>('get_position',[selected.id,wallet]).then(p=>setPosition(p?.side ? p : null)).catch(()=>setPosition(null));
  },[selected,wallet,txs]);
  useEffect(()=>{
    const provider = window.ethereum;
    if (!provider?.on) return;
    const accountListener=(value:unknown)=>{const a=Array.isArray(value)&&typeof value[0]==='string'?value[0]:'';setWallet(a);setSelected(null);setBalance(null)};
    const chainListener=()=>{setWallet('');setSelected(null);setNotice('Network changed. Reconnect to Studionet before transacting.');};
    provider.on('accountsChanged',accountListener);provider.on('chainChanged',chainListener);
    return ()=>{provider.removeListener?.('accountsChanged',accountListener);provider.removeListener?.('chainChanged',chainListener)};
  },[]);

  const doWallet=async()=>{setError('');try{const a=await connectWallet();setWallet(a);setNotice('Wallet connected to GenLayer Studionet.');void refresh(a);}catch(e){setError(e instanceof Error?e.message:String(e))}};
  const transact=async(label:string, fn:string, args:(string|number)[], after?:()=>void)=>{
    setBusy(label);setError('');setNotice('');let hash='';
    try {
      await write(fn,args,wallet,h=>{hash=h;setTxs(prev=>[{hash:h,label,status:'pending',at:Date.now()},...prev])});
      setTxs(prev=>prev.map(t=>t.hash===hash?{...t,status:'finalized'}:t));
      setNotice(`${label} finalized successfully.`);await refresh(wallet);after?.();
    }catch(e){const msg=e instanceof Error?e.message:String(e);setError(msg);if(hash)setTxs(prev=>prev.map(t=>t.hash===hash?{...t,status:msg.includes('without a successful execution')?'failed':'unverified',error:msg}:t));}
    finally{setBusy('')}
  };

  const active = useMemo(()=>markets.filter(m=>m.title.toLowerCase().includes(search.toLowerCase())||String(m.id).includes(search)),[markets,search]);
  const total = markets.reduce((s,m)=>s+m.yes_pool+m.no_pool,0);
  const canTransact = ready && !!wallet && !busy;
  const selectedClosed = selected ? clock>=selected.close_at*1000 : false;
  const chooseMarket=(m:Market)=>{setSelected(m);setPosition(null);setSide('YES');setAmount('50')};
  const submitCreate=(e:React.FormEvent)=>{
    e.preventDefault();
    const close=toTs(form.close_at),resolve=toTs(form.resolve_after);
    if(!Number.isFinite(close)||!Number.isFinite(resolve)){setError('Enter valid UTC dates.');return}
    void transact('Create market','create_market',[form.title,form.condition,form.target,form.condition_url.trim(),form.target_url.trim(),close,resolve],()=>{setTab('markets');setForm(blankForm)});
  };
  return <div className="app-shell">
    <div className="ambient ambient-a"/><div className="ambient ambient-b"/>
    <header className="topbar"><div className="wrap topbar-inner">
      <button className="brand" onClick={()=>{setTab('markets');setSelected(null)}} aria-label="IFCAST home"><span className="brand-mark"><GitBranch size={19} strokeWidth={2.5}/></span><span>IF<span className="brand-accent">CAST</span></span><span className="brand-beta">BETA</span></button>
      <nav className="desktop-nav"><button className={tab==='markets'?'active':''} onClick={()=>{setTab('markets');setSelected(null)}}>Markets</button><button className={tab==='create'?'active':''} onClick={()=>setTab('create')}>Create market</button><button className={tab==='activity'?'active':''} onClick={()=>setTab('activity')}>Activity</button></nav>
      <div className="nav-actions"><span className="network-pill"><i/> Studionet</span><button className="wallet-btn" onClick={()=>wallet?setWallet(''):void doWallet()}><Wallet size={15}/>{wallet?shorten(wallet):'Connect wallet'}</button></div>
    </div></header>
    <main className="wrap">
      {!ready&&<div className="banner warn"><Code2 size={18}/><div><strong>Deployment not configured.</strong> This is a real-contract client, not a simulated market. Set <code>VITE_IFCAST_CONTRACT_ADDRESS</code> to the deployed Studionet contract address to enable data and transactions.</div></div>}
      {error&&<div className="banner err" role="alert"><X size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
      {notice&&<div className="banner good" role="status"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
      {tab==='markets'&&<>
        <section className="hero"><div className="hero-left"><div className="eyebrow"><Sparkles size={13}/> GENLAYER-POWERED PREDICTION MARKETS <span> / 01</span></div><h1>Conditions define<br/><span>the future.</span></h1><p>Prediction markets for the moments that depend on <em>what happens first.</em> Deterministic accounting. Independent AI consensus. Verifiable evidence.</p><div className="hero-actions"><button className="primary" onClick={()=>setTab('create')}>Create a market <ArrowUpRight size={17}/></button><a className="outline" href="https://github.com/bearbaba/IFCAST" target="_blank" rel="noreferrer">Explore the code <Code2 size={16}/></a></div></div><div className="hero-art"><div className="orbit orbit-1"/><div className="orbit orbit-2"/><div className="orbit orbit-3"/><div className="orbit-center"><span>IF</span><ArrowRight size={26}/><span>THEN</span></div><div className="orbit-tag top"><span className="tag-dot mint"/> CONDITION VERIFIED</div><div className="orbit-tag bottom"><ShieldCheck size={14}/> AI CONSENSUS</div></div></section>
        <section className="stats"><div><span>MARKETS IN VIEW</span><strong>{fmt(markets.length)}</strong></div><div><span>DEMO CREDITS STAKED</span><strong>{fmt(total)}</strong></div><div><span>RESOLVED / VOID</span><strong>{markets.filter(m=>m.status!=='OPEN').length}</strong></div><div className="balance-stat"><span>YOUR AVAILABLE CREDITS</span><strong>{balance===null?'—':fmt(balance)}</strong>{wallet&&!grantClaimed&&<button onClick={()=>void transact('Claim demo credits','claim_demo_credits',[])} disabled={!canTransact}>Get 1,000 credits <ArrowUpRight size={13}/></button>}</div></section>
        <div className="section-heading"><div><div className="eyebrow">MARKET EXPLORER / LIVE ON-CHAIN DATA</div><h2>Explore markets <span className="heading-star">✳</span></h2><p>Testnet predictions driven by immutable market rules.</p></div><div className="section-tools"><label className="search"><Search size={16}/><input aria-label="Search markets" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search markets..."/></label><button className="icon-button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh markets"><RefreshCcw size={18} className={loading?'spin':''}/></button></div></div>
        <div className="markets-grid">{active.length?active.map(m=><button key={m.id} className="market-card" onClick={()=>chooseMarket(m)}><div className="market-top"><div className="market-number">MARKET / {String(m.id).padStart(3,'0')}</div><div className={`status ${m.status.toLowerCase()}`}>{m.status==='OPEN'&&clock>=m.close_at*1000?'CLOSED':m.status}</div></div><h3>{m.title}</h3><p className="market-context"><GitBranch size={14}/> Conditional outcome · Pool share, not odds</p><div className="bar"><div style={{width:`${pct(m.yes_pool,m.no_pool)}%`}}/></div><div className="odds"><span className="yes">YES <b>{pct(m.yes_pool,m.no_pool)}%</b></span><span className="no">NO <b>{100-pct(m.yes_pool,m.no_pool)}%</b></span></div><div className="market-bottom"><span><Coins size={14}/> {fmt(m.yes_pool+m.no_pool)} credits</span><span><Clock3 size={14}/> {when(m.close_at)}</span><ArrowUpRight size={17}/></div></button>):<div className="empty-state"><div className="empty-icon"><BarChart3 size={28}/></div><h3>{loading?'Fetching finalized market state...':search?'No matching markets':'No on-chain markets yet'}</h3><p>{search?'Try another search term.':'Create the first conditional market after the contract is deployed.'}</p><button className="primary small" onClick={()=>setTab('create')}><Plus size={15}/> Create market</button></div>}</div>
        <section className="how"><div className="eyebrow">THE IFCAST DIFFERENCE</div><div className="how-grid"><div><span className="how-icon"><GitBranch size={21}/></span><h3>IF something happens</h3><p>Preconditions and deadlines are defined before participation opens.</p></div><div><span className="how-icon"><Globe2 size={21}/></span><h3>THEN verify the outcome</h3><p>Independent validators assess pinned, allowlisted evidence sources.</p></div><div><span className="how-icon"><ShieldCheck size={21}/></span><h3>FINALLY settle on-chain</h3><p>Deterministic YES / NO / VOID settlement. No real-money wagering.</p></div></div></section>
      </>}
      {tab==='create'&&<section className="page"><div className="eyebrow">MARKET FACTORY / CREATE</div><h1>Define the <span>condition.</span></h1><p className="page-lead">Markets are immutable after creation. This initial release supports a GitHub PR as a precondition and a repository's latest release as the target evidence source.</p><form className="form-card" onSubmit={submitCreate}><div className="form-card-header"><span className="step">01</span><div><h2>Market specification</h2><p>Rules are public and cannot be edited after submission.</p></div></div>
        <label>MARKET QUESTION<input required minLength={20} maxLength={180} placeholder="Will project X ship the upgrade within 72h after PR #42 merges?" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
        <label>IF — PRECONDITION<textarea required minLength={15} maxLength={500} placeholder="PR #42 must be merged by Oct 25, 2026 at 23:59 UTC. Otherwise void the market." rows={3} value={form.condition} onChange={e=>setForm({...form,condition:e.target.value})}/></label>
        <label>THEN — TARGET OUTCOME<textarea required minLength={15} maxLength={500} placeholder="A release must be published within 72 hours of the PR merge, with release notes substantively covering the upgrade." rows={3} value={form.target} onChange={e=>setForm({...form,target:e.target.value})}/></label>
        <div className="two-col"><label>PRECONDITION EVIDENCE URL<input required type="url" placeholder="https://api.github.com/repos/owner/repo/pulls/42" value={form.condition_url} onChange={e=>setForm({...form,condition_url:e.target.value})}/></label><label>TARGET EVIDENCE URL<input required type="url" placeholder="https://api.github.com/repos/owner/repo/releases/latest" value={form.target_url} onChange={e=>setForm({...form,target_url:e.target.value})}/></label></div>
        <div className="two-col"><label>BETTING CLOSE (YOUR LOCAL TIME)<input required type="datetime-local" value={form.close_at} onChange={e=>setForm({...form,close_at:e.target.value})}/></label><label>EARLIEST RESOLUTION (YOUR LOCAL TIME)<input required type="datetime-local" value={form.resolve_after} onChange={e=>setForm({...form,resolve_after:e.target.value})}/></label></div>
        <div className="form-footer"><div><ShieldCheck size={19}/><span>Evidence URLs are allowlisted and frozen in contract state. No real financial assets.</span></div><button className="primary" type="submit" disabled={!canTransact}>{busy||(!wallet?'Connect wallet to create':'Publish on GenLayer')} <ArrowUpRight size={16}/></button></div></form></section>}
      {tab==='activity'&&<section className="page"><div className="eyebrow">TRANSACTION HISTORY / LOCAL DEVICE</div><h1>Your <span>activity.</span></h1><p className="page-lead">Recent transactions recorded by this browser. Finalized status is checked via GenLayer receipt; history is not synced between devices.</p><div className="tx-list">{txs.length?txs.map(t=><div className="tx-row" key={t.hash}><div className={`tx-icon ${t.status}`}>{t.status==='finalized'?<Check size={19}/>:<Activity size={19}/>}</div><div><strong>{t.label}</strong><span>{new Date(t.at).toLocaleString()} · {shorten(t.hash,9)}</span>{t.error&&<small>{t.error}</small>}</div><span className={`status ${t.status}`}>{t.status}</span><button className="icon-button" onClick={()=>void navigator.clipboard.writeText(t.hash).then(()=>setNotice("Transaction hash copied."))} title="Copy transaction hash" aria-label="Copy transaction hash"><Code2 size={15}/></button></div>):<div className="empty-state"><Activity size={28}/><h3>No transactions on this device yet</h3><p>Once you submit an on-chain transaction, its hash appears here.</p></div>}</div></section>}
    </main>
    <footer className="wrap footer"><div className="brand foot-brand"><span className="brand-mark"><GitBranch size={16}/></span> IF<span className="brand-accent">CAST</span></div><span>Prediction is conditional. Evidence is not.</span><div><a href="https://github.com/bearbaba/IFCAST" target="_blank" rel="noreferrer"><BookOpen size={15}/> GitHub</a><span>EXPERIMENTAL · TEST CREDITS ONLY</span></div></footer>
    <div className="mobile-menu"><button className={tab==='markets'?'on':''} onClick={()=>{setTab('markets');setSelected(null)}}><BarChart3 size={20}/>Markets</button><button className={tab==='create'?'on':''} onClick={()=>setTab('create')}><Plus size={20}/>Create</button><button className={tab==='activity'?'on':''} onClick={()=>setTab('activity')}><Menu size={20}/>Activity</button></div>
    {selected&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Market ${selected.id}`}><div className="drawer-head"><div className="eyebrow">MARKET / {String(selected.id).padStart(3,'0')}</div><button className="icon-button" onClick={()=>setSelected(null)} aria-label="Close"><X size={19}/></button></div><h2>{selected.title}</h2><div className={`status ${selected.status.toLowerCase()}`}>{selected.status==='OPEN'&&selectedClosed?'CLOSED':selected.status} {selected.outcome&&selected.outcome!=='VOID'?` · ${selected.outcome}`:''}</div><div className="drawer-section"><h4>IF — PRECONDITION</h4><p>{selected.condition}</p><a href={selected.condition_url} target="_blank" rel="noreferrer">Verified source <ExternalLink size={14}/></a></div><div className="drawer-section"><h4>THEN — TARGET</h4><p>{selected.target}</p><a href={selected.target_url} target="_blank" rel="noreferrer">Verified source <ExternalLink size={14}/></a></div><div className="drawer-section"><div className="drawer-odds"><div><span>YES POOL</span><strong className="yes">{fmt(selected.yes_pool)}</strong></div><div><span>NO POOL</span><strong className="no">{fmt(selected.no_pool)}</strong></div></div><div className="bar"><div style={{width:`${pct(selected.yes_pool,selected.no_pool)}%`}}/></div><small>Close: {when(selected.close_at)} · Resolution eligible: {when(selected.resolve_after)}</small></div>
      {position&&<div className="your-position"><span>YOUR POSITION</span><strong>{position.side} · {fmt(position.amount)} credits</strong><small>{position.claimed?'Claimed':'Not claimed'}</small></div>}
      {selected.status==='OPEN'&&!selectedClosed&&<div className="drawer-section"><h4>TAKE A POSITION</h4><div className="choice"><button className={side==='YES'?'picked yes':''} onClick={()=>setSide('YES')}>YES <ArrowUpRight size={17}/></button><button className={side==='NO'?'picked no':''} onClick={()=>setSide('NO')}>NO <ArrowDownRight size={17}/></button></div><label className="amount-label">Demo credits<input type="number" min="1" max="1000" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="primary full" disabled={!canTransact||!Number.isInteger(Number(amount))||Number(amount)<1||Number(amount)>1000||!!position&&position.side!==side} onClick={()=>void transact(`Stake ${side}`,'place_position',[selected.id,side,Number(amount)],()=>setSelected(null))}>{!wallet?'Connect wallet to predict':busy||`Predict ${side}`}<ArrowRight size={17}/></button>{position&&position.side!==side&&<small>One side per wallet per market.</small>}</div>}
      {selected.status==='OPEN'&&clock>=selected.resolve_after*1000&&<button className="primary full" disabled={!canTransact} onClick={()=>void transact('Resolve market','resolve_market',[selected.id],()=>setSelected(null))}>{busy||'Run independent AI consensus'} <Sparkles size={17}/></button>}
      {position&&!position.claimed&&selected.status!=='OPEN'&&<button className="primary full" disabled={!canTransact} onClick={()=>void transact('Claim settlement','claim',[selected.id],()=>setSelected(null))}>{busy||'Claim demo-credit settlement'} <Coins size={17}/></button>}
      {selected.reason&&<div className="drawer-section verdict"><h4><FileCheck2 size={15}/> CONSENSUS EVIDENCE</h4><p>{selected.reason}</p><small>Attempts: {selected.attempts}</small></div>}
    </aside></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
