import { createPortal } from 'react-dom';
import { ScenePublisher } from './ScenePublisher';
import { gameScene } from './sceneDialogue';
import { AnomaStageProvider, AnomaStage, StagePublisher, resultReaction, Opening } from './Anoma';
import { NormalEnding, StoryCounts, StoryDecision } from './StoryProgress';
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
import { GenerationSkeleton } from './GambleMotion';
import { storyVersions } from './storyVersions';
import './layout.css';

function requestId() {
  const b=crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const MIN_STORY = 20;
const MAX_STORY = 100;

function Modal({title,onClose,children}:{title:string;onClose?:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current!; d.showModal(); return()=>d.close()},[]);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={e=>{e.preventDefault();onClose?.()}}><div className="modal-heading"><h2 id="modal-title">{title}</h2>{onClose&&<button className="icon-button" aria-label="閉じる" onClick={onClose}>×</button>}</div>{children}</dialog>;
}

export default function App() {
  return <AnomaStageProvider><AppContent /></AnomaStageProvider>;
}

function AppContent(){
  const [screen,setScreen]=useState<'title'|'opening'|'choose'|'game'>('title');
  const [session,setSession]=useState<Session>();
  const [helpOpen,setHelpOpen]=useState(false);
  const [paperIndex,setPaperIndex]=useState<number>();
  const [highlight,setHighlight]=useState(false);
  const [gambleActions, setGambleActions] = useState<HTMLElement | null>(null);
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
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const inFlight=useRef(false),action=useRef<{id: string; game: GameKind} | undefined>(undefined);
  useEffect(() => {api<{games: GameOption[]}>('/games').then(data => setGames(data.games)).catch(() => setError('ゲームの一覧を取得できません。再読み込みしてください。'))}, []);
  function accept(s:Session){if(s.betting_mode!=='count-v1')throw new Error('個数方式へ更新中です。少し待ってからページを再読み込みしてください。');setSession(s);setScreen('game')}
  useEffect(()=>{
    setSelected([]);
    setGameTier('beginner');
    setPaperIndex(undefined);
    setHighlight(false);
    setChoosingGame(false);
    setOfferId('');
    setChoosingReward(true);
    action.current = undefined;
  },[session?.id,session?.version]);
  useEffect(()=>{
    if(screen !== 'game' || !session||!['analyzing','generating'].includes(session.status))return;
    let active=true;
    const timer=window.setInterval(()=>api<Session>(`/sessions/${session.id}`).then(s=>{if(active && !inFlight.current){setSession(s);setError('')}}).catch(e=>{if(active && !inFlight.current)setError(e.message)}),1400);
    return()=>{active=false;window.clearInterval(timer)};
  },[screen,session?.id,session?.status]);
  useEffect(()=>{window.scrollTo(0,0)},[screen,session?.view,session?.version]);
  async function act(fn:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'処理に失敗しました。')}finally{inFlight.current=false;setBusy(false)}}
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
  const wasStakesReady = useRef(false);
  useEffect(() => {
    const selectable = screen === 'game' && ready && !resultMode && !gambleMode && !choosingReward;
    if (stakesReady && !wasStakesReady.current && selectable) {
      setError('');
      setChoosingGame(true);
    }
    wasStakesReady.current = stakesReady;
  }, [stakesReady, screen, ready, resultMode, gambleMode, choosingReward]);
  function toggle(id:string){
    if(busy||!ready||resultMode||!offer||choosingReward)return;
    action.current=undefined;
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

  const storyChoice = useRef<{ id: string; sid: string; choice: 'escape' | 'continue'; version: number } | undefined>(undefined);
  async function chooseStory(choice: 'escape' | 'continue') {
    if (!session) return;
    await act(async () => {
      if (storyChoice.current?.sid !== session.id || storyChoice.current.choice !== choice || storyChoice.current.version !== session.version)
        storyChoice.current = { id: requestId(), sid: session.id, choice, version: session.version };
      accept(await api<Session>(`/sessions/${session.id}/story-choice`, {
        request_id: storyChoice.current.id, choice, version: session.version,
      }));
    });
  }
  const reaction = resultMode && session ? resultReaction(session.transactions) : undefined;
  const ended = session?.story_progress?.phase === 'ended';
  const versions = resultMode && session ? storyVersions(session) : undefined;
  const currentVersion = versions?.[Math.min(paperIndex ?? versions.length - 1, versions.length - 1)];
  const loss = currentVersion?.transaction?.outcome === 'loss' ? currentVersion.transaction : undefined;
  const lossInfo = loss ? `失った言葉 ${loss.stakes.join('・')}・紙に残る粉` : '';
  const decision = resultMode && session?.story_progress && ['escapable', 'extension'].includes(session.story_progress.phase)
    ? session.story_progress : undefined;
  const shellMode = screen === 'game' && !ended ? ' playing' : screen === 'choose' ? ' choosing'
    : screen === 'title' ? ' title-mode' : screen === 'opening' ? ' opening-mode' : '';
  const rewardModalOpen = !gambleMode && Boolean(ready && !resultMode && (choosingReward || !offer));
  const gambleModalOpen = !gambleMode && Boolean(ready && !resultMode && !choosingReward && stakesReady && choosingGame);
  const playSubMode = screen === 'game' && !ended ? (gambleMode ? ' gamble-view' : resultMode ? ' result-view' : ' wager-view') : '';
  const modalOpenMode = screen === 'game' && (rewardModalOpen || gambleModalOpen || historyOpen) ? ' contract-modal-open' : '';
  const errorNotice = error && !customOpen && !choosingGame && <div className="alert" role="alert">{error}{screen === 'game' && session &&
    <button onClick={() => act(async () => accept(await api<Session>(`/sessions/${session.id}`)))}>状態を確認</button>}</div>;
  function returnToTitle() {
    setSession(undefined);
    setScreen('title');
    setHistoryOpen(false);
    setError('');
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

  return <div className={`app-shell${shellMode}${playSubMode}${modalOpenMode}`}>
    <header className="navigation-bar">
      {screen !== 'title' && <>
      <button className="icon-button" aria-label="タイトルへ" disabled={busy} onClick={returnToTitle}>タイトルへ</button>
      {screen === 'game' && <button className="icon-button" aria-label="取引履歴" onClick={() => setHistoryOpen(true)}>☰</button>}
      </>}
    </header>
    <AnomaStage />
    {screen === 'title' && <ScenePublisher scene="title" />}
    {screen === 'choose' && <ScenePublisher scene="storySelect" />}
    {screen === 'game' && session && !ended && (!resultMode || !reaction) &&
      !(resultMode && session.story_progress && ['escapable', 'extension'].includes(session.story_progress.phase)) &&
      <ScenePublisher scene={gameScene({
        rewardModal: rewardModalOpen,
        gambleModal: gambleModalOpen,
        gambling: gambleMode, game: last?.gamble?.kind,
        processing: Boolean(processing || busy || session.view === 'result'), selectedCount, stakesReady,
      })} /> }
    {shellMode !== ' playing' && errorNotice}
    {screen === 'title' && <main className="title-screen">
      <div className="title-folio">
        <h1><span>ギャンブル</span><span>ライティングメーカー</span><small>(仮称)</small></h1>
        <p className="intro">言葉を賭けて、物語を書き換える</p>
      </div>
      <div className="title-actions">
        <button className="primary" disabled={busy} onClick={() => setScreen('opening')}>はじめる <span>→</span></button>
        <button className="secondary" onClick={() => setHelpOpen(true)}>遊び方</button>
      </div>
    </main>}
    {screen === 'opening' && <Opening busy={busy} onComplete={() => void reroll(true)} />}
    {helpOpen && <Modal title="遊び方" onClose={() => setHelpOpen(false)}><p>報酬を選び、赤線の言葉を賭けてギャンブルへ。勝てば報酬を得て、負けると賭けた言葉の意味が消えます。</p></Modal>}
    {screen === 'choose' && <main className="choose-screen">
      <div className="choose-header">
        <h1>物語を選ぶ</h1>
        <div className="story-selection-actions">
          <button className="secondary" disabled={busy} onClick={() => { setError(''); setCustomOpen(true); }}>自分で物語を入力</button>
          <button className="secondary" disabled={busy} onClick={() => reroll()}>別の候補を見る</button>
        </div>
      </div>
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
          <label htmlFor="custom-story-text">本文（{MIN_STORY}〜{MAX_STORY}文字）</label>
          <textarea id="custom-story-text" placeholder="例：雨の朝、少女は駅で赤い傘を拾った。持ち主を探すと、猫が一匹こちらを見ていた。" value={customText} rows={5} disabled={busy}
            onChange={event => { setCustomText(event.target.value); setError(''); }} />
          <span className={customCount > MAX_STORY ? 'input-error' : 'quiet'}>{customCount} / {MAX_STORY}文字</span>
          {customCount > MAX_STORY && <p className="input-error">{customCount - MAX_STORY}文字減らしてください。</p>}
          {error && <p className="input-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || customCount < MIN_STORY || customCount > MAX_STORY}>この物語ではじめる</button>
        </form>
      </Modal>}
    </main>}
    {screen === 'game' && session?.story_progress && ended && <NormalEnding progress={session.story_progress} onTitle={returnToTitle} />}
    {screen==='game'&&session&&!ended&&<main key={`${session.id}-${session.version}-${session.view}`}
      className={`game-screen fixed-game${session.version > 1 && session.view !== 'result' ? ' round-reveal' : ''}${resultMode && currentVersion?.transaction ? ` result-${currentVersion.transaction.outcome}-view` : ''}${gambleMode ? ' gambling-view' : ''}`}>
      <div className="game-heading">
        {currentVersion ? <span className={`edition-badge${currentVersion.transaction ? ` outcome-${currentVersion.transaction.outcome}` : ''}`} aria-live="polite">第{currentVersion.version}版{currentVersion.transaction &&
          `・${currentVersion.transaction.outcome === 'win' ? '勝利' : '敗北'}`}</span> : <>
          <div className="chapter-line"><span>第{round}章</span></div>
          <h1 className="story-title" title={session.title}>{session.title}</h1>
        </>}
      </div>
      {resultMode && <div className="result-meta">
        {loss && <span className="meta-loss" title={lossInfo}>{lossInfo}</span>}
        {decision && <StoryCounts totals={decision.totals} />}
      </div>}
      <div className="game-hero">
        {errorNotice}
        {gambleMode && last?.gamble ? <GamblePlay key={last.id} gamble={last.gamble} busy={busy} error={session.error} prepared={session.status === 'awaiting_reveal'}
          renderActions={children => gambleActions ? createPortal(children, gambleActions) : null}
          onMove={(attempt, choice) => act(async () => accept(await api<Session>(`/sessions/${session.id}/transactions/${last.id}/play`, { attempt, choice })))}
          onFinish={() => act(async () => accept(await api<Session>(`/sessions/${session.id}/transactions/${last.id}/finish`, {})))} />
        : resultMode ?
          <StoryPaperStack session={session} dust={dust} losses={losses} result pageIndex={paperIndex} onPageChange={setPaperIndex} highlight={highlight} />
        : <>
          <section className="story-board wager-paper-stack" aria-label="賭ける言葉を選ぶ">
            <PaperLayers count={round}>{processing ? <GenerationSkeleton /> : session.analysis ?
              <WagerManuscript text={session.text} units={units} selected={selected}
                disabled={!ready || !offer || busy || choosingReward || choosingGame} onToggle={toggle} dust={dust} losses={losses} />
              : <Manuscript text={session.text} dust={dust} losses={losses} />}
            </PaperLayers>
          </section>
          {session.status === 'error' && <div className="api-error" role="alert"><p>{session.error}</p></div>}
        </>}
      </div>
      {gambleMode ? <footer className="action-bar gamble-bar" ref={setGambleActions} /> :
        resultMode ? <footer className="action-bar result-bar">
          <button className="text-button" aria-pressed={highlight} onClick={() => {
            if (!highlight && versions) setPaperIndex(versions.length - 1);
            setHighlight(!highlight);
          }}>どこが変わった？</button>
          {decision
            ? <StoryDecision progress={decision} busy={busy} showCounts={false} onChoice={choice => void chooseStory(choice)} />
            : reaction && <StagePublisher lines={[reaction.line]} expression={reaction.expression} reaction={reaction.reaction} />}
          {session.story_progress?.phase !== 'escapable' &&
            <button className="primary" disabled={busy} onClick={() => act(async () => {
              accept(await api<Session>(`/sessions/${session.id}/continue`, {}));
              setSelected([]);
              setOfferId('');
              setChoosingReward(true);
            })}>次は何をねらう？ <span>→</span></button>}
        </footer> : <footer className="action-bar wager-bar" aria-label="取引の確定">
          <button className="secondary reward-change" disabled={!ready || busy}
            title={offer ? `${offer.title}・${offer.required_count}個 変更` : undefined}
            onClick={() => { setChoosingGame(false); setChoosingReward(true); }}>
            {offer ? <><span>{offer.title}</span>{`・${offer.required_count}個 変更`}</> : '報酬を選ぼう'}
          </button>
          {offer && <>
            <output className={`stake-count${stakesReady ? ' stakes-ready' : ''}`} aria-label="選んだ個数">{selectedCount} / {offer.required_count}</output>
            <button className="text-button" disabled={busy || !selected.length} onClick={() => {
              setSelected([]); action.current = undefined;
            }}>クリア</button>
            <button className="primary" disabled={!stakesReady || busy || !games.length}
              onClick={() => { setError(''); setChoosingGame(true); }}>ギャンブルを選ぶ</button>
          </>}
        </footer>}
      {!gambleMode && <>
      {ready&&!resultMode&&(choosingReward||!offer)&&<Modal title="何を手に入れる？" onClose={offer?()=>setChoosingReward(false):undefined}><div className="reward-options">{session.offers.map(o=><button key={o.id} className="reward-option" onClick={()=>{if(o.id!==offerId){setSelected([]);}setOfferId(o.id);setChoosingReward(false);action.current=undefined}}><span><b>{o.title}</b><small>{o.description}</small></span><strong>{o.required_count}<small>個</small></strong></button>)}</div></Modal>}
      {ready && !resultMode && !choosingReward && stakesReady && choosingGame &&
        <Modal title="どのギャンブルにする？" onClose={() => { if (!busy) setChoosingGame(false); }}>

          {hasBeginnerGames && <div className="game-tiers" role="group" aria-label="難易度">
            <button type="button" aria-pressed={gameTier === 'beginner'} disabled={busy} onClick={() => setGameTier('beginner')}>初心者</button>
            <button type="button" aria-pressed={gameTier === 'advanced'} disabled={busy} onClick={() => setGameTier('advanced')}>上級者</button>
          </div>}
          <div className="reward-options">{shownGames.map(option => <button className="reward-option game-option" key={option.id}
            disabled={busy} aria-busy={busy && action.current?.game === option.id} onClick={() => trade(option.id)}>
            <span><b>{option.name}</b>{busy && action.current?.game === option.id && <span className="spinner" aria-hidden="true" />}</span>
          </button>)}</div>
          {error && <p className="input-error" role="alert">{error}</p>}
        </Modal>}
    </>}
    </main>}
    {screen === 'game' && session && historyOpen && <Modal title="物語の変遷" onClose={() => setHistoryOpen(false)}><StoryHistory session={session} pageIndex={paperIndex} onPageChange={setPaperIndex} /></Modal>}
  </div>;
}
