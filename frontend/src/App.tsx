import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Story, Session, Unit } from './types';
import './style.css';

function requestId() {
  const b=crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const SESSION_KEY='story-wager-session-v1';
const choiceKey=(s:Session)=>`story-wager-selection-${s.id}-${s.version}`;
function savedChoice(s:Session):{units?:string[];offer?:string} {try{return JSON.parse(localStorage.getItem(choiceKey(s))||'{}')}catch{return {}}}

function Modal({title,onClose,children}:{title:string;onClose?:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current!; d.showModal(); return()=>d.close()},[]);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={e=>{e.preventDefault();onClose?.()}}><div className="modal-heading"><h2 id="modal-title">{title}</h2>{onClose&&<button className="icon-button" aria-label="閉じる" onClick={onClose}>×</button>}</div>{children}</dialog>;
}

export default function App(){
  const [screen,setScreen]=useState<'title'|'choose'|'game'>('title');
  const [session,setSession]=useState<Session>();
  const [resumeId,setResumeId]=useState(localStorage.getItem(SESSION_KEY));
  const [choices,setChoices]=useState<Story[]>([]),[seen,setSeen]=useState<string[]>([]);
  const [selected,setSelected]=useState<string[]>([]),[offerId,setOfferId]=useState('');
  const [wordInfo,setWordInfo]=useState<Unit>();
  const [meaningOpen,setMeaningOpen]=useState(false);
  const [choosingReward,setChoosingReward]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [health,setHealth]=useState<{api_configured:boolean}>();
  const inFlight=useRef(false),actionId=useRef<string|undefined>(undefined);
  useEffect(()=>{api<{api_configured:boolean}>('/health').then(setHealth).catch(()=>setError('サーバーに接続できません。'))},[]);
  function accept(s:Session){setSession(s);setResumeId(s.id);localStorage.setItem(SESSION_KEY,s.id);setScreen('game')}
  useEffect(()=>{
    if(!session)return;
    const saved=savedChoice(session);
    setSelected((saved.units||[]).filter(id=>session.analysis?.units.some(u=>u.id===id)));
    const valid=session.offers.some(o=>o.id===saved.offer)?saved.offer!:'';
    setOfferId(valid);setChoosingReward(!valid);setWordInfo(undefined);setMeaningOpen(false);actionId.current=undefined;
  },[session?.id,session?.version]);
  useEffect(()=>{if(session?.status==='ready')localStorage.setItem(choiceKey(session),JSON.stringify({units:selected,offer:offerId}))},[selected,offerId,session?.id,session?.version,session?.status]);
  useEffect(()=>{
    if(!session||!['analyzing','generating'].includes(session.status))return;
    let active=true;
    const timer=setInterval(()=>api<Session>(`/sessions/${session.id}`).then(s=>{if(active){setSession(s);setError('')}}).catch(e=>{if(active)setError(e.message)}),1400);
    return()=>{active=false;clearInterval(timer)};
  },[session?.id,session?.status]);
  useEffect(()=>{window.scrollTo(0,0)},[screen,session?.view,session?.version]);
  async function act(fn:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'処理に失敗しました。')}finally{inFlight.current=false;setBusy(false)}}
  async function reroll(reset=false){await act(async()=>{const r=await api<{stories:Story[];exhausted:boolean}>('/stories/draw',{exclude:reset?[]:seen});setChoices(r.stories);setSeen(old=>[...(reset?[]:old),...r.stories.map(s=>s.id)]);if(r.exhausted)setNotice('候補を一巡！ もう一度シャッフルしたよ。');setScreen('choose')})}
  const units=session?.analysis?.units||[],offer=session?.offers.find(o=>o.id===offerId);
  const selectedUnits=units.filter(u=>selected.includes(u.id)),points=selectedUnits.reduce((s,u)=>s+u.score,0);
  const selectedConcepts=session?.analysis?.concepts.filter(c=>selectedUnits.some(u=>u.concept_ids.includes(c.id)))||[];
  const last=session?.transactions.at(-1),resultMode=session?.view==='result'&&last?.status==='committed';
  const ready=session?.status==='ready',processing=session&&['analyzing','generating'].includes(session.status);
  const round=(session?.transactions.filter(t=>t.status==='committed').length||0)+(resultMode?0:1);
  function toggle(id:string){
    if(busy||!ready||resultMode||!offer||choosingReward)return;
    actionId.current=undefined;setNotice('');
    if(selected.includes(id)){setSelected(selected.filter(x=>x!==id));return}
    const unit=units.find(u=>u.id===id)!;
    if(selectedUnits.some(u=>u.concept_ids.some(c=>unit.concept_ids.includes(c)))){setNotice('同じ存在は、二重に賭けられないよ。');return}
    setSelected([...selected,id]);
  }
  async function trade(){await act(async()=>{if(!session||!offer)return;actionId.current||=requestId();accept(await api<Session>(`/sessions/${session.id}/transactions`,{request_id:actionId.current,version:session.version,offer_id:offer.id,unit_ids:selected}))})}

  return <div className={`app-shell ${screen==='game'?'playing':''}`}>
    <header className="masthead"><button className="wordmark" aria-label="タイトルへ戻る" onClick={()=>{setScreen('title');setHistoryOpen(false)}}>ことばの取引所<span>WORDS / BET / REMIX</span></button>{screen==='game'?<button className="icon-button" aria-label="取引履歴" onClick={()=>setHistoryOpen(true)}>☰</button>:<span className="edition">PROTOTYPE B</span>}</header>
    {error&&<div className="alert" role="alert">{error}{session&&<button onClick={()=>act(async()=>accept(await api<Session>(`/sessions/${session.id}`)))}>状態を確認</button>}</div>}
    {screen==='title'&&<main className="title-screen"><p className="eyebrow">ちいさな文章、おおきな番狂わせ。</p><div className="title-art" aria-hidden="true"><span>私</span><b>⇄</b><span>？</span></div><h1>そのことば、<br/>賭けちゃう？</h1><p className="intro">ほしい展開を選んで、ことばをベット。<br/>勝てばプラス。負けたら、その意味が消える。</p><button className="primary" disabled={busy} onClick={()=>reroll(true)}>はじめる <span>→</span></button>{resumeId&&<button className="secondary" disabled={busy} onClick={()=>act(async()=>accept(await api<Session>(`/sessions/${resumeId}`)))}>つづきから</button>}<p className="quiet">現金・換金なし / 消えた設定は戻らない</p>{health&&!health.api_configured&&<p className="alert">Geminiキーを設定してサーバーを再起動してください。</p>}</main>}
    {screen==='choose'&&<main className="choose-screen"><p className="eyebrow">START / お話をひとつ</p><h1>どれで遊ぶ？</h1><div className="story-list">{choices.map((s,i)=><button key={s.id} className="story-card" disabled={busy||!health?.api_configured} onClick={()=>act(async()=>accept(await api<Session>('/sessions',{story_id:s.id,request_id:requestId()})))}><div className="story-card-top"><span>0{i+1} / {s.genre}</span><b>↗</b></div><h2>{s.title}</h2><p>{s.text}</p></button>)}</div><button className="secondary" disabled={busy} onClick={()=>reroll()}>↻ 別の3つを見る</button>{notice&&<p className="quiet" role="status">{notice}</p>}</main>}
    {screen==='game'&&session&&<main className="game-screen">
      <div className="chapter-line"><span>ROUND {String(round).padStart(2,'0')}</span><span>{resultMode?'03 / 結果':processing?'準備中':'02 / ことばをベット'}</span></div>
      <h1 className="story-title">{session.title}</h1>
      {resultMode?<>
        <section className="result-banner"><strong>{last.outcome==='win'?'WIN!':'LOSE!'}</strong><span>{last.outcome==='win'?last.offer.title+'をGET':'「'+last.stakes.join('・')+'」の意味が消えた'}</span></section>
        <section className="story-board result-board" aria-label="変わった物語"><p className="prose">{session.text}</p></section>
        <details className="changes"><summary>どこが変わった？</summary><p>{last.summary}</p><p className="quiet">ベット：{last.stakes.join(' / ')}{last.outcome==='loss'&&<> / 失った意味：{last.lost.map(c=>c.label).join('・')}</>}</p><p>{last.before}</p></details>
        <div className="bottom-actions"><button className="primary" disabled={busy} onClick={()=>act(async()=>{setSelected([]);setOfferId('');setChoosingReward(true);accept(await api<Session>(`/sessions/${session.id}/continue`,{}))})}>次は何をねらう？ <span>→</span></button></div>
      </>:<>
        <button className="reward-summary" disabled={!ready||busy} onClick={()=>setChoosingReward(true)}><span><small>今回ねらうもの</small><b>{offer?.title||'報酬を選ぼう'}</b></span><span>{offer?`${offer.required_points}点`:'3つから'} <small>変更 ↗</small></span></button>
        {processing?<p className="processing" role="status"><span className="spinner"/>{session.status==='analyzing'?'ことばを仕分け中…':'結果は確定！ お話をリミックス中…'}</p>:<p className="reading-hint">タップで選択・解除。負けると選んだ意味が消える。{units.some(u=>u.scoring_state==='unresolved')&&<span className="unscored-hint">「？」は採点未確定。タップで理由を確認できるよ。</span>}</p>}
        <section className="story-board" aria-label="賭ける言葉を選ぶ">{session.analysis?<div className="interactive-prose">{units.map(u=>u.score>0?<button key={u.id} className={`word-unit ${selected.includes(u.id)?'selected':''}`} aria-pressed={selected.includes(u.id)} aria-label={`${u.text}、${u.score}点`} disabled={!ready||!offer||busy||choosingReward} onClick={()=>toggle(u.id)}><span>{u.text}</span><small>{u.score}</small></button> :u.scoring_state==='punctuation'||/^[\s。、！？!?「」『』…・,.:;]+$/.test(u.text)?<span key={u.id} className="punctuation">{u.text}</span>:<button key={u.id} className="word-unit unavailable" aria-label={`${u.text}、${u.scoring_state==='unresolved'?'採点未確定':'賭けられない言葉'}、理由を表示`} disabled={!ready||choosingReward} onClick={()=>setWordInfo(u)}><span>{u.text}</span><small>{u.scoring_state==='unresolved'?'？':'—'}</small></button>)}</div>:<p className="prose">{session.text}</p>}</section>
        {session.status==='error'?<div className="api-error" role="alert"><p>{session.error}</p><button className="primary" disabled={busy} onClick={()=>act(async()=>accept(await api<Session>(`/sessions/${session.id}/retry`,{})))}>同じ結果で再試行</button></div>:ready&&offer?<section className="trade-dock" aria-label="取引の確定"><div className="dock-top"><span>ベット</span><b>{points}<small> / {offer.required_points} 点</small></b><button className="text-button" disabled={!selected.length} onClick={()=>{setSelected([]);actionId.current=undefined;setNotice('')}}>クリア</button></div><p className="stake-preview">{notice|| (selectedConcepts.length?`失うかもしれない：${selectedConcepts.map(c=>c.label).join('・')}`:'本文からことばを選んでね。')}</p><div className="dock-helper"><span>勝率 {Math.round(session.win_probability*100)}% {selected.length>0&&<button className="text-button" onClick={()=>setMeaningOpen(true)}>ベットの意味</button>}</span><button className="text-button" onClick={()=>{setSelected(offer.example_unit_ids);actionId.current=undefined;setNotice('')}}>点数が合う例</button></div><button className="primary" disabled={busy||!selected.length||points!==offer.required_points} onClick={trade}>{points===offer.required_points&&selected.length?'このことばで勝負！':points>offer.required_points?`${points-offer.required_points}点減らしてね`:`あと${offer.required_points-points}点選ぼう`}<span>→</span></button></section>:null}
      </>}
      {ready&&!resultMode&&(choosingReward||!offer)&&<Modal title="何を手に入れる？" onClose={offer?()=>setChoosingReward(false):undefined}><p className="modal-intro">まずは報酬をひとつ。次に、賭けることばを選ぼう。</p><div className="reward-options">{session.offers.map((o,i)=><button key={o.id} className="reward-option" onClick={()=>{if(o.id!==offerId)setSelected([]);setOfferId(o.id);setChoosingReward(false);setNotice('');actionId.current=undefined}}><span className="reward-index">0{i+1}</span><span><b>{o.title}</b><small>{o.description}</small></span><strong>{o.required_points}<small>点</small></strong></button>)}</div><p className="quiet">勝てば報酬をGET。賭けたことばも残る。</p></Modal>}
      {wordInfo&&<Modal title={wordInfo.scoring_state==='unresolved'?'まだ採点できていないことば':'このことばを賭けられない理由'} onClose={()=>setWordInfo(undefined)}><p className="word-info-text">「{wordInfo.text}」</p><p className="word-info-reason">{wordInfo.score_reason||'失う対象を特定できないため、賭ける対象から外れています。'}</p><p className="quiet">{wordInfo.scoring_state==='unresolved'?'0点で賭けられるという意味ではありません。AIが意味を確定できなかったため、この取引では選択できません。':'接続表現など、単独では失う対象を作れない部分は、本文として残します。'}</p></Modal>}
      {meaningOpen&&<Modal title="何を失うか確認" onClose={()=>setMeaningOpen(false)}><div className="meaning-list">{selectedUnits.map(u=><section key={u.id}><b>「{u.text}」 {u.score}点</b>{session.analysis?.concepts.filter(c=>u.concept_ids.includes(c.id)).map(c=><p key={c.id}>{c.label}：{c.description}</p>)}</section>)}</div><p className="quiet">負けた場合、この意味と成立しなくなる依存描写を変更します。それ以外は残します。</p></Modal>}
      {historyOpen&&<Modal title="これまでの取引" onClose={()=>setHistoryOpen(false)}><div className="history-body">{session.transactions.length?session.transactions.map((t,i)=><p key={t.id}><b>{i+1}. {t.outcome==='win'?'WIN':'LOSE'}</b> / {t.offer.title}<small>{t.stakes.join(' / ')} · {t.status==='committed'?'反映済み':'反映待ち'}</small></p>):<p>まだ取引はないよ。</p>}<h3>失われた設定</h3><p>{session.lost_concepts.map(c=>c.label).join('・')||'まだなし'}</p><p className="quiet">生成 {session.api_calls}回 / {session.model}<br/>入力 {session.usage.input}・出力 {session.usage.output} tokens</p></div></Modal>}
    </main>}
  </div>;
}
