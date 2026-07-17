// 控えめなトースト通知（左下・数秒で自動消滅・スタック）。read-only の表示のみ。
import { isDark } from '../darkmode';

const HOST_ID = 'zss-toast-host';

const CSS = `
.wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
  display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none; max-width: min(340px, 80vw); }
.toast {
  pointer-events: auto; display: flex; align-items: flex-start; gap: 8px;
  background: #ffffff; color: #1a1a1a; border: 1px solid rgba(0,0,0,.08);
  border-left: 3px solid #0077d3; border-radius: 10px; padding: 10px 12px;
  box-shadow: 0 4px 18px rgba(0,0,0,.18); font: 13px/1.5 -apple-system,"Hiragino Sans",system-ui,sans-serif;
  opacity: 0; transform: translateY(8px); transition: opacity .22s ease, transform .22s ease; }
.toast.in { opacity: 1; transform: translateY(0); }
.toast .ic { flex: 0 0 auto; font-size: 16px; line-height: 1.3; }
.toast .msg { min-width: 0; }
.toast .x { flex: 0 0 auto; margin-left: 4px; cursor: pointer; color: #9aa0a6; font-size: 15px; line-height: 1; background: none; border: none; padding: 0; }
:host([data-theme="dark"]) .toast { background: #232b35; color: #e6ebf1; border-color: rgba(255,255,255,.1); box-shadow: 0 4px 18px rgba(0,0,0,.5); }
:host([data-theme="dark"]) .toast .x { color: #7a8593; }
`;

function ensureHost(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.append(st, wrap);
    (document.body ?? document.documentElement).appendChild(host);
  }
  host.setAttribute('data-theme', isDark() ? 'dark' : 'light');
  return host.shadowRoot!;
}

export interface ToastOpts {
  icon?: string;
  accent?: string;
  durationMs?: number;
}

/** トーストを1件表示（数秒で自動消滅・クリックで即閉じ）。 */
export function showToast(message: string, opts: ToastOpts = {}): void {
  try {
    const root = ensureHost();
    const wrap = root.querySelector('.wrap') as HTMLElement;
    const el = document.createElement('div');
    el.className = 'toast';
    if (opts.accent) el.style.borderLeftColor = opts.accent;
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = opts.icon ?? '📚';
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = message;
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.setAttribute('aria-label', '閉じる');
    el.append(ic, msg, x);
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));

    let timer = 0;
    const dismiss = () => {
      window.clearTimeout(timer);
      el.classList.remove('in');
      window.setTimeout(() => el.remove(), 240);
    };
    x.addEventListener('click', dismiss);
    timer = window.setTimeout(dismiss, opts.durationMs ?? 6000);
  } catch {
    /* ignore */
  }
}
