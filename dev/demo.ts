// ライブデモ: モックデータを「実際の描画コード」に流し、本物のカードを表示する。
// build:demo で単一HTML(docs/demo.html)に inline され、GitHub Pages で配信される。
// 目玉の「予測」タブを既定で開く。
import { CSS } from '../src/styles';
import { renderLearningCard } from '../src/ui/learningCard';
import { installMocks } from './mock';

const sample = installMocks();

document.title = 'ZEN Study 学習統計 — ライブデモ';

// ページ用スタイル（カード内部は Shadow DOM の CSS が担当）。
const pageCss = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic Pro", Meiryo, sans-serif;
    background: #eef1f5; color: #222;
    display: flex; flex-direction: column; align-items: center;
    padding: 28px 16px 60px;
    transition: background .2s, color .2s;
  }
  body.dark { background: #0f1319; color: #e6ebf1; }
  .demo-bar { width: 100%; max-width: 520px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .demo-h { font-size: 18px; font-weight: 800; margin: 0; letter-spacing: .01em; }
  .demo-sub { font-size: 12px; opacity: .7; margin: 3px 0 0; line-height: 1.5; }
  .demo-actions { display: flex; gap: 8px; flex: 0 0 auto; }
  .demo-btn {
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit;
    border-radius: 8px; padding: 6px 12px;
  }
  .demo-btn:hover { background: rgba(128,128,128,.12); }
  a.demo-btn { text-decoration: none; }
  .demo-mount { width: 100%; max-width: 520px; }
  .demo-foot { max-width: 520px; margin-top: 16px; font-size: 11px; opacity: .6; line-height: 1.6; text-align: center; }
`;
const pageStyle = document.createElement('style');
pageStyle.textContent = pageCss;
document.head.appendChild(pageStyle);

// ヘッダ
const bar = document.createElement('div');
bar.className = 'demo-bar';
const head = document.createElement('div');
head.innerHTML =
  '<h1 class="demo-h">ZEN Study 学習統計 — ライブデモ</h1>' +
  '<p class="demo-sub">サンプル（モック）データを実際の描画コードに通した本物のカードです。タブを切り替えて操作できます。</p>';
const actions = document.createElement('div');
actions.className = 'demo-actions';
const themeBtn = document.createElement('button');
themeBtn.className = 'demo-btn';
themeBtn.textContent = 'ダーク';
const repoLink = document.createElement('a');
repoLink.className = 'demo-btn';
repoLink.href = 'https://github.com/mug1ch4/zen-study-stats';
repoLink.target = '_blank';
repoLink.rel = 'noopener';
repoLink.textContent = 'GitHub';
actions.append(themeBtn, repoLink);
bar.append(head, actions);
document.body.appendChild(bar);

// カード（Shadow DOM に CSS を注入）。目玉の「予測」タブ(index 1)を既定で開く。
const mount = document.createElement('div');
mount.className = 'demo-mount';
const host = document.createElement('div');
const root = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = CSS;
root.appendChild(style);
root.appendChild(renderLearningCard(sample, { defaultTab: 1 }));
mount.appendChild(host);
document.body.appendChild(mount);

const foot = document.createElement('div');
foot.className = 'demo-foot';
foot.textContent = '※ 表示専用・read-only の可視化ツールです。数値はサンプルで、実際の学習記録ではありません。';
document.body.appendChild(foot);

// テーマ切替（ページ背景とカードの data-theme を同時に）
let dark = false;
themeBtn.addEventListener('click', () => {
  dark = !dark;
  document.body.classList.toggle('dark', dark);
  host.setAttribute('data-theme', dark ? 'dark' : 'light');
  themeBtn.textContent = dark ? 'ライト' : 'ダーク';
});
