import { AnomaResult, Opening } from './Anoma';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Story, Session, GameKind, GameOption } from './types';
import { GamblePlay } from './GamblePlay';
import './style.css';
import './manuscript.css';
import { Manuscript, WagerManuscript } from './Manuscript';
import { usePaperDust } from './PaperDust';
import { PaperLayers, StoryPaperStack, StoryHistory } from './StoryHistory';
import './history.css';
import './gamble-motion.css';
import { changeShapes } from './gamblePresentation';
import { GenerationSkeleton } from './GambleMotion';

function requestId() {
  const b=crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const RESUME_KEY = 'story-wager-session-count-v1';
const MIN_STORY = 20;
const MAX_STORY = 100;
const choiceKey=(s:Session)=>`story-wager-selection-count-v1-${s.id}-${s.version}`;
function savedChoice(s:Session):{units?:string[];offer?:string} {try{return JSON.parse(localStorage.getItem(choiceKey(s))||'{}')}catch{return {}}}

function Modal({title,onClose,children}:{title:string;onClose?:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current!; d.showModal(); return()=>d.close()},[]);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={e=>{e.preventDefault();onClose?.()}}><div className="modal-heading"><h2 id="modal-title">{title}</h2>{onClose&&<button className="icon-button" aria-label="閉じる" onClick={onClose}>×</button>}</div>{children}</dialog>;
}

export default function App(){
  const [screen,setScreen]=useState<'title'|'opening'|'choose'|'game'>('title');
  const [session,setSession]=useState<Session>();
  const [helpOpen,setHelpOpen]=useState(false);
  const [paperIndex,setPaperIndex]=useState<number>();
  const [highlight,setHighlight]=useState(false);
  useEffect(() => {
    const id = localStorage.getItem(RESUME_KEY);
    if (!id) return;
    api<Session>(`/sessions/${encodeURIComponent(id)}`).then(s => {
      if (s.betting_mode === 'count-v1') setSession(current => current ?? s);
    }).catch(() => setError('つづきを確認できませんでした。再読み込みして再試行してください。'));
  }, []);
  const dust = usePaperDust(session?.id);
  const transactions = session?.transactions;
  const losses = useMemo(() => transactions?.filter(tx => tx.status === 'committed' && tx.outcome === 'loss') ?? [], [transactions]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customIntro, setCustomIntro] = useState('');
  const customCount = Array.from(customText.trim()).length;
  const [choices,setChoices]=useState<Story[]>([]),[seen,setSeen]=useState<string[]>([]);
  const [selected,setSelected]=useState<string[]>([]),[offerId,setOfferId]=useState('');
  const [games, setGames] = useState<GameOption[]>([]);
  const [gameTier, setGameTier] = useState<'beginner' | 'advanced'>('beginner');
  const hasBeginnerGames = games.some(game => game.tier === 'beginner');
  const shownGames = games.filter(game => !hasBeginnerGames || (game.tier ?? 'advanced') === gameTier);
  const [choosingGame, setChoosingGame] = useState(false);
  const [choosingReward,setChoosingReward]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const inFlight=useRef(false),action=useRef<{id: string; game: GameKind} | undefined>(undefined);
  useEffect(() => {api<{games: GameOption[]}>('/games').then(data => setGames(data.games)).catch(() => setError('ゲームの一覧を取得できません。再読み込みしてください。'))}, []);
  function accept(s:Session){if(s.betting_mode!=='count-v1')throw new Error('個数方式へ更新中です。少し待ってからページを再読み込みしてください。');localStorage.setItem(RESUME_KEY,s.id);setSession(s);setScreen('game')}
  useEffect(()=>{
    if(!session)return;
    const saved=savedChoice(session);
    const restored = (saved.units ?? []).filter(id => session.analysis?.units.some(u => u.id === id && u.stakeable));
    const restoredOffer = session.offers.find(o => o.id === saved.offer);
    setSelected(restored);
    setGameTier('beginner');
    setPaperIndex(undefined);
    setHighlight(false);
    setChoosingGame(false);
    setOfferId(restoredOffer?.id ?? '');
    setChoosingReward(!restoredOffer);
    action.current = undefined;
  },[session?.id,session?.version]);
  useEffect(()=>{if(session?.status==='ready')localStorage.setItem(choiceKey(session),JSON.stringify({units:selected,offer:offerId}))},[selected,offerId,session?.id,session?.version,session?.status]);
  useEffect(()=>{
    if(!session||!['analyzing','generating'].includes(session.status))return;
    let active=true;
    const timer=setInterval(()=>api<Session>(`/sessions/${session.id}`).then(s=>{if(active && !inFlight.current){setSession(s);setError('')}}).catch(e=>{if(active && !inFlight.current)setError(e.message)}),1400);
    return()=>{active=false;clearInterval(timer)};
  },[session?.id,session?.status]);
  useEffect(()=>{window.scrollTo(0,0)},[screen,session?.view,session?.version]);
  async function act(fn:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'処理に失敗しました。')}finally{inFlight.current=false;setBusy(false)}}
  async function reroll(reset = false) {
    await act(async () => {
      const result = await api<{ stories: Story[]; exhausted: boolean }>('/stories/draw', {
        exclude: reset ? [] : seen,
        count: 3,
      });
      setChoices(result.stories);
      setSeen(previous => [
        ...(reset || result.exhausted ? [] : previous),
        ...result.stories.map(story => story.id),
      ]);
      if (result.exhausted) setNotice('候補を一巡！ もう一度シャッフルしたよ。');
      setScreen('choose');
    });
  }
  const units=session?.analysis?.units||[],offer=session?.offers.find(o=>o.id===offerId);
  const selectedUnits=units.filter(u=>selected.includes(u.id));
  const selectedCount=selectedUnits.length;
  const stakesReady = offer !== undefined && selectedCount === offer.required_count;
  const last=session?.transactions.at(-1),resultMode=session?.view==='result'&&last?.status==='committed';
  const gambleMode = Boolean(last?.gamble && !last.presentation_completed && !resultMode);
  const ready=session?.status==='ready',processing=session&&['analyzing','generating'].includes(session.status);
  const round=(session?.transactions.filter(t=>t.status==='committed').length||0)+(resultMode?0:1);
  function toggle(id:string){
    if(busy||!ready||resultMode||!offer||choosingReward)return;
    action.current=undefined;setNotice('');
    if(selected.includes(id)){setSelected(selected.filter(x=>x!==id));return}
    const unit=units.find(u=>u.id===id);
    if(!unit?.stakeable)return;
    setSelected([...selected,id]);
  }
  async function trade(game: GameKind) {
    if (!session || !offer || !stakesReady) return;
    await act(async () => {
      if (action.current?.game !== game) action.current = { game, id: requestId() };
      const next = await api<Session>(`/sessions/${session.id}/transactions`, {
        request_id: action.current.id, version: session.version, offer_id: offer.id, unit_ids: selected, game,
      });
      setChoosingGame(false);
      accept(next);
    });
  }

  function startCustom() {
    if (customCount < MIN_STORY || customCount > MAX_STORY) return;
    void act(async () => {
      const next = await api<Session>('/sessions', { intro: customIntro.trim(), custom_text: customText.trim(), request_id: requestId() });
      setCustomOpen(false);
      setCustomText('');
      accept(next);
    });
  }

  return <div className={`app-shell ${screen==='game'?'playing':''}`}>
    {screen !== 'title' && <header className="navigation-bar">
      <button className="icon-button" aria-label="タイトルへ" disabled={busy} onClick={() => {
        setScreen('title'); setHistoryOpen(false); setError('');
      }}>タイトルへ</button>
      {screen === 'game' && <button className="icon-button" aria-label="取引履歴" onClick={() => setHistoryOpen(true)}>☰</button>}
    </header>}
    {error && !customOpen && !choosingGame && <div className="alert" role="alert">{error}{screen === 'game' && session &&
      <button onClick={() => act(async () => accept(await api<Session>(`/sessions/${session.id}`)))}>状態を確認</button>}</div>}
    {screen === 'title' && <main className="title-screen">
      <h1><span>ギャンブル</span><span>ライティングメーカー</span><small>(仮称)</small></h1>
      <p className="intro">言葉を賭けて、物語を書き換える</p>
      <button className="secondary" onClick={() => setHelpOpen(true)}>遊び方</button>
      {session && <><p className="quiet">進行は残っています。「つづきから」で再開できます。</p><button className="secondary" disabled={busy} onClick={() => act(async () => accept(await api<Session>(`/sessions/${session.id}`)))}>つづきから</button></>}
      <button className="primary" disabled={busy} onClick={() => setScreen('opening')}>はじめる <span>→</span></button>
    </main>}
    {screen === 'opening' && <Opening busy={busy} onComplete={() => void reroll(true)} />}
    {helpOpen && <Modal title="遊び方" onClose={() => setHelpOpen(false)}><p>報酬を選び、赤線の言葉を賭けてギャンブルへ。勝てば報酬を得て、負けると賭けた言葉の意味が消えます。</p></Modal>}
    {screen === 'choose' && <main className="choose-screen">
      <h1>物語を選ぶ</h1>
      <div className="story-selection-actions">
        <button className="secondary" disabled={busy} onClick={() => { setError(''); setCustomOpen(true); }}>自分で物語を入力</button>
        <button className="secondary" disabled={busy} onClick={() => reroll()}>別の候補を見る</button>
      </div>
      {notice && <p className="quiet" role="status">{notice}</p>}
      <div className="story-list">{choices.map(story => <button key={story.id} className="story-card" disabled={busy}
        onClick={() => act(async () => accept(await api<Session>('/sessions', { story_id: story.id, request_id: requestId() })))}>
        <div className="story-card-top"><span>{story.genre}</span><b>この物語ではじめる →</b></div>
        <h2>{story.title}</h2>{story.intro && <p className="story-intro">{story.intro}</p>}<p>{story.text}</p>
      </button>)}</div>
      {customOpen && <Modal title="自分で物語を入力" onClose={() => { if (!busy) { setCustomOpen(false); setError(''); } }}>
        <form className="custom-story" onSubmit={event => { event.preventDefault(); startCustom(); }}>
          <label htmlFor="custom-story-intro">導入（任意・1〜2文）</label>
          <textarea id="custom-story-intro" value={customIntro} rows={2} disabled={busy}
            placeholder="誰が・どこで・何をしているか（1〜2文が目安）" onChange={event => setCustomIntro(event.target.value)} />
          <p className="quiet">導入は賭けや書き換えの対象になりません。</p>
          <label htmlFor="custom-story-text">本文（{MIN_STORY}〜{MAX_STORY}文字）</label>
          <textarea id="custom-story-text" placeholder="例：雨の朝、少女は駅で赤い傘を拾った。持ち主を探すと、猫が一匹こちらを見ていた。" value={customText} rows={5} disabled={busy}
            onChange={event => { setCustomText(event.target.value); setError(''); }} />
          <span className={customCount > MAX_STORY ? 'input-error' : 'quiet'}>{customCount} / {MAX_STORY}文字</span>
          {customCount < MIN_STORY && <p className="quiet">あと{MIN_STORY - customCount}文字入力してください。</p>}
          {customCount > MAX_STORY && <p className="input-error">{customCount - MAX_STORY}文字減らしてください。</p>}
          {error && <p className="input-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || customCount < MIN_STORY || customCount > MAX_STORY}>この物語ではじめる</button>
        </form>
      </Modal>}
    </main>}
    {screen==='game'&&session&&<main key={`${session.id}-${session.version}-${session.view}`} className={`game-screen${session.version > 1 && session.view !== 'result' ? ' round-reveal' : ''}`}>
      {gambleMode && last?.gamble ? <><p className="wager-context">賭けた言葉：{last.stakes.join(' / ')}<br />報酬：{last.offer.title}</p><GamblePlay key={last.id} gamble={last.gamble} busy={busy} error={session.error} prepared={session.status === 'awaiting_reveal'}
        onMove={(attempt, choice) => act(async () => accept(await api<Session>(`/sessions/${session.id}/transactions/${last.id}/play`, { attempt, choice })))}
        onFinish={() => act(async () => accept(await api<Session>(`/sessions/${session.id}/transactions/${last.id}/finish`, {})))} /></> : <>
      <div className="chapter-line"><span>第{round}章</span>{(resultMode || processing) && <span>{resultMode ? '結果' : '準備中'}</span>}</div>
      <h1 className="story-title">{session.title}</h1>
      {session.intro && <p className="story-intro" aria-label="物語の導入">{session.intro}</p>}
      {resultMode?<>
        <AnomaResult key={`${session.id}-${last.id}`} transactions={session.transactions} />
        <StoryPaperStack key={highlight ? 'changes' : 'reading'} session={session} dust={dust} losses={losses} result pageIndex={paperIndex} onPageChange={setPaperIndex} highlight={highlight} />
        <details className="changes" onToggle={event => { if(event.currentTarget.open) { setPaperIndex(session.transactions.filter(t => t.status === 'committed').length); setHighlight(true); } else setHighlight(false); }}><summary>どこが変わった？</summary><p>{last.summary}</p><p className="quiet">ベット：{last.stakes.join(' / ')}{last.outcome==='loss'&&<> / 失った意味：{last.lost.map(c=>c.label).join('・')}</>}</p>{last.changes?.map((change,i)=><p key={i}>{change}</p>)}</details>
        <div className="bottom-actions"><button className="primary" disabled={busy} onClick={()=>act(async()=>{setSelected([]);setOfferId('');setChoosingReward(true);accept(await api<Session>(`/sessions/${session.id}/continue`,{}))})}>次は何をねらう？ <span>→</span></button></div>
      </>:<>
        <button className="reward-summary" disabled={!ready||busy} onClick={()=>{setChoosingGame(false);setChoosingReward(true)}}><span><small>今回ねらうもの</small><b>{offer?.title||'報酬を選ぼう'}</b></span><span>{offer?`${offer.required_count}個`:`${session.offers.length}つから`} <small>変更 ↗</small></span></button>
        {ready && <p className="reading-hint">赤線の言葉をタップして賭ける。</p>}
        {processing&&<p className="processing" role="status"><span className="spinner"/>{session.status==='analyzing'?'ことばを仕分け中…':'結果は確定！ お話をリミックス中…'}</p>}
        <section className="story-board wager-paper-stack" aria-label="賭ける言葉を選ぶ"><PaperLayers count={session.transactions.filter(tx => tx.status === 'committed').length + 1}>{processing ? <GenerationSkeleton /> : session.analysis ? <WagerManuscript text={session.text} units={units} selected={selected}
          disabled={!ready || !offer || busy || choosingReward || choosingGame} onToggle={toggle} dust={dust} losses={losses} />
          : <Manuscript text={session.text} dust={dust} losses={losses} />}</PaperLayers></section>
        {session.status === 'error' ? <div className="api-error" role="alert"><p>{session.error}</p></div> : ready && offer &&
          <section className="trade-dock" aria-label="取引の確定">
            <div className="dock-top">
              <span>選んだことば</span>
              <b>{selectedCount}<small> / {offer.required_count} 個</small></b>
              <button className="text-button" disabled={!selected.length} onClick={() => {
                setSelected([]); action.current = undefined; setNotice('');
              }}>クリア</button>
            </div>
            {selectedUnits.length > 0 && <p className="stake-preview">{selectedUnits.map(u => u.text).join(' / ')}</p>}
            {!stakesReady ? <p className="selection-incomplete" role="status">{selectedCount > offer.required_count
              ? `${selectedCount - offer.required_count}個減らしてね` : `あと${offer.required_count - selectedCount}個選ぼう`}</p>
              : <button className="primary" disabled={busy || !games.length}
                onClick={() => { setError(''); setChoosingGame(true); }}>ギャンブルを選ぶ<span>→</span></button>}
          </section>}
      </>}
      {ready&&!resultMode&&(choosingReward||!offer)&&<Modal title="何を手に入れる？" onClose={offer?()=>setChoosingReward(false):undefined}><p className="modal-intro">個数は賭ける言葉の数。勝てば報酬を得て、負けると報酬は得られず賭けた言葉の意味が消えます。</p><div className="reward-options">{session.offers.map(o=><button key={o.id} className="reward-option" onClick={()=>{if(o.id!==offerId){setSelected([]);}setOfferId(o.id);setChoosingReward(false);setNotice('');action.current=undefined}}><span><small>{(o.family ? o.family === 'expression' : ['ちょっと名文','いい感じの空気','ひとことの魔法'].includes(o.title)) ? '表現系' : '展開系'}</small><b>{o.title}</b><small>{o.description}</small></span><strong>{o.required_count}<small>個</small></strong></button>)}</div></Modal>}
      {ready && !resultMode && !choosingReward && stakesReady && choosingGame &&
        <Modal title="どのギャンブルにする？" onClose={() => { if (!busy) setChoosingGame(false); }}>
          <p className="modal-intro">毎回、各難易度から3つのギャンブルが提示されます。</p>
          {hasBeginnerGames && <div className="game-tiers" role="group" aria-label="難易度">
            <button type="button" aria-pressed={gameTier === 'beginner'} disabled={busy} onClick={() => setGameTier('beginner')}>初心者</button>
            <button type="button" aria-pressed={gameTier === 'advanced'} disabled={busy} onClick={() => setGameTier('advanced')}>上級者</button>
          </div>}
          <div className="reward-options">{shownGames.map(option => <button className="reward-option game-option" key={option.id}
            disabled={busy} aria-busy={busy && action.current?.game === option.id} onClick={() => trade(option.id)}>
            <span><b>{option.name}</b>
              <small className="change-shape">{changeShapes[option.id]}</small>
              <small>{`勝率 ${Math.round(option.win_probability * 100)}％`}{option.id === 'rps' && '（1戦ごと・あいこは再戦）'}{option.id === 'card_guess' && '（無作為に選んだ場合）'}</small>
              <small>{option.id === 'dice' ? '4〜6で勝ち。' : option.description}</small><small className="bet-label">{busy && action.current?.game === option.id && <span className="spinner" aria-hidden="true" />}{busy && action.current?.game === option.id ? '賭ける・準備中…' : 'このギャンブルで賭ける →'}</small></span>
          </button>)}</div>
          {error && <p className="input-error" role="alert">{error}</p>}
        </Modal>}
    </>}
    </main>}
    {screen === 'game' && session && historyOpen && <Modal title="物語の変遷" onClose={() => setHistoryOpen(false)}><StoryHistory session={session} pageIndex={paperIndex} onPageChange={setPaperIndex} /></Modal>}
  </div>;
}
