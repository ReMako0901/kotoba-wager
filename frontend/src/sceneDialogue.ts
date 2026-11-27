import { chooseLine, type AnomaExpression } from './scenario';

// UI_FEEDBACK3.md is the source of these scene lines; reactions remain separate.
export const scenePools = {
  "title": { lines: ["あら、来たのね。待っていたわ。", "今日はどの物語を賭けるのかしら。", "言葉の用意はいい？　始めるわよ。", "ここでは物語が、そのまま賭け金になるの。", "ふふ、逃げるなら今のうちよ。", "あなたの言葉、今日は幾つ残るかしらね。", "退屈していたところよ。よく来たわね。", "物語の扉は開いているわ。どうぞ。"], expressions: ["normal", "smile", "composed"] },
  "storySelect": { lines: ["どの物語にする？　運命は自分で選ぶものよ。", "百を超える物語があるわ。迷うのも楽しいでしょう。", "最初の言葉が、その物語の全てを決めるの。", "気になる題名があったら、それが縁というものよ。", "短い物語ほど、言葉の一つが重いの。", "さあ、選んで。あなたの書きたい物語を。", "どれも誰かの大事な言葉でできているわ。", "自分で書いた物語を持ち込むのも、歓迎するわ。"], expressions: ["normal", "composed", "smile"] },
  "rewardSelect": { lines: ["何が欲しい？　欲しいものには、代価が要るの。", "大きな望みには、大きな賭けが要るわ。", "選ぶのはあなた。後悔の面倒は見ないけど。", "ふふ、欲張りな目をしているわね。", "一つだけよ。欲張ると、物語が痩せてしまう。", "その望み、言葉幾つ分の重さかしら。"], expressions: ["smile", "taunt", "composed"] },
  "wordSelect0": { lines: ["赤い線の言葉が、あなたを待っているわ。", "どの言葉を手放せる？　よく見て選んで。", "言葉は一つずつ、静かに選ぶものよ。", "その物語の、大事な言葉はどれかしら。", "迷う時間も嫌いじゃないわ。急がないで。", "軽い言葉ほど、失くすと響くのよ。", "さあ、指先で示して。あなたの覚悟を。", "全部は賭けられないわ。選ぶことが賭けなの。", "その言葉、本当にいらない？　よく考えて。", "数えるのは私の仕事。選ぶのはあなたの仕事。"], expressions: ["normal", "composed"] },
  "wordSelectPartial": { lines: ["いい目をしているわ。その調子。", "あと少し。物語がざわついてきたわね。", "その言葉を選ぶのね。ふふ、面白い。", "揃うまでの間が、一番どきどきするでしょう？", "惜しくなってきた？　それが言葉の重さよ。", "あと少しで、私と勝負よ。"], expressions: ["smile", "giggle"] },
  "wordSelectReady": { lines: ["揃ったわね。では、始めましょう。", "覚悟は決まったようね。いい顔よ。", "さあ、私のところへいらっしゃい。", "その言葉たち、預かったわ。大事に賭けてね。", "ふふ、震えていない？　大丈夫、すぐ終わるわ。", "勝負の時間よ。逃げ道は、もうないわ。"], expressions: ["smile", "wink", "taunt"] },
  "gambleSelect": { lines: ["どれがいいでしょうね。ふふ。", "運に任せる？　腕に任せる？　選ぶのも賭けよ。", "どの勝負も、私が相手よ。手加減はしないわ。", "迷うなら、直感を信じなさい。", "大きく変わる勝負は、危ない香りがするわね。", "静かな勝負ほど、読み合いになるの。", "さあ、選んで。あなたの物語が懸かっているわ。", "どれを選んでも、結果は私が見届けるわ。", "運命の選び方にも、性格が出るのよ。", "一つに決めて。迷いは賭けの味方をしないわ。"], expressions: ["taunt", "composed", "smile"] },
  "gamblePlay": { lines: ["さあ、見せて。あなたの運を。", "結果は、もう決まっているのかもしれないわね。", "その手つき、悪くないわ。", "どきどきするでしょう？　私は慣れているけど。", "目を逸らしたら負けよ。最後まで見届けて。", "ふふ、その顔が見たかったの。"], expressions: ["taunt", "composed"] },
  "gamblePlay:janken": { lines: ["最初はグー、よ。読めるかしら、私の手が。", "手は正直よ。あなたの迷いが出るわ。", "三つの手、無限の読み合いね。", "さあ、出して。容赦はしないわ。"], expressions: ["taunt", "composed"] },
  "gamblePlay:card": { lines: ["一枚選んで。裏側は、私だけが見ているわ。", "そのカードでいいの？　ふふ、変えてもいいのよ。", "目移りする子は、よく外すわ。", "当たりは一枚だけ。残りは全部、私のもの。", "指先が震えているわよ。可愛いわね。"], expressions: ["taunt", "composed"] },
  "gamblePlay:chinchiro": { lines: ["目は転がる間だけ自由よ。", "大きな目が出るといいわね。私のためじゃなく。", "サイコロは嘘をつかないわ。人は、つくけど。", "さあ、転がして。運命の音を聞かせて。"], expressions: ["taunt", "composed"] },
  "gamblePlay:slot": { lines: ["リールは運命の形をしているの。", "止める指先に、全部懸かっているわ。", "揃う瞬間が一番きれいなの。知っているでしょう。", "あと一つ、が一番危ないのよ。", "回して。物語が目まぐるしく変わるわ。"], expressions: ["taunt", "composed"] },
  "gamblePlay:blackjack": { lines: ["もう一枚引く？　欲は深いわね。", "数字の読み合い、嫌いじゃないわ。", "私の手は見えないわ。想像で補いなさい。", "止まる勇気も、賭けのうちよ。", "二十一に近い方が勝ち。単純で、残酷ね。"], expressions: ["taunt", "composed"] },
  "gamblePlay:baccarat": { lines: ["絞る時間は、あなたのものよ。ゆっくりどうぞ。", "カードの端から、運命が覗いているわ。", "どちらに賭ける？　空気を読むのも実力よ。", "めくる瞬間の顔、私は見逃さないわ。", "静かに、丁寧に。儀式のようにね。"], expressions: ["taunt", "composed"] },
  "generating": { lines: ["物語を編み直しているわ。少し待って。", "言葉が並び替わる音がするでしょう。", "新しい物語は、生まれる時に少し震えるの。", "待つ時間も、賭けの代価のうちよ。", "どんな姿になるかしら。私も楽しみだわ。", "ページの向こうで、言葉たちが騒いでいるわ。", "もうすぐよ。目を離さないで。", "静かに。物語が息を整えているわ。"], expressions: ["normal", "deadpan", "composed"] },
} as const satisfies Record<string, { lines: readonly string[]; expressions: readonly AnomaExpression[] }>;
export type SceneKey = keyof typeof scenePools;
const previousLines = new Map<SceneKey, string>();
export function chooseScene(key: SceneKey, random = Math.random) {
  const pool = scenePools[key];
  const line = chooseLine(pool.lines, previousLines.get(key), random);
  previousLines.set(key, line);
  return { lines: [line], expression: pool.expressions[Math.floor(random() * pool.expressions.length)] };
}

export interface GameSceneState {
  rewardModal: boolean;
  gambleModal: boolean;
  gambling: boolean;
  game?: string;
  processing: boolean;
  selectedCount: number;
  stakesReady: boolean;
}
export function gameScene(state: GameSceneState): SceneKey {
  if (state.rewardModal) return 'rewardSelect';
  if (state.gambleModal) return 'gambleSelect';
  if (state.gambling) {
    const kind = state.game === 'rps' ? 'janken' : state.game === 'card_guess' ? 'card' : state.game;
    const key = `gamblePlay:${kind}`;
    return Object.hasOwn(scenePools, key) ? key as SceneKey : 'gamblePlay';
  }
  if (state.processing) return 'generating';
  return state.selectedCount === 0 ? 'wordSelect0' : state.stakesReady ? 'wordSelectReady' : 'wordSelectPartial';
}

export const interviewDialogue = {
  intro: 'まず、あなたのことを教えてくれる？',
  caution: '内緒のことや重い話は、ここではお休みにしよう。',
  name: 'あなたを何と呼べばいい？',
  questions: [
    { question: '今日はどんなことがあったの？', followup: 'たとえば、どこで？ 誰といたの？' },
    { question: 'どこから、どうやって来たの？', followup: '何に乗って来たの？ 途中で何か見えた？' },
    { question: '今はどんな気分？', followup: '体は元気？ 眠い、とか、わくわく、とか' },
    { question: 'どんなものが好き？', followup: 'たとえば、最近いちばん楽しかったのは？' },
    { question: '今日は何を食べたの？', followup: 'どこで食べたの？ 誰かと一緒だった？' },
    { question: '最近、気になっていることはある？', followup: 'それ、いつから気になってるの？' },
    { question: 'どこへ行ってみたい？', followup: 'そこへ行ったら、何をしたい？' },
  ],
  contact: '連絡先を除いて答えてください。',
  note: '住所・学校・連絡先など個人が分かることは避けてください。',
};
