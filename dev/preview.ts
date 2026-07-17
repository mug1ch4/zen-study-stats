import { CSS } from '../src/styles';
import { renderLearningCard } from '../src/ui/learningCard';
import { ensureSidePanel } from '../src/ui/sidePanel';
import { installMocks } from './mock';

const sample = installMocks();

const mount = document.getElementById('mount')!;
const host = document.createElement('div');
const root = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = CSS;
root.appendChild(style);
root.appendChild(renderLearningCard(sample));
mount.appendChild(host);

// トグル
document.getElementById('toggle')!.addEventListener('click', () => {
  document.body.classList.toggle('dark');
});
let dark = false;
document.getElementById('cardtheme')!.addEventListener('click', () => {
  dark = !dark;
  host.setAttribute('data-theme', dark ? 'dark' : 'light');
});

// サイドパネル（他ページ用の端の展開パネル）の確認: モック学習数は installMocks で注入済み
void ensureSidePanel();
